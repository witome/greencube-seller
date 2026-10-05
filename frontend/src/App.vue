<script>
import { authApi } from '@/api/modules'
import { getLoginCode } from '@/utils/wx-login'
import { restorePreferredRole, rememberPreferredRole } from '@/utils/preferred-role'
import { stopAllPollers } from '@/utils/poller-registry'

// 调试用角色映射（dev mock 登录 code，后端会加 dev_ 前缀：demo_supplier → dev_demo_supplier）
const DEV_ROLES = [
  { name: '采购方', role: 'buyer', path: '/pages/buyer/home', emoji: '🛒' },
  { name: '供应商', role: 'demo_supplier', path: '/subpkg-supplier/pages/home', emoji: '🥕' },
  { name: '配送员', role: 'courier', path: '/subpkg-courier/pages/home', emoji: '🚚' },
]

async function switchRole(role, path) {
  uni.setStorageSync('devRole', role)
  try {
    // 直接重新登录（不依赖 reload 触发 onLaunch），拿到新角色的 token 后再跳转
    const data = await authApi.login(role)
    uni.setStorageSync('token', data.token)
    uni.setStorageSync('currentRole', data.currentRole)
    uni.setStorageSync('accountStatus', data.accountStatus)
    rememberPreferredRole(data.currentRole) // dev 浮窗切换与正式切换行为一致
    uni.showToast({ title: '已切换角色', icon: 'none' })
    // dev 浮窗与 store.switchRole 同规：先停所有轮询再 reLaunch（防旧页轮询带新 token 调旧角色接口）
    stopAllPollers()
    setTimeout(() => uni.reLaunch({ url: path }), 200)
  } catch (e) {
    console.warn('切换角色失败', e)
    uni.showToast({ title: '切换失败：请确认后端已启动', icon: 'none' })
  }
}

function injectDevRoleSwitcher() {
  // 调试浮窗只在开发环境渲染；生产构建（NODE_ENV=production）直接跳过，避免跟着正式包漏出去
  if (process.env.NODE_ENV === 'production') return
  if (typeof document === 'undefined') return
  if (document.getElementById('dev-role-switcher')) return

  const wrap = document.createElement('div')
  wrap.style.cssText =
    'position:fixed;right:14px;bottom:92px;z-index:99999;display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-family:sans-serif;'

  const panel = document.createElement('div')
  panel.style.cssText =
    'background:#fff;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.18);overflow:hidden;display:none;min-width:160px;'

  DEV_ROLES.forEach((r) => {
    const item = document.createElement('div')
    item.textContent = `${r.emoji} ${r.name}`
    item.style.cssText =
      'padding:13px 18px;font-size:14px;color:#333;cursor:pointer;border-bottom:1px solid #f0f0f0;'
    item.onclick = () => switchRole(r.role, r.path)
    panel.appendChild(item)
  })

  const btn = document.createElement('div')
  btn.id = 'dev-role-switcher'
  btn.textContent = '🎭 切换角色'
  btn.style.cssText =
    'background:#00B96B;color:#fff;padding:9px 14px;border-radius:22px;font-size:13px;font-weight:600;box-shadow:0 3px 10px rgba(0,0,0,.25);cursor:pointer;'
  btn.onclick = () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
  }

  wrap.appendChild(panel)
  wrap.appendChild(btn)
  document.body.appendChild(wrap)
}

export default {
  onLaunch() {
    // 暴露补登方法（供切换角色等场景复用）
    try {
      const app = getApp()
      app.globalData = app.globalData || {}
      app.globalData.relogin = () => this.autoLogin()
    } catch (e) {}
    // 卡CF复核修复1（2026-10-05）：静默补登 + 按角色跳转只允许**冷启动跑一次**。
    // 原来放在 onShow ⇒ 每次回前台都会跑：供应商在 goods-manage 等表单页切后台再回来，
    // 会被 reLaunch 踢回供应商首页，草稿全丢。挪进 onLaunch 后回前台不再触发。
    // 启动时静默补登一次（微信静默登录，不弹任何授权框）：
    // 成功 → 若是 supplier/courier 身份则按既有 routeToRoleHome 跳各自首页；失败 → 完全静默。
    this.autoLogin()
      .then((role) => {
        if (role) this.routeToRoleHome(role)
      })
      .catch(() => {})
  },
  onShow() {
    // #ifdef H5
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => injectDevRoleSwitcher())
      } else {
        setTimeout(() => injectDevRoleSwitcher(), 200)
      }
    }
    // #endif
  },
  methods: {
    async autoLogin() {
      const token = uni.getStorageSync('token')
      if (token) {
        // 主动校验本地 token 是否仍有效（后端换密钥/过期时自动清除重登）
        try {
          await authApi.getProfile()
          return uni.getStorageSync('currentRole') || null // 有效，跳过
        } catch (e) {
          // 失效：getProfile 内部已通过 request 清除凭据，这里落到重登
        }
      }
      // 登录 code 全仓唯一入口：mock 用 devRole / 真实模式调 uni.login()（详见 utils/wx-login.js）
      const code = await getLoginCode()
      try {
        const data = await authApi.login(code)
        // 恢复用户上次选的身份（真实登录下后端 pickRole 无法感知意图，会回默认采购方）
        await restorePreferredRole(data)
        uni.setStorageSync('token', data.token)
        uni.setStorageSync('currentRole', data.currentRole)
        uni.setStorageSync('accountStatus', data.accountStatus)
        return data.currentRole
      } catch (e) {
        console.warn('自动登录失败（后端可能未启动）', e)
        return null
      }
    },

    // 登录后按角色跳转对应首页（配送员/供应商身份不进入采购方首页，避免「无权限」）
    routeToRoleHome(currentRole) {
      if (!currentRole || currentRole === 'purchaser') return
      const homeMap = {
        supplier: '/subpkg-supplier/pages/home',
        courier: '/subpkg-courier/pages/home',
      }
      const path = homeMap[currentRole]
      if (path) {
        setTimeout(() => uni.reLaunch({ url: path }), 100)
      }
    },
  },
}
</script>

<style lang="scss">
/* 设计 token 与公共样式全局注入 */
@import '@/styles/tokens.scss';
@import '@/styles/common.scss';

/* 页面基础底色（对应原型 .page 背景） */
page {
  background: $bg-page;
  font-size: 15px;
  color: $text-body;
}
</style>
