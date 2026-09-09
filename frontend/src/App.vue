<script>
import { authApi } from '@/api/modules'

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
    uni.showToast({ title: '已切换角色', icon: 'none' })
    setTimeout(() => uni.reLaunch({ url: path }), 200)
  } catch (e) {
    console.warn('切换角色失败', e)
    uni.showToast({ title: '切换失败：请确认后端已启动', icon: 'none' })
  }
}

function injectDevRoleSwitcher() {
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
    // 登录页方案：token 被清除后，若不在登录页则跳登录页（不再自动补登）
    if (!uni.getStorageSync('token')) {
      const pages = getCurrentPages()
      if (pages.length) {
        const cur = pages[pages.length - 1]
        if (!cur.route || cur.route.indexOf('pages/login') !== 0) {
          uni.reLaunch({ url: '/pages/login/index' })
        }
      }
    }
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
      // 登录 code：mock 阶段用固定 devRole（保证 openid 稳定，多端共用同一测试身份）
      // 切真实登录时：把 USE_MOCK_LOGIN 改 false + 后端 .env WX_MOCK_LOGIN=0
      const USE_MOCK_LOGIN = true
      let code = uni.getStorageSync('devRole') || 'buyer'
      // #ifdef MP-WEIXIN
      if (!USE_MOCK_LOGIN) {
        code = await new Promise((resolve) => {
          uni.login({
            provider: 'weixin',
            success: (res) => resolve(res.code || ''),
            fail: () => resolve(''),
          })
        })
      }
      // #endif
      try {
        const data = await authApi.login(code)
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
