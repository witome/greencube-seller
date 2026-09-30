/**
 * 卡AE（2026-09-30）· 售后台账（线下处理版）—— 端到端自测
 *
 * 覆盖任务书「第五节 验收判据」1~10：
 *   1  未送达（30/…）的单 → 提交售后被拒，且 aftersale_order 无新行
 *   2  已送达/已完成/已结算（60/70/90）→ 能提，且落库口径正确
 *   3  交付时间改到 25 小时前 → 被拒；23 小时前 → 通过（**造时间改库，不改前端**）
 *   4  不传 orderItemId / 传别单的明细 / 数量超上限 → 被拒
 *   5  type=2（品质问题）不传照片 → 被拒
 *   6  同明细+同类型重复提 → 被拒；不同类型 → 通过
 *   7  确认收货（拒收量 > 0）→ 不再产生任何售后单，且 qtyReceived/rejectReason 正常写入
 *   8  后台「处理完成」：说明为空 → 被拒；不传金额与方式 → 能完成，状态转 2
 *   9  供应商端接口：只返回本档口工单；未拆单的工单不出现；pendingCount 与库内 status=0 条数一致
 *  10  钱一分没动：处理完成前后 settlement / 账单 / 订单 / order_item 数量逐字段相等
 *  11  跑完清理自造数据，并断言「残留 = 0」
 *
 * 用法（backend 目录）：
 *   node scripts/aftersale-ledger-test.js
 *   AE_TEST_BASE=http://127.0.0.1:3011/api/v1 node scripts/aftersale-ledger-test.js
 *
 * ⚠️ 前置：后端已起（3001）且 WX_MOCK_LOGIN=1（mock 登录下 code → openid 规则为 dev_<code>）
 * ⚠️ 本脚本必须自己加载 backend/.env（Prisma 不自动读 .env），写法与 account-cancel-test.js 一致
 */
const BASE = process.env.AE_TEST_BASE || 'http://127.0.0.1:3001/api/v1'
const fs = require('fs')
const path = require('path')
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
const round2 = (n) => Math.round(Number(n) * 100) / 100

const call = async (p, opts = {}) => {
  const res = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}
const login = async (code) => {
  const r = await call('/auth/wx-login', { method: 'POST', body: { code } })
  if (r.body.code !== 0) throw new Error(`登录失败(${code})：${JSON.stringify(r.body)}`)
  return r.body.data
}

const TS = Date.now()
const BUYER_OPENID = `dev_ae_${TS}`
const SUP_OPENID = `dev_aesup_${TS}`
const HOUR = 3600 * 1000

/// 自造数据登记（清理与「残留=0」复核全靠它）
const created = {
  userIds: [], purchaserIds: [], supplierIds: [], orderIds: [], orderItemIds: [],
  aftersaleIds: [], taskIds: [], auditIds: [], settlementIds: [],
}

const mkOrder = (purchaserId, status, opts = {}) =>
  prisma.order.create({
    data: {
      purchaserId,
      deliveryDate: new Date(),
      timeWindow: 2,
      status,
      amountOrdered: opts.amountOrdered ?? 100,
      amountFinal: opts.amountFinal ?? null,
      deliveryFee: opts.deliveryFee ?? 5,
      payMethod: opts.payMethod ?? 0,
      remark: '卡AE自测',
    },
  })

const mkItem = (orderId, productId, opts = {}) =>
  prisma.orderItem.create({
    data: {
      orderId,
      productId,
      supplierId: opts.supplierId ?? null,
      qtyOrdered: opts.qtyOrdered ?? 10,
      qtyAccepted: opts.qtyAccepted ?? 10,
      qtyReceived: opts.qtyReceived ?? 10,
      salePrice: opts.salePrice ?? 2.5,
      supplyPrice: opts.supplyPrice ?? 2,
    },
  })

/// 造「交付确认时间」（= delivery_task.completed_at，任务经 stationList JSON 里 orderId 关联）
const mkDeliveryTask = async (orderId, completedAt, courierId) => {
  const t = await prisma.deliveryTask.create({
    data: {
      courierId,
      routeNo: `AE-${TS}-${Number(orderId)}`,
      stationList: [{ orderId: Number(orderId), type: 'deliver', seq: 1 }],
      status: 3,
      completedAt,
    },
  })
  created.taskIds.push(t.id)
  return t
}

/// 提交售后的统一入口（前端页面的等价调用）
const submit = (token, body) => call('/buyer/aftersale', { method: 'POST', token, body })

