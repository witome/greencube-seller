/**
 * 卡BJ（2026-10-02）· 供应商「开始备货」接单 ＋ 运营后台状态同步 自测
 *
 * 覆盖（任务书第五节 7 项）：
 *   1. 供应商 A 对名下订单接单 → 200 且 ackAt 非空；stock-list 该单 ackAt 有值
 *   2. 重复接单幂等：再调一次 → 200、ackAt 与第一次完全相同；库中仍只有 1 行
 *   3. 越权：供应商 B 对名下无明细的订单接单 → 拒绝（FORBIDDEN），库中不产生新记录
 *   4. 非「备货中」订单接单 → 拒绝（ORDER_STATUS_INVALID），库中不产生新记录
 *   5. pendingList 的 supplierAcks 能反映「已接单（有时间）」与「未接单（null）」两种
 *   6. 订单状态未被改动：接单前后订单 status 不变；order_item 数量/单价逐字段不变
 *   7. 审计有 SUPPLIER_ACK 记录
 *
 * 用法（backend 目录）：node scripts/supplier-ack-test.js
 * 前置：后端已起（3001）且 mock 登录可用（code → openid 规则 dev_<code>）。
 *
 * 数据安全边界（与既有脚本同款）：
 *   - 采购方/供应商/订单/明细全部自造、跑完删除，报告「残留=0」；
 *   - 不碰任何既有订单/供应商/商品；接单只发生在自造订单上。
 */
