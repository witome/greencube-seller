import { defineStore } from 'pinia'
import { authApi } from '@/api/modules'

/**
 * 用户与身份状态
 * 权限铁律：user.roles 支持多身份（同账号可同时是采购方/供应商/配送员）
 * 切换身份即重签 token（后端按当前身份签发，接口按角色守卫 + 数据行级隔离）
 */
export const useUserStore = defineStore('user', {
  state: () => ({
    token: '',
    userId: null,
    name: '',
    phone: '',
    roles: [],          // ['purchaser','supplier','courier']
    currentRole: 'purchaser', // 当前身份，决定首页路由
  }),
  getters: {
    isBuyer: (s) => s.currentRole === 'purchaser',
    isSupplier: (s) => s.currentRole === 'supplier',
    isCourier: (s) => s.currentRole === 'courier',
  },
  actions: {
    setLogin(payload) {
      this.token = payload.token
      this.userId = payload.userId
      this.name = payload.name
      this.phone = payload.phone
      this.roles = payload.roles || []
    },
    /**
     * 切换身份（决策 4 完整落实）：
     * ① 调后端 /auth/switch-role 换新 token（服务端校验身份所有权 + 按 currentRole 重签，守卫按 JWT 判权）
     * ② 新 token + currentRole 同步写入 store 与本地缓存
     * ③ 清空业务缓存（跨身份防串数据：AI 会话草稿、注册流程残留）
     * ④ 按新身份 reLaunch 对应首页
     * 失败时：抛出异常由调用方提示，本方法在拿到新 token 前不做任何本地变更、不跳转（保持原身份）
     */
    async switchRole(role) {
      const data = await authApi.switchRole(role) // 失败：request 层已 toast 并 reject，直接向上抛
      this.token = data.token
      this.currentRole = data.currentRole || role
      uni.setStorageSync('token', data.token)
      uni.setStorageSync('currentRole', this.currentRole)
      clearBusinessCache()
      const home = {
        purchaser: '/pages/buyer/home',
        supplier: '/subpkg-supplier/pages/home',
        courier: '/subpkg-courier/pages/home',
      }[role]
      uni.reLaunch({ url: home })
    },
    logout() {
      this.$reset()
      uni.reLaunch({ url: '/pages/buyer/home' })
    },
  },
})

/** 业务缓存清空清单（决策 4：切身份防串数据）。凭据类（token/currentRole/accountStatus）由切换流程覆写，不在此列 */
const BUSINESS_CACHE_KEYS = ['aiDraft', 'registeredRole', 'account_status']
function clearBusinessCache() {
  BUSINESS_CACHE_KEYS.forEach((k) => uni.removeStorageSync(k))
}