const main = async () => {
  console.log(`\n═══ 卡AE 售后台账（线下处理版）自测 · BASE=${BASE} ═══\n`)

  // ────────────────────────────────────────
  // 0. fixture
  // ────────────────────────────────────────
  console.log('【0】准备自造数据')
  const product = await prisma.product.findFirst({ where: { status: 1 } })
  if (!product) throw new Error('库里没有在售商品，无法造订单明细')
  const courier = await prisma.courier.findFirst()

  const user = await prisma.user.create({
    data: { wxOpenid: BUYER_OPENID, name: '卡AE测试', phone: '136' + String(TS).slice(-8), roles: [], status: 1 },
  })
  created.userIds.push(user.id)
  const purchaser = await prisma.purchaser.create({
    data: {
      userId: user.id, shopName: '卡AE测试餐馆', contact: '卡AE', phone: '136' + String(TS).slice(-8),
      address: '卡AE测试地址', deliveryWindows: ['中 10-13'], accountStatus: 2,
    },
  })
  created.purchaserIds.push(purchaser.id)

  // 本档口（判据 9 的「归属本供应商」主体）：自造一个供应商，不碰 demo_supplier 的存量数据
  const supUser = await prisma.user.create({
    data: { wxOpenid: SUP_OPENID, name: '卡AE供应商', roles: [], status: 1 },
  })
  created.userIds.push(supUser.id)
  const supplier = await prisma.supplier.create({
    data: { userId: supUser.id, stallName: '卡AE测试档口', address: '卡AE', status: 1, qualification: {} },
  })
  created.supplierIds.push(supplier.id)
  // 别家档口（判据 9：它名下的工单**不能**出现在本档口列表里）
  const otherSupUser = await prisma.user.create({
    data: { wxOpenid: SUP_OPENID + '_other', name: '卡AE别家供应商', roles: [], status: 1 },
  })
  created.userIds.push(otherSupUser.id)
  const otherSupplier = await prisma.supplier.create({
    data: { userId: otherSupUser.id, stallName: '卡AE别家档口', address: '卡AE', status: 1, qualification: {} },
  })
  created.supplierIds.push(otherSupplier.id)

  const buyer = await login(`ae_${TS}`)
  const bt = buyer.token
  const sup = await login(`aesup_${TS}`)
  const st = sup.token
  const admin = await login('admin')
  const at = admin.token

  // 订单 + 明细 + 交付任务
  const oNotDelivered = await mkOrder(purchaser.id, 30)                 // 判据 1：未送达
  const oDelivered = await mkOrder(purchaser.id, 60)                    // 判据 2/4/5/6/8/10：已送达
  const oFresh = await mkOrder(purchaser.id, 70)                        // 判据 3：交付 23h 前
  const oSettled = await mkOrder(purchaser.id, 90)                      // 判据 2：已结算
  const oOld = await mkOrder(purchaser.id, 70)                          // 判据 3：交付 25h 前
  const oNoTask = await mkOrder(purchaser.id, 60)                       // 判据 3：查不到交付时间
  const oReceive = await mkOrder(purchaser.id, 60)                      // 判据 7：确认收货不建单
  const oOther = await mkOrder(purchaser.id, 60)                        // 判据 9：别家档口的工单
  const oUnassigned = await mkOrder(purchaser.id, 60)                   // 判据 9：未拆单（supplier_id=null）
  created.orderIds.push(oNotDelivered.id, oDelivered.id, oFresh.id, oSettled.id, oOld.id, oNoTask.id, oReceive.id, oOther.id, oUnassigned.id)

  const itemA = await mkItem(oNotDelivered.id, product.id, { supplierId: supplier.id })
  const itemB = await mkItem(oDelivered.id, product.id, { supplierId: supplier.id, qtyReceived: 10, salePrice: 2.5 })
  const itemD = await mkItem(oFresh.id, product.id, { supplierId: supplier.id })
  const itemE = await mkItem(oSettled.id, product.id, { supplierId: supplier.id })
  const itemC = await mkItem(oOld.id, product.id, { supplierId: supplier.id })
  const itemNoTask = await mkItem(oNoTask.id, product.id, { supplierId: supplier.id })
  const itemF = await mkItem(oReceive.id, product.id, { supplierId: supplier.id, qtyReceived: null })
  const itemG = await mkItem(oOther.id, product.id, { supplierId: otherSupplier.id })
  const itemH = await mkItem(oUnassigned.id, product.id, { supplierId: null })
  created.orderItemIds.push(itemA.id, itemB.id, itemD.id, itemE.id, itemC.id, itemNoTask.id, itemF.id, itemG.id, itemH.id)

  await mkDeliveryTask(oDelivered.id, new Date(Date.now() - 1 * HOUR), courier?.id ?? BigInt(1))
  await mkDeliveryTask(oFresh.id, new Date(Date.now() - 23 * HOUR), courier?.id ?? BigInt(1))
  await mkDeliveryTask(oSettled.id, new Date(Date.now() - 1 * HOUR), courier?.id ?? BigInt(1))
  await mkDeliveryTask(oOld.id, new Date(Date.now() - 25 * HOUR), courier?.id ?? BigInt(1))

  console.log(`  自造：purchaser=${Number(purchaser.id)} 供应商=${Number(supplier.id)} 订单 9 张 / 明细 9 条\n`)

  const countAftersale = (orderId) => prisma.aftersaleOrder.count({ where: { orderId } })

  // ────────────────────────────────────────
  // 判据 1：未送达 → 拒 + 无新行
  // ────────────────────────────────────────
  console.log('【判据 1】未送达（30 备货中）→ 提交售后被拒，且 aftersale_order 无新行')
  let r = await submit(bt, { orderId: Number(oNotDelivered.id), orderItemId: Number(itemA.id), type: 1, qtyDiff: 1, reason: '未送达不该能提' })
  console.log('  ' + JSON.stringify(r.body))
  check('1.1 code≠0（被拒）', r.body.code !== 0, r.body)
  check('1.2 用订单状态错误码 3002', r.body.code === 3002, r.body.code)
  check('1.3 人话点出「送达」', /送达/.test(r.body.msg || ''), r.body.msg)
  check('1.4 aftersale_order 无新行', (await countAftersale(oNotDelivered.id)) === 0)

  // ────────────────────────────────────────
  // 判据 2：60 / 70 / 90 → 能提 + 落库口径
  // ────────────────────────────────────────
  console.log('\n【判据 2】已送达(60)/已完成(70)/已结算(90) → 能提，且落库口径正确')
  r = await submit(bt, { orderId: Number(oDelivered.id), orderItemId: Number(itemB.id), type: 1, qtyDiff: 1, reason: '送到时少了 1 斤' })
  console.log('  ' + JSON.stringify(r.body))
  check('2.1 已送达(60) 能提', r.body.code === 0 && r.body.data?.aftersaleId > 0, r.body)
  const t1Id = r.body.data?.aftersaleId
  created.aftersaleIds.push(BigInt(t1Id))
  const t1 = await prisma.aftersaleOrder.findUnique({ where: { id: BigInt(t1Id) } })
  check('2.2 orderId 由明细反查（= oDelivered）', t1.orderId === oDelivered.id, { got: Number(t1.orderId), want: Number(oDelivered.id) })
  check('2.3 orderItemId = 客户选的明细', t1.orderItemId === itemB.id)
  check('2.4 qtyDiff = 客户填报的涉及数量', Number(t1.qtyDiff) === 1, Number(t1.qtyDiff))
  check('2.5 amountDiff = qtyDiff × 成交价（1 × 2.50）', Number(t1.amountDiff) === 2.5, Number(t1.amountDiff))
  check('2.6 status = 0 待处理', t1.status === 0, t1.status)
  check('2.7 客户填报数量被服务端接受（不信任前端算的金额）',
    Number(t1.amountDiff) === round2(Number(t1.qtyDiff) * 2.5), { qtyDiff: Number(t1.qtyDiff), amountDiff: Number(t1.amountDiff) })

  const rFresh = await submit(bt, { orderId: Number(oFresh.id), orderItemId: Number(itemD.id), type: 1, qtyDiff: 1, reason: '已完成单也能提' })
  check('2.8 已完成(70) 能提', rFresh.body.code === 0, rFresh.body)
  if (rFresh.body.data?.aftersaleId) created.aftersaleIds.push(BigInt(rFresh.body.data.aftersaleId))
  const rSettled = await submit(bt, { orderId: Number(oSettled.id), orderItemId: Number(itemE.id), type: 4, qtyDiff: 1, reason: '已结算单也能提' })
  check('2.9 已结算(90) 能提', rSettled.body.code === 0, rSettled.body)
  if (rSettled.body.data?.aftersaleId) created.aftersaleIds.push(BigInt(rSettled.body.data.aftersaleId))

  // ────────────────────────────────────────
  // 判据 3：24 小时门槛（造时间 = 直改 delivery_task.completed_at）
  // ────────────────────────────────────────
  console.log('\n【判据 3】签收后 24 小时门槛（改库造时间）')
  r = await submit(bt, { orderId: Number(oOld.id), orderItemId: Number(itemC.id), type: 1, qtyDiff: 1, reason: '25 小时前签收' })
  console.log('  25h → ' + JSON.stringify(r.body))
  check('3.1 交付 25 小时前 → 被拒(3002)', r.body.code === 3002, r.body)
  check('3.2 人话点出「24 小时」', /24 小时/.test(r.body.msg || ''), r.body.msg)
  check('3.3 被拒后无新行', (await countAftersale(oOld.id)) === 0)

  // 边界重造：把同一条任务改到 23 小时前 → 应通过（证明判的是时间差，不是别的）
  const oldTask = await prisma.deliveryTask.findFirst({ where: { stationList: { array_contains: { orderId: Number(oOld.id) } } } })
  await prisma.deliveryTask.update({ where: { id: oldTask.id }, data: { completedAt: new Date(Date.now() - 23 * HOUR) } })
  r = await submit(bt, { orderId: Number(oOld.id), orderItemId: Number(itemC.id), type: 1, qtyDiff: 1, reason: '23 小时前签收' })
  console.log('  23h（同一单改时间后）→ ' + JSON.stringify(r.body))
  check('3.4 交付 23 小时前 → 通过', r.body.code === 0, r.body)
  if (r.body.data?.aftersaleId) created.aftersaleIds.push(BigInt(r.body.data.aftersaleId))

  r = await submit(bt, { orderId: Number(oNoTask.id), orderItemId: Number(itemNoTask.id), type: 1, qtyDiff: 1, reason: '查不到交付时间' })
  console.log('  无交付时间 → ' + JSON.stringify(r.body))
  check('3.5 取不到交付时间（没交付过）→ 被拒', r.body.code === 3002, r.body)
  check('3.6 被拒后无新行', (await countAftersale(oNoTask.id)) === 0)

  // ────────────────────────────────────────
  // 判据 4：商品必选 + 属于本单 + 数量上限
  // ────────────────────────────────────────
  console.log('\n【判据 4】不传 orderItemId / 传别单的明细 / 数量超上限 → 被拒')
  r = await submit(bt, { orderId: Number(oDelivered.id), type: 1, qtyDiff: 1, reason: '不传商品' })
  console.log('  不传 orderItemId → ' + JSON.stringify(r.body))
  check('4.1 不传 orderItemId → 参数错(1001)', r.body.code === 1001, r.body)

  r = await submit(bt, { orderId: Number(oFresh.id), orderItemId: Number(itemB.id), type: 1, qtyDiff: 1, reason: '拿别单的明细' })
  console.log('  明细不属于所传订单 → ' + JSON.stringify(r.body))
  check('4.2 明细与所传订单不一致 → 参数错(1001)', r.body.code === 1001, r.body)
  check('4.2b 拒因点出「不属于该订单」', /不属于该订单/.test(r.body.msg || ''), r.body.msg)
  check('4.3 被拒后无新行', (await countAftersale(oFresh.id)) === 1) // 只有判据 2 那一张

  // 真正的越权：拿**别的采购方**的订单明细来提
  const otherPurchaser = await prisma.purchaser.create({
    data: {
      userId: (await prisma.user.create({ data: { wxOpenid: `dev_ae2_${TS}`, name: '卡AE别家采购方', roles: [], status: 1 } })).id,
      shopName: '卡AE别家餐馆', contact: '别家', phone: '135' + String(TS).slice(-8), address: '别家地址', accountStatus: 2,
    },
  })
  created.userIds.push(otherPurchaser.userId)
  created.purchaserIds.push(otherPurchaser.id)
  const oForeign = await mkOrder(otherPurchaser.id, 60)
  created.orderIds.push(oForeign.id)
  await mkDeliveryTask(oForeign.id, new Date(Date.now() - 1 * HOUR), courier?.id ?? BigInt(1))
  const itemForeign = await mkItem(oForeign.id, product.id, { supplierId: supplier.id })
  created.orderItemIds.push(itemForeign.id)

  r = await submit(bt, { orderId: Number(oForeign.id), orderItemId: Number(itemForeign.id), type: 1, qtyDiff: 1, reason: '越权提别家的单' })
  console.log('  拿别家的明细 → ' + JSON.stringify(r.body))
  check('4.3b 别人的订单明细 → 被拒(1001)', r.body.code === 1001, r.body)
  check('4.3c 被拒后别家订单无新行', (await countAftersale(oForeign.id)) === 0)

  r = await submit(bt, { orderId: Number(oDelivered.id), orderItemId: Number(itemB.id), type: 1, qtyDiff: 99, reason: '数量超上限' })
  console.log('  数量 99 > 收货 10 → ' + JSON.stringify(r.body))
  check('4.4 涉及数量超上限 → 被拒(1001)', r.body.code === 1001, r.body)
  check('4.5 被拒后无新行', (await countAftersale(oDelivered.id)) === 1)

  // ────────────────────────────────────────
  // 判据 5：品质问题必须传照片
  // ────────────────────────────────────────
  console.log('\n【判据 5】type=2（品质问题）不传照片 → 被拒')
  r = await submit(bt, { orderId: Number(oDelivered.id), orderItemId: Number(itemB.id), type: 2, qtyDiff: 1, reason: '叶子发黄' })
  console.log('  ' + JSON.stringify(r.body))
  check('5.1 type=2 无照片 → 被拒(1001)', r.body.code === 1001, r.body)
  check('5.2 人话点出「照片」', /照片/.test(r.body.msg || ''), r.body.msg)
  check('5.3 被拒后无新行', (await countAftersale(oDelivered.id)) === 1)

  // ────────────────────────────────────────
  // 判据 6：防重复（同明细 + 同类型）
  // ────────────────────────────────────────
  console.log('\n【判据 6】同明细同类型重复提 → 被拒；不同类型 → 通过')
  r = await submit(bt, { orderId: Number(oDelivered.id), orderItemId: Number(itemB.id), type: 1, qtyDiff: 1, reason: '重复提同类' })
  console.log('  同明细同类型（type=1，已有未闭环）→ ' + JSON.stringify(r.body))
  check('6.1 同明细同类型重复 → 被拒(1001)', r.body.code === 1001, r.body)
  check('6.2 被拒后无新行', (await countAftersale(oDelivered.id)) === 1)

  r = await submit(bt, {
    orderId: Number(oDelivered.id), orderItemId: Number(itemB.id), type: 2, qtyDiff: 1, reason: '品质问题',
    attachments: ['/uploads/ae_test_1.jpg'],
  })
  console.log('  同明细不同类型（type=2 + 照片）→ ' + JSON.stringify(r.body))
  check('6.3 同明细不同类型 → 通过', r.body.code === 0, r.body)
  if (r.body.data?.aftersaleId) created.aftersaleIds.push(BigInt(r.body.data.aftersaleId))
  check('6.4 现在该单有 2 张工单（type=1 + type=2）', (await countAftersale(oDelivered.id)) === 2)

  // ────────────────────────────────────────
  // 判据 7：确认收货不再自动建售后单
  // ────────────────────────────────────────
  console.log('\n【判据 7】确认收货（拒收量 > 0）→ 不再产生售后单；qtyReceived/rejectReason 照常写入')
  const beforeReceive = await countAftersale(oReceive.id)
  const recv = await call(`/order/${Number(oReceive.id)}/receive`, {
    method: 'POST', token: bt,
    body: { items: [{ orderItemId: Number(itemF.id), qtyReceived: 8, rejectQty: 2, rejectReason: '卡AE测试拒收' }] },
  })
  console.log('  ' + JSON.stringify(recv.body))
  check('7.1 确认收货成功（订单→70）', recv.body.code === 0 && recv.body.data?.status === 70, recv.body)
  check('7.2 返回的 aftersaleIds 为空数组', Array.isArray(recv.body.data?.aftersaleIds) && recv.body.data.aftersaleIds.length === 0, recv.body.data?.aftersaleIds)
  check('7.3 aftersale_order 计数前后相等（零新增）', (await countAftersale(oReceive.id)) === beforeReceive, { before: beforeReceive, after: await countAftersale(oReceive.id) })
  const itemFAfter = await prisma.orderItem.findUnique({ where: { id: itemF.id } })
  check('7.4 qtyReceived 正常写入(=8)', Number(itemFAfter.qtyReceived) === 8, Number(itemFAfter.qtyReceived))
  check('7.5 rejectReason 正常写入', itemFAfter.rejectReason === '卡AE测试拒收', itemFAfter.rejectReason)

  // ────────────────────────────────────────
  // 判据 8 + 10：处理完成（说明必填 / 金额方式选填）+ 钱一分没动
  // ────────────────────────────────────────
  console.log('\n【判据 8】后台「处理完成」：说明为空 → 被拒；不传金额与方式 → 能完成')
  r = await call(`/admin/aftersale/${t1Id}/handle`, { method: 'POST', token: at, body: { action: 'compensate', handleRemark: '   ' } })
  console.log('  纯空格说明 → ' + JSON.stringify(r.body))
  check('8.1 处理说明为空白 → 被拒(1001)', r.body.code === 1001, r.body)
  r = await call(`/admin/aftersale/${t1Id}/handle`, { method: 'POST', token: at, body: { action: 'compensate' } })
  console.log('  完全不传说明 → ' + JSON.stringify(r.body))
  check('8.2 完全不传处理说明 → 被拒(1001)', r.body.code === 1001, r.body)
  const t1Still = await prisma.aftersaleOrder.findUnique({ where: { id: BigInt(t1Id) } })
  check('8.3 被拒后工单未被改动（仍 status=0 / handledAt=null）', t1Still.status === 0 && t1Still.handledAt === null, { status: t1Still.status, handledAt: t1Still.handledAt })

  // ── 判据 10 的「处理前」快照 ──
  const sellRow = await prisma.settlement.upsert({
    where: { supplierId_period: { supplierId: supplier.id, period: '2099-01' } },
    create: { supplierId: supplier.id, period: '2099-01', grossAmount: 1234.56, serviceFeeRate: 0.03, serviceFee: 37.04, netAmount: 1197.52, status: 0 },
    update: {},
  })
  created.settlementIds.push(sellRow.id)
  const moneyBefore = await snapshotMoney(purchaser.id, supplier.id, bt)

  const REMARK = '已微信退 2.50 元，对方确认收到'
  r = await call(`/admin/aftersale/${t1Id}/handle`, { method: 'POST', token: at, body: { action: 'compensate', handleRemark: REMARK } })
  console.log('  只传说明（不传金额/方式）→ ' + JSON.stringify(r.body))
  check('8.4 不传金额与方式 → 能完成', r.body.code === 0, r.body)
  check('8.5 状态转 2（已解决）', r.body.data?.status === 2, r.body.data)
  const t1After = await prisma.aftersaleOrder.findUnique({ where: { id: BigInt(t1Id) } })
  check('8.6 处理说明落库', t1After.handleRemark === REMARK, t1After.handleRemark)
  check('8.7 金额为空 → 落 null', t1After.compensateAmount === null, t1After.compensateAmount)
  check('8.8 方式为空 → 落 null（口径：空即「仅致歉」）', t1After.compensateMethod === null, t1After.compensateMethod)
  check('8.9 handledAt / handledBy 已写', !!t1After.handledAt && t1After.handledBy != null, { at: t1After.handledAt, by: t1After.handledBy })

  const audits = await prisma.auditLog.findMany({ where: { entity: 'aftersale', entityId: BigInt(t1Id), action: 'AFTERSALE_HANDLE' } })
  created.auditIds.push(...audits.map((a) => a.id))
  check('8.10 审计恰好 1 行 AFTERSALE_HANDLE', audits.length === 1, audits.length)
  const auditTxt = audits.length ? JSON.stringify(audits[0].before) + JSON.stringify(audits[0].after) : ''
  check('8.11 审计记了 0→2 状态跃迁', audits.length === 1 && audits[0].before?.status === 0 && audits[0].after?.status === 2,
    audits[0] ? { before: audits[0].before, after: audits[0].after } : null)
  check('8.12 审计 payload 不含处理说明正文（避免夹带 PII）', !auditTxt.includes(REMARK), auditTxt)

  console.log('\n【判据 10】钱一分没动：处理完成前后 settlement / 账单 / 订单 / 明细逐字段相等')
  const moneyAfter = await snapshotMoney(purchaser.id, supplier.id, bt)
  check('10.1 settlement 逐字段相等', JSON.stringify(moneyBefore.settlements) === JSON.stringify(moneyAfter.settlements))
  check('10.2 客户账单（GET /buyer/bill）逐字段相等', JSON.stringify(moneyBefore.bill) === JSON.stringify(moneyAfter.bill))
  check('10.3 订单 status/amountOrdered/amountFinal/deliveryFee 逐字段相等', JSON.stringify(moneyBefore.orders) === JSON.stringify(moneyAfter.orders))
  check('10.4 order_item 各数量字段（订购/申报/验收/收货）逐字段相等', JSON.stringify(moneyBefore.items) === JSON.stringify(moneyAfter.items))
  check('10.5 payment_record 未新增',
    (await prisma.paymentRecord.count({ where: { orderId: { in: created.orderIds } } })) === 0)

  // ────────────────────────────────────────
  // 判据 9：供应商端只读接口
  // ────────────────────────────────────────
  console.log('\n【判据 9】供应商端接口：只返回本档口工单 / 未拆单不出现 / pendingCount 与库内一致')
  // 补一条「别家档口」与一条「未拆单」的工单，专门验证过滤口径
  const otherRow = await prisma.aftersaleOrder.create({
    data: { orderId: oOther.id, orderItemId: itemG.id, type: 1, reason: '别家档口的工单', qtyDiff: 1, amountDiff: 2.5, status: 0 },
  })
  const unassignedRow = await prisma.aftersaleOrder.create({
    data: { orderId: oUnassigned.id, orderItemId: itemH.id, type: 1, reason: '未拆单的工单', qtyDiff: 1, amountDiff: 2.5, status: 0 },
  })
  created.aftersaleIds.push(otherRow.id, unassignedRow.id)

  r = await call('/supplier/aftersale', { token: st })
  console.log('  本档口 GET /supplier/aftersale → code=' + r.body.code + ' pendingCount=' + r.body.data?.pendingCount + ' 条数=' + (r.body.data?.list || []).length)
  check('9.1 接口可用（code=0）', r.body.code === 0, r.body)
  const supList = r.body.data?.list || []
  check('9.2 别家档口的工单不出现', !supList.some((x) => x.aftersaleId === Number(otherRow.id)), supList.map((x) => x.aftersaleId))
  check('9.3 未拆单的工单不出现', !supList.some((x) => x.aftersaleId === Number(unassignedRow.id)), supList.map((x) => x.aftersaleId))
  check('9.4 本档口的工单都出现', supList.some((x) => x.aftersaleId === t1Id), supList.map((x) => x.aftersaleId))

  const dbPending = await prisma.aftersaleOrder.count({
    where: { orderItemId: { in: created.orderItemIds }, status: 0, orderId: { in: created.orderIds.filter((id) => id !== oOther.id && id !== oUnassigned.id) } },
  })
  check('9.5 pendingCount 与库内 status=0 条数一致', r.body.data?.pendingCount === dbPending, { api: r.body.data?.pendingCount, db: dbPending })

  const t2 = supList.find((x) => x.aftersaleId !== t1Id && x.type === 2)
  check('9.6 供应商能看到客户照片（口径 6e）', !!t2 && (t2.attachments || []).length > 0, t2?.attachments)
  check('9.7 供应商能看到运营处理结果（说明 + 处理时间）',
    supList.some((x) => x.handleRemark === REMARK && !!x.handledAt), supList.map((x) => ({ id: x.aftersaleId, remark: x.handleRemark, at: x.handledAt })))
  check('9.8 接口不含任何写操作字段（只读）', !('actions' in (r.body.data || {})), Object.keys(r.body.data || {}))

  let rr = await call('/supplier/aftersale', { token: bt })
  console.log('  采购方身份调 → ' + JSON.stringify(rr.body))
  check('9.9 采购方身份 → 2002 无权限', rr.body.code === 2002, rr.body)
  rr = await call('/supplier/aftersale', {})
  console.log('  未登录调 → ' + JSON.stringify(rr.body))
  check('9.10 未登录 → 2001', rr.body.code === 2001, rr.body)

  // ────────────────────────────────────────
  // 11. 清理 + 残留复核
  // ────────────────────────────────────────
  console.log('\n【11】清理自造数据 → 复核残留=0')
  await prisma.deliveryTask.deleteMany({ where: { id: { in: created.taskIds } } })
  await prisma.aftersaleOrder.deleteMany({ where: { id: { in: created.aftersaleIds } } })
  await prisma.auditLog.deleteMany({ where: { id: { in: created.auditIds } } })
  await prisma.orderItem.deleteMany({ where: { id: { in: created.orderItemIds } } })
  await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } })
  await prisma.settlement.deleteMany({ where: { id: { in: created.settlementIds } } })
  await prisma.supplier.deleteMany({ where: { id: { in: created.supplierIds } } })
  await prisma.purchaser.deleteMany({ where: { id: { in: created.purchaserIds } } })
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })

  const residue = {
    user: await prisma.user.count({ where: { id: { in: created.userIds } } }),
    purchaser: await prisma.purchaser.count({ where: { id: { in: created.purchaserIds } } }),
    supplier: await prisma.supplier.count({ where: { id: { in: created.supplierIds } } }),
    order: await prisma.order.count({ where: { id: { in: created.orderIds } } }),
    orderItem: await prisma.orderItem.count({ where: { id: { in: created.orderItemIds } } }),
    aftersale: await prisma.aftersaleOrder.count({ where: { id: { in: created.aftersaleIds } } }),
    task: await prisma.deliveryTask.count({ where: { id: { in: created.taskIds } } }),
    audit: await prisma.auditLog.count({ where: { id: { in: created.auditIds } } }),
    settlement: await prisma.settlement.count({ where: { id: { in: created.settlementIds } } }),
  }
  console.log('  清理后残留：' + JSON.stringify(residue))
  check('11.1 残留 user = 0', residue.user === 0, residue.user)
  check('11.2 残留 purchaser = 0', residue.purchaser === 0, residue.purchaser)
  check('11.3 残留 supplier = 0', residue.supplier === 0, residue.supplier)
  check('11.4 残留 order = 0', residue.order === 0, residue.order)
  check('11.5 残留 order_item = 0', residue.orderItem === 0, residue.orderItem)
  check('11.6 残留 aftersale_order = 0', residue.aftersale === 0, residue.aftersale)
  check('11.7 残留 delivery_task = 0', residue.task === 0, residue.task)
  check('11.8 残留 audit_log = 0', residue.audit === 0, residue.audit)
  check('11.9 残留 settlement = 0', residue.settlement === 0, residue.settlement)

  console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '))
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

