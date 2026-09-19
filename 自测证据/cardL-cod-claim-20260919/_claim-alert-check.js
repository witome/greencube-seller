/**
 * 卡L · 「客户称已付」只提示一次的机制证明
 *
 * 配送员端提示复用 utils/new-order-alerter.js + utils/new-order-diff.js（同一个纯函数），
 * 本文件直接把**仓库里那份真实的 pickFreshIds** 动态 import 进来跑断言，
 * 证明「新出现的已付标记 → 判为 fresh（提示一次）；已在基线里的不提示；同一单不重复提示」。
 *
 * 跑法： cd backend && node "../自测证据/cardL-cod-claim-20260919/_claim-alert-check.js"
 */
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'new-order-diff.js'),
  'utf8',
)
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(src).toString('base64')

;(async () => {
  const { pickFreshIds } = await import(dataUrl)
  let seen = null
  const pass = []

  // 首轮 = 建基线：1086/1087 已声明已付，1088 还没有
  let r = pickFreshIds(seen, [1086, 1087])
  seen = r.seen
  console.log('首轮（建基线，已付清单 [1086,1087]）→ fresh =', JSON.stringify(r.fresh), '（首轮不提示）')
  pass.push(r.fresh.length === 0)

  // 次轮：1088 也被声明 → 应判为 fresh（提示一次）
  r = pickFreshIds(seen, [1086, 1087, 1088])
  seen = r.seen
  console.log('次轮（1088 新声明）→ fresh =', JSON.stringify(r.fresh), `→ 提示 ${r.fresh.length} 次`)
  pass.push(r.fresh.length === 1 && r.fresh[0] === 1088)

  // 三轮：清单不变 → 不再提示（同一单只提示一次）
  r = pickFreshIds(seen, [1086, 1087, 1088])
  seen = r.seen
  console.log('三轮（无变化）→ fresh =', JSON.stringify(r.fresh), '（同一单不重复提示）')
  pass.push(r.fresh.length === 0)

  // 四轮：又来一单 → 只提示新的那单
  r = pickFreshIds(seen, [1086, 1087, 1088, 1089])
  seen = r.seen
  console.log('四轮（1089 新声明）→ fresh =', JSON.stringify(r.fresh))
  pass.push(r.fresh.length === 1 && r.fresh[0] === 1089)

  console.log('')
  console.log(`断言通过 ${pass.filter(Boolean).length}/${pass.length}`)
  process.exit(pass.every(Boolean) ? 0 : 1)
})().catch((e) => { console.error('CHECK_FAILED', e); process.exit(1) })