const BASE = process.env.BJ_TEST_BASE || 'http://127.0.0.1:3001/api/v1'
const fs = require('fs')
const path = require('path')
// 与仓库其它脚本一致：自己加载 backend/.env（Prisma 不自动读）
try {
  const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  for (const line of envTxt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
} catch (e) {
  console.error('读取 backend/.env 失败：', e.message)
}
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail !== undefined ? `  → 实际：${JSON.stringify(detail)}` : ''}`) }
}

async function api(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  let j = null
  try { j = await res.json() } catch (e) { /* 非 JSON */ }
  return { status: res.status, json: j, data: j?.data, code: j?.code, msg: j?.msg }
}

const TS = Date.now()
const TAG = `卡BJ自测${TS}`

const created = {
  userIds: [], purchaserIds: [], supplierIds: [], orderIds: [], orderItemIds: [], ackIds: [],
}

const mkOrder = (purchaserId, status) =>
  prisma.order.create({
    data: {
      purchaserId, deliveryDate: new Date(), timeWindow: 2, status,
      amountOrdered: 100, deliveryFee: 5, payMethod: 2, remark: TAG,
    },
  })

const mkItem = (orderId, productId, supplierId) =>
  prisma.orderItem.create({
    data: {
      orderId, productId, supplierId,
      qtyOrdered: 10, qtyDeclared: 10, qtyAccepted: null, // 备货中未验收，才会出现在备货单里
      salePrice: 2.5, supplyPrice: 2,
    },
  })

const itemSnap = (it) => ({
  qtyOrdered: Number(it.qtyOrdered), qtyDeclared: it.qtyDeclared === null ? null : Number(it.qtyDeclared),
  qtyAccepted: it.qtyAccepted === null ? null : Number(it.qtyAccepted),
  salePrice: Number(it.salePrice), supplyPrice: it.supplyPrice === null ? null : Number(it.supplyPrice),
})

async function main() {
  console.log('='.repeat(64))
  console.log('卡BJ · 供应商开始备货接单 自测（' + new Date().toISOString() + '）')
  console.log('='.repeat(64))
  const testStart = new Date()

  // ════ 0. fixture：自造 采购方 + 两个供应商 + 3 张订单 ════
  console.log('\n【0】准备自造数据（不碰任何既有业务数据）')
  const product = await prisma.product.findFirst({ where: { status: 1 } })
  if (!product) throw new Error('库里没有在售商品，无法造订单明细')

  const buyerUser = await prisma.user.create({ data: { wxOpenid: `dev_bjbuy_${TS}`, name: TAG + '买家', roles: [], status: 1 } })
  created.userIds.push(buyerUser.id)
  const purchaser = await prisma.purchaser.create({
    data: { userId: buyerUser.id, shopName: TAG + '餐馆', contact: '卡BJ', phone: '137' + String(TS).slice(-8), address: TAG + '地址', deliveryWindows: ['中 10-13'], accountStatus: 2 },
  })
  created.purchaserIds.push(purchaser.id)

  const mkSupplier = async (suffix, stall) => {
    const u = await prisma.user.create({ data: { wxOpenid: `dev_bj${suffix}_${TS}`, name: TAG + stall, roles: [], status: 1 } })
    created.userIds.push(u.id)
    const s = await prisma.supplier.create({ data: { userId: u.id, stallName: TAG + stall, address: TAG, status: 1, qualification: {} } })
    created.supplierIds.push(s.id)
    return s
  }
  const supA = await mkSupplier('supa', '档口A') // 接单方
  const supB = await mkSupplier('supb', '档口B') // 越权方 / 同单未接单方

  // O1：备货中(30)，A、B 各有一条明细 —— 主角（接单/幂等/pendingList 两种状态同单体现）
  const O1 = await mkOrder(purchaser.id, 30)
  const O1itemA = await mkItem(O1.id, product.id, supA.id)
  const O1itemB = await mkItem(O1.id, product.id, supB.id)
  // O2：待确认(10)，A 的明细 —— 非「备货中」拒接单
  const O2 = await mkOrder(purchaser.id, 10)
  const O2itemA = await mkItem(O2.id, product.id, supA.id)
  // O3：备货中(30)，仅 A 的明细 —— B 越权目标
  const O3 = await mkOrder(purchaser.id, 30)
  const O3itemA = await mkItem(O3.id, product.id, supA.id)
  created.orderIds.push(O1.id, O2.id, O3.id)
  created.orderItemIds.push(O1itemA.id, O1itemB.id, O2itemA.id, O3itemA.id)

  // 状态/数量/单价快照（第 6 项：全程不变）
  const snapOrders = new Map()
  for (const o of [O1, O2, O3]) snapOrders.set(Number(o.id), { status: o.status })
  const snapItems = new Map()
  for (const it of [O1itemA, O1itemB, O2itemA, O3itemA]) snapItems.set(Number(it.id), itemSnap(it))

  const login = async (code) => {
    const r = await api('POST', '/auth/wx-login', { code })
    if (r.code !== 0) throw new Error(`登录失败(${code})：${JSON.stringify(r.json)}`)
    return r.data.token
  }
  const tokenA = await login(`bjsupa_${TS}`)
  const tokenB = await login(`bjsupb_${TS}`)
  const tokenAdmin = await login('admin')
  check('三个测试账号登录成功', !!tokenA && !!tokenB && !!tokenAdmin)

  // ════ 1. 正常接单 ════
  console.log('\n【1】供应商 A 对名下订单 O1 接单 → 200 且 ackAt 非空；stock-list 可见')
  let r = await api('POST', '/supplier-fulfill/ack', { orderId: Number(O1.id) }, tokenA)
  check('1a 接口 code=0', r.code === 0, { status: r.status, code: r.code, msg: r.msg })
  const firstAckAt = r.data?.ackAt
  check('1b ackAt 非空（ISO 串）', typeof firstAckAt === 'string' && !Number.isNaN(new Date(firstAckAt).getTime()), firstAckAt)
  const dbRow1 = await prisma.orderSupplierAck.findUnique({
    where: { orderId_supplierId: { orderId: O1.id, supplierId: supA.id } },
  })
  check('1c 库中落行 ackAt 有值', !!dbRow1?.ackAt, dbRow1)
  if (dbRow1) created.ackIds.push(dbRow1.id)
  const sl = await api('GET', '/supplier-fulfill/stock-list', null, tokenA)
  const slO1 = (sl.data || []).find((x) => x.orderId === Number(O1.id))
  check('1d stock-list 里 O1 的 ackAt 有值', slO1 && typeof slO1.ackAt === 'string' && !!slO1.ackAt, slO1?.ackAt)

  // ════ 2. 幂等 ════
  console.log('\n【2】重复接单幂等')
  r = await api('POST', '/supplier-fulfill/ack', { orderId: Number(O1.id) }, tokenA)
  check('2a 再次调用 code=0', r.code === 0, { status: r.status, code: r.code, msg: r.msg })
  check('2b ackAt 与第一次完全相同', r.data?.ackAt === firstAckAt, { first: firstAckAt, second: r.data?.ackAt })
  const dbRowCnt = await prisma.orderSupplierAck.count({ where: { orderId: O1.id, supplierId: supA.id } })
  check('2c 库中仍只有 1 行', dbRowCnt === 1, dbRowCnt)

  // ════ 3. 越权 ════
  console.log('\n【3】供应商 B 对名下无明细的订单 O3 接单 → 拒绝，不产生记录')
  r = await api('POST', '/supplier-fulfill/ack', { orderId: Number(O3.id) }, tokenB)
  check('3a 被拒绝（FORBIDDEN，业务码 2002 / HTTP 403）', r.code === 2002 || r.status === 403, { status: r.status, code: r.code, msg: r.msg })
  const bRowCnt = await prisma.orderSupplierAck.count({ where: { orderId: O3.id, supplierId: supB.id } })
  check('3b 库中未产生 (O3, B) 记录', bRowCnt === 0, bRowCnt)

  // ════ 4. 非「备货中」拒接单 ════
  console.log('\n【4】待确认(10)订单 O2 接单 → 拒绝')
  r = await api('POST', '/supplier-fulfill/ack', { orderId: Number(O2.id) }, tokenA)
  check('4a 被拒绝（ORDER_STATUS_INVALID，业务码 3002）', r.code === 3002 || r.status === 422 || r.status === 400, { status: r.status, code: r.code, msg: r.msg })
  const o2RowCnt = await prisma.orderSupplierAck.count({ where: { orderId: O2.id } })
  check('4b 库中未产生 O2 记录', o2RowCnt === 0, o2RowCnt)

  // ════ 5. 运营 pendingList 的 supplierAcks ════
  console.log('\n【5】pendingList 的 supplierAcks：同一单内 已接单（有时间）与 未接单（null）并存')
  const pl = await api('GET', '/admin/order/pending', null, tokenAdmin)
  check('5a pendingList 接口 code=0', pl.code === 0, { status: pl.status, code: pl.code })
  const plO1 = (pl.data || []).find((x) => x.orderId === Number(O1.id))
  const ackA = plO1?.supplierAcks?.find((a) => a.supplierId === Number(supA.id))
  const ackB = plO1?.supplierAcks?.find((a) => a.supplierId === Number(supB.id))
  check('5b O1 的 supplierAcks 覆盖 A、B 两个供应商', plO1?.supplierAcks?.length === 2, plO1?.supplierAcks)
  check('5c A 已接单（ackAt 有值、供应商名正确）', ackA && !!ackA.ackAt && ackA.supplierName.includes('档口A'), ackA)
  check('5d B 未接单（ackAt = null）', ackB && ackB.ackAt === null, ackB)
  const plO3 = (pl.data || []).find((x) => x.orderId === Number(O3.id))
  const ackO3A = plO3?.supplierAcks?.find((a) => a.supplierId === Number(supA.id))
  check('5e O3（未接单侧样例）A 的 ackAt = null', ackO3A && ackO3A.ackAt === null, ackO3A)

  // ════ 6. 订单状态/明细数量单价零改动 ════
  console.log('\n【6】订单状态未被改动；order_item 数量/单价一律不变')
  let allSame = true
  for (const [oid, snap] of snapOrders) {
    const o = await prisma.order.findUnique({ where: { id: BigInt(oid) }, select: { status: true } })
    if (!o || o.status !== snap.status) { allSame = false; console.log(`    订单 ${oid} status ${snap.status} → ${o?.status}`) }
  }
  check('6a 三张订单 status 与开局快照一致（30/10/30）', allSame)
  allSame = true
  for (const [iid, snap] of snapItems) {
    const it = await prisma.orderItem.findUnique({ where: { id: BigInt(iid) } })
    if (!it || JSON.stringify(itemSnap(it)) !== JSON.stringify(snap)) {
      allSame = false
      console.log(`    明细 ${iid}：${JSON.stringify(snap)} → ${it ? JSON.stringify(itemSnap(it)) : 'missing'}`)
    }
  }
  check('6b 四条明细 五数量/单价 与开局快照逐字段一致', allSame)

  // ════ 7. 审计 ════
  console.log('\n【7】审计有 SUPPLIER_ACK 记录')
  const audits = await prisma.$queryRawUnsafe(
    `SELECT id, action, entity, entity_id FROM audit_log WHERE created_at >= ? AND action = 'SUPPLIER_ACK' ORDER BY id DESC`,
    testStart,
  )
  const ackAudit = audits.find((a) => Number(a.entity_id) === Number(O1.id))
  check('7a 存在 SUPPLIER_ACK 审计（entity=order, entityId=O1）', !!ackAudit && audits.length === 1, audits)

  // ════ 清理 ════
  console.log('\n【清理】删除自造数据（接单行/明细/订单/供应商/用户），断言残留=0')
  await prisma.orderSupplierAck.deleteMany({ where: { orderId: { in: created.orderIds } } })
  await prisma.orderItem.deleteMany({ where: { id: { in: created.orderItemIds.map((i) => BigInt(i)) } } })
  await prisma.order.deleteMany({ where: { id: { in: created.orderIds.map((i) => BigInt(i)) } } })
  await prisma.supplier.deleteMany({ where: { id: { in: created.supplierIds.map((i) => BigInt(i)) } } })
  await prisma.purchaser.deleteMany({ where: { id: { in: created.purchaserIds.map((i) => BigInt(i)) } } })
  await prisma.user.deleteMany({ where: { id: { in: created.userIds.map((i) => BigInt(i)) } } })
  // 审计行保留（审计只增不改是原则），不删

  const residualOrders = await prisma.order.count({ where: { remark: TAG } })
  const residualSuppliers = await prisma.supplier.count({ where: { stallName: { contains: TAG } } })
  const residualUsers = await prisma.user.count({ where: { wxOpenid: { contains: `_${TS}` } } })
  const residualAcks = await prisma.orderSupplierAck.count({ where: { orderId: { in: created.orderIds.map((i) => BigInt(i)) } } })
  check('清理后 订单残留 = 0', residualOrders === 0, residualOrders)
  check('清理后 供应商残留 = 0', residualSuppliers === 0, residualSuppliers)
  check('清理后 用户残留 = 0', residualUsers === 0, residualUsers)
  check('清理后 接单行残留 = 0', residualAcks === 0, residualAcks)

  // ════ 汇总 ════
  console.log('\n' + '='.repeat(64))
  console.log(`结果：${pass} 通过 / ${fail} 失败`)
  if (failures.length) {
    console.log('失败项：')
    for (const f of failures) console.log('  - ' + f)
  }
  console.log('='.repeat(64))
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('脚本异常：', e)
  try { await prisma.$disconnect() } catch (_) {}
  process.exit(1)
})
