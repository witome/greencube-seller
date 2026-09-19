/**
 * 卡L 造单脚本：准备一个「货到付款 + 已送达(60)」的订单，供下列取证使用
 *   1) curl 采购方「我已付款」声明
 *   2) 采购方订单详情页浏览器 E2E（收款区 + 三个按钮）
 *   3) 配送员任务列表/收款页的「客户称已付」标记
 *
 * 全程走**真实接口**（不直改库），最后打印 orderId / taskId。
 * 跑法： cd backend && node "../自测证据/cardL-cod-claim-20260919/_prep-cod-order.js"
 */
const BASE = 'http://127.0.0.1:3001/api/v1'

async function call(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!json || json.code !== 0) {
    throw new Error(`${method} ${p} → HTTP ${res.status} ${JSON.stringify(json)}`)
  }
  return json.data
}

const login = async (code) => (await call('POST', '/auth/wx-login', { code })).token

;(async () => {
  const bt = await login('buyer')
  const st = await login('demo_supplier')
  const ct = await login('courier')

  // 配送员上线（自动派单只挑 status=1 & online=1 & onRoute=0）
  await call('POST', '/courier/online', { online: 1 }, ct)

  // 取商品，凑一张像真实餐馆单的金额（五花肉 2 斤 + 白菜 3 斤 → 加上运费约 ¥45）
  const goods = await call('GET', '/product/list', null, bt)
  const byName = (n) => goods.list.find((p) => String(p.name).includes(n))
  const meat = byName('五花肉') || goods.list[0]
  const veg = byName('白菜') || goods.list[goods.list.length - 1]
  const items = [
    { productId: meat.id, qty: 2 },
    { productId: veg.id, qty: 3 },
  ]

  // 下单 → 选货到付款（payMethod=2）
  const deliveryDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const created = await call('POST', '/order', { deliveryDate, timeWindow: 1, items }, bt)
  const orderId = created.orderId
  await call('POST', `/order/${orderId}/pay`, { payMethod: 2 }, bt)

  // 供应商备货交接 → 订单进待配送并自动派单给配送员
  await call('POST', '/supplier-fulfill/handover', { orderId }, st)

  // 找到含该订单的任务
  let tasks = await call('GET', '/courier/today-tasks', null, ct)
  const task = tasks.find((t) => (t.stationList || []).some((s) => Number(s.orderId) === orderId))
  if (!task) throw new Error('自动派单未生成任务，订单可能仍是 40 待配送')

  // 取货 → 出发 → 交付确认（订单 50→60 已送达）
  await call('POST', `/courier/task/${task.taskId}/pickup`, null, ct)
  await call('POST', '/courier/depart', null, ct)
  await call('POST', `/courier/task/${task.taskId}/deliver`, { photos: [], signature: 'E2E-PREP' }, ct)

  // 复核
  const detail = await call('GET', `/order/${orderId}`, null, bt)
  const after = await call('GET', '/courier/today-tasks', null, ct)
  const s = (after.find((t) => t.taskId === task.taskId)?.stationList || []).find((x) => Number(x.orderId) === orderId)

  console.log(JSON.stringify({
    orderId,
    taskId: task.taskId,
    status: detail.status,
    payMethod: detail.payMethod,
    amountFinal: detail.amountFinal,
    amountOrdered: detail.amountOrdered,
    deliveryFee: detail.deliveryFee,
    buyerPaidClaimAt: detail.buyerPaidClaimAt,
    paidProofAt: detail.paidProofAt,
    courierStationBuyerPaidClaimAt: s ? s.buyerPaidClaimAt : null,
  }))
})().catch((e) => { console.error('PREP_FAILED', e.message); process.exit(1) })
