/**
 * 登录 code 获取 —— 全仓唯一共享实现（2026-09-19 拍板卡）
 *
 * 背景：登录页与 App.vue 各写了一份「mock 用写死 code / 非 mock 调 uni.login()」，
 * 清雷时只改了 App.vue，独立登录页漏网，导致真实登录下把 'buyer' 当 code 发给微信。
 * 本函数收口后，任何需要登录 code 的地方都必须调它，不允许再写第二份。
 *
 * 行为：
 * - mock 模式（VITE_USE_MOCK_LOGIN=true，或开发构建未配置时默认 mock）：
 *   返回 devRole（保证 openid 稳定，多端共用同一测试身份）；
 *   fresh=true 时返回 reg_+时间戳（模拟「全新用户」，供开发环境测试注册流程）。
 * - 真实模式（生产构建默认 / 显式 VITE_USE_MOCK_LOGIN=false）：
 *   微信小程序端调 uni.login() 拿真实临时 code（每次独立、单次有效）；
 *   非 MP-WEIXIN 平台无微信登录能力，维持 devRole 兜底（H5 开发用）。
 *
 * 注意：真实模式下 openid 与微信账号一一对应，fresh 不生效——
 * 登录与注册是同一个用户，注册复用当前登录态（先 wx-login 拿 token，再带 token 去注册）。
 */
export async function getLoginCode({ fresh = false } = {}) {
  // 开关走构建配置：VITE_USE_MOCK_LOGIN 显式配置优先；未配置时开发默认开、生产构建默认关
  // → 打正式包自动切真实登录，不靠人记得改代码（后端 .env WX_MOCK_LOGIN 仍需独立配置）
  const USE_MOCK_LOGIN =
    import.meta.env.VITE_USE_MOCK_LOGIN !== undefined
      ? String(import.meta.env.VITE_USE_MOCK_LOGIN) === 'true'
      : process.env.NODE_ENV !== 'production'

  if (USE_MOCK_LOGIN) {
    // mock：devRole 保证同一测试身份；fresh 模拟新用户（仅开发测试注册用）
    if (fresh) return 'reg_' + Date.now()
    return uni.getStorageSync('devRole') || 'buyer'
  }

  // #ifdef MP-WEIXIN
  return await new Promise((resolve) => {
    uni.login({
      provider: 'weixin',
      success: (res) => resolve(res.code || ''),
      fail: () => resolve(''),
    })
  })
  // #endif

  // 非 MP-WEIXIN（H5 等）真实模式下无微信登录能力，兜底 devRole（与历史行为一致）
  // #ifndef MP-WEIXIN
  return uni.getStorageSync('devRole') || 'buyer'
  // #endif
}
