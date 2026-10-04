// 卡BW-2（2026-10-04）：「本批」连拍提交标记容器 —— 纯内存，模块级 Set。
// 同一 App 运行期内跨页面存活：batch-listing 用 uni.redirectTo 回 goods-manage
// 会重建页面实例，但模块实例不重建，所以列表页拿得到本批 applyId。
// 不落库、不写 storage、不动后端；刷新/重开后自然消失（预期行为，卡BW-2 禁区③）。
// ⚠️ 只有「多张连拍上架」页提交成功的条目才允许 markBatch；老入口「＋ 提交新商品」永不标记。
const ids = new Set()
export function markBatch(applyIds) { (applyIds || []).forEach((i) => ids.add(Number(i))) }
export function isBatch(applyId) { return applyId != null && ids.has(Number(applyId)) }
export function clearBatch() { ids.clear() }
