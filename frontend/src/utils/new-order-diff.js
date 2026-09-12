/**
 * 新单比对纯函数（2026-09-12 拍板 1A：新单语音提示）
 *
 * 与页面/框架零耦合，便于 Node 侧取证复用（自测证据/新单语音-20260912/diff_test.js
 * 以 data: URL 动态 import 本文件原文跑断言）。
 *
 * 规则：
 * - seen === null：首次拉取 = 建立基线，不播报（避免一进页面就响）
 * - 之后每次传入最新 id 集合，返回不在 seen 里的「新 id」并回填 seen
 * - 同一单只播一次：id 一经 seen 就不再返回（去重）
 * - 订单消失（完成/取消）不影响 seen；同 id 重现会再次播报（业务上应视为提醒）
 */
export function pickFreshIds(seen, ids) {
  const list = Array.isArray(ids) ? ids : []
  if (seen === null) {
    return { fresh: [], seen: new Set(list) }
  }
  const fresh = list.filter((id) => !seen.has(id))
  fresh.forEach((id) => seen.add(id))
  return { fresh, seen }
}
