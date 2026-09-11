// 完整 92 流程回归：驱动一单 30 → 40 → 45 → 50 → 92，再执行 re-split-shortage → 30
// 目的：证明移除「⚡一键拆单」后，缺货二次拆单（re-split-shortage）**端到端仍正常**。
const BASE = 'http://localhost:3001/api/v1'
let ok = 0, ng = 0
const log = (n, c, extra) => { if (c) { ok++; console.log('  ✅ ' + n) } else { ng++; console.log('  ❌ ' + n + (extra ? ' → ' + JSON.stringify(extra) : '')) } }

async function call(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch (e) {}
  return { http: res.status, json }
}

;(async () => {
  console.log('='.repeat(56))
  console.log('完整 92 流程回归（缺货二次拆单端到端）')
  console.log('='.repeat(56))

  const at = (await call('POST', '/auth/wx-login', { code: 'admin' })).json.data.token
  const st = (await call('POST', '/auth/wx-login', { code: 'demo_supplier' })).json.data.token
  const ct = (await call('POST', '/auth/wx-login', { code: 'courier' })).json.data.token

  // 挑一单：status=30 且明细全属供应商 1（demo_supplier）
  const pending = (await call('GET', '/admin/order/pending', null, at)).json.data || []
  const target = pending.find((o) => o.status === 30 && o.items.length === 1)
  if (!target) { log('找到单供应商的 status=30 订单', false, '无候选'); return finish() }
  const orderId = target.orderId
  console.log(`\n选取订单 #${orderId}（status=30，明细 ${target.items.length} 项）\n`)

  // ① 供应商确认备货完成 → 40
  const ho = await call('POST', '/supplier-fulfill/handover', { orderId }, st)
  log(`#${orderId} 供应商确认备货完成 → 40 待配送`, ho.json?.code === 0 && ho.json.data?.status === 40, ho.json)

  // ② 运营派单 → 45
  const dp = await call('POST', '/admin/dispatch', { courierId: 1, orderIds: [orderId] }, at)
  log(`#${orderId} 派单 → 生成任务`, dp.json?.code === 0 && !!dp.json.data?.taskId, dp.json)
  const taskId = dp.json?.data?.taskId

  // ③ 配送员取货 → 50
  const pk = await call('POST', `/courier/task/${taskId}/pickup`, {}, ct)
  log(`任务 #${taskId} 扫码取货`, pk.json?.code === 0, pk.json)

  // ④ 配送员上报缺货（订单级）→ 92
  const rp = await call('POST', '/courier/report', { orderId, reason: '到货不足（回归用例）' }, ct)
  log(`#${orderId} 配送员上报缺货 → 92 无法交付`, rp.json?.code === 0, rp.json)

  // ⑤ 运营缺货二次拆单 → 30
  const rs = await call('POST', `/admin/order/${orderId}/re-split-shortage`, null, at)
  log(`#${orderId} 缺货二次拆单 → 恢复 30 备货中`, rs.json?.code === 0 && rs.json.data?.status === 30, rs.json)

  finish()
})().catch((e) => { console.error(e); process.exit(1) })

function finish() {
  console.log('\n' + '='.repeat(56))
  console.log(`完整 92 流程回归：✅ 通过 ${ok} 项 / ❌ 失败 ${ng} 项`)
  console.log('='.repeat(56))
  process.exit(ng ? 1 : 0)
}