/// 「钱一分没动」快照：settlement / 客户账单 / 订单 / 明细 —— 只取参与钱的字段，逐字段可比
async function snapshotMoney(purchaserId, supplierId, buyerToken) {
  const [settlements, orders, items, bill] = await Promise.all([
    prisma.settlement.findMany({ orderBy: { id: 'asc' }, select: { id: true, supplierId: true, period: true, grossAmount: true, serviceFeeRate: true, serviceFee: true, netAmount: true, status: true } }),
    prisma.order.findMany({ where: { purchaserId }, orderBy: { id: 'asc' }, select: { id: true, status: true, amountOrdered: true, amountFinal: true, deliveryFee: true, payMethod: true } }),
    prisma.orderItem.findMany({ where: { orderId: { in: created.orderIds } }, orderBy: { id: 'asc' }, select: { id: true, qtyOrdered: true, qtyDeclared: true, qtyAccepted: true, qtySorted: true, qtyReceived: true, rejectReason: true, salePrice: true, supplyPrice: true } }),
    call('/buyer/bill/2026-09', { token: buyerToken }),
  ])
  return {
    // ⚠️ 所有 id 一律转 Number、所有 Decimal 一律转 String ——
    //    否则 JSON.stringify 会因 BigInt / Decimal 抛错（本脚本踩过一次）
    settlements: settlements.map((s) => ({
      id: Number(s.id), supplierId: Number(s.supplierId), period: s.period, status: s.status,
      grossAmount: String(s.grossAmount), serviceFeeRate: String(s.serviceFeeRate),
      serviceFee: String(s.serviceFee), netAmount: String(s.netAmount),
    })),
    orders: orders.map((o) => ({
      id: Number(o.id), status: o.status, payMethod: o.payMethod,
      amountOrdered: String(o.amountOrdered),
      amountFinal: o.amountFinal === null ? null : String(o.amountFinal),
      deliveryFee: String(o.deliveryFee),
    })),
    items: items.map((i) => ({
      id: Number(i.id),
      qtyOrdered: String(i.qtyOrdered), qtyDeclared: i.qtyDeclared === null ? null : String(i.qtyDeclared),
      qtyAccepted: i.qtyAccepted === null ? null : String(i.qtyAccepted), qtySorted: i.qtySorted === null ? null : String(i.qtySorted),
      qtyReceived: i.qtyReceived === null ? null : String(i.qtyReceived),
      rejectReason: i.rejectReason,
      salePrice: String(i.salePrice), supplyPrice: i.supplyPrice === null ? null : String(i.supplyPrice),
    })),
    bill: bill.body,
  }
}

main().catch(async (e) => {
  console.error('\n💥 脚本异常：', e)
  console.error('⚠️ 自造数据可能未清理，请手工核对：', JSON.stringify({
    userIds: created.userIds.map(Number), purchaserIds: created.purchaserIds.map(Number),
    supplierIds: created.supplierIds.map(Number), orderIds: created.orderIds.map(Number),
    orderItemIds: created.orderItemIds.map(Number), aftersaleIds: created.aftersaleIds.map(Number),
    taskIds: created.taskIds.map(Number), settlementIds: created.settlementIds.map(Number),
  }))
  await prisma.$disconnect()
  process.exit(2)
})
