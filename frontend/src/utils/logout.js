import { forgetPreferredRole } from '@/utils/preferred-role'
import { stopAllPollers } from '@/utils/poller-registry'

/**
 * 登录态清理 —— 卡AC（2026-09-30）收口：注销成功后的清理与「退出登录」必须是同一份，
 * 绝不允许各写一套（历史上清漏 devRole / 忘了 forgetPreferredRole / 忘停轮询器，
 * 都出过「退了再进来还是老身份、旧轮询拿旧 token 一直报权限错」这类 bug）。
 *
 * 原先这套逻辑内联在 pages/buyer/mine.vue 的 logout() 里，现抽出共用：
 *   - mine.vue 退出登录 → logoutToLogin()（清 token + 去登录页）
 *   - account-cancel.vue 注销成功 → clearIdentityMemory()（**不动 token**：注销只作用于
 *     采购方身份，账号本身还在、登录态仍有效 —— 注销后「重新注册」「回浏览态」都要带着它）
 *
 * ⚠️ 新增任何需要清理的地方都调这里，不要就地写 removeStorageSync。
 */
export function clearIdentityMemory() {
  forgetPreferredRole()
  // 先停轮询再清凭据：否则旧页轮询器拿旧身份继续调接口 → 守卫拒 → 反复弹「当前身份无此权限」
  stopAllPollers()
  uni.removeStorageSync('currentRole')
  uni.removeStorageSync('accountStatus')
  uni.removeStorageSync('devRole')
}

/** 完整退出登录：清身份记忆 + 清 token + 去登录页 */
export function logoutToLogin() {
  clearIdentityMemory()
  uni.removeStorageSync('token')
  uni.reLaunch({ url: '/pages/login/index' })
}
