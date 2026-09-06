import { defineStore } from 'pinia'

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
    /** 切换身份：调用后端换取新 token，然后按身份重定向到对应分包首页 */
    switchRole(role) {
      // TODO: api.auth.switchRole(role) -> 新 token
      this.currentRole = role
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
