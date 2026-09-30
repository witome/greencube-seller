import { authApi } from '@/api/modules'

/**
 * 采购方「运营停用」拦截（卡AA 2026-09-30）—— 全部采购方入口页 onShow 共用这一份判定
 *
 * 口径：purchaser 档案存在且 accountStatus=5（运营停用）→ reLaunch 到停用提示页
 * （该页无申诉按钮、无任何其它操作入口）。停用只挡浏览与新单，进行中订单由运营侧照常处理。
 *
 * 判定数据来源与现有 profile 逻辑一致：GET /auth/profile → profile.purchaser.accountStatus
 * （home/mine 等本来就拉 profile 的页面把已拉到的 profile 传进来，避免重复请求）。
 *
 * @param {Object} [preloadedProfile] 已拉取的 GET /auth/profile 返回值（可选）
 * @returns {boolean} true = 已判定为停用并触发跳转，调用方应立即 return 停止本页后续加载
 */
export async function guardBuyerSuspended(preloadedProfile) {
  try {
    const profile = preloadedProfile || (await authApi.getProfile())
    if (profile && profile.purchaser && profile.purchaser.accountStatus === 5) {
      uni.reLaunch({ url: '/pages/buyer/account-suspended' })
      return true
    }
    return false
  } catch (e) {
    // profile 拉取失败不拦（网络错误/未登录等由各自页面既有兜底与 request.js 统一提示处理）
    return false
  }
}
