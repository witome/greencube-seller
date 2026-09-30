/**
 * 卡AH（2026-09-30）自测脚本 —— 配送员「客户未付款」标记 + 运营后台联动
 *
 * 运行： cd backend && node scripts/unpaid-mark-test.js
 * 前置： ① 后端已启动在 3001（PORT 可改）
 *        ② backend/dist 已构建（npm run build）—— 脚本会 require dist 里的 pay-status.util 做判定对比
 *
 * 覆盖任务书《卡AH》第五节验收判据 1~8：
 *   1  配送员收款页出现「客户未付款」次要按钮；已线上到账的单不显示（前端静态断言 + 后端拒绝）
 *   2  点击 → 二次确认（备注选填）→ 库里有 order.pay_proof.unpaidMark，且订单状态仍 60
 *   3  标记后客户侧文案仍「未支付」；运营后台列表出现标记且能命中筛选
 *   4  标记后客户线上支付成功 → 60→70、客户侧「已付款 · 微信直接支付」、标记自动失效（历史痕迹保留）
 *   5  改口：配送员提交收款凭证 → unpaidMark 被清掉
 *   6  hasPayProof 收紧：只有 unpaidMark、没有 photos → 判「未支付」（不许判成「已付款·扫码付款」）
 *   7  老数据不翻车：库里带 pay_proof 的**老数据行**（排除本自测自造行），新旧实现判定结果逐行一致
 *   8  钱一分没动：全表订单/明细/结算 的条数与金额字段，与「自测开始前基线」逐字段相等（清理后比对）
 *
 * 🔴 清理铁律（本项目 2026-09-30 血泪）：**只按本脚本自造的精确 id 集合删**，
 *    禁止 name 前缀 / LIKE / startsWith 兜网；删之前先把「将删清单」落盘到自测证据目录。
 */

const path = require('path')
const fs = require('fs')

// ────────────────────────────────────────────────────────────────
// 自己加载 backend/.env（不依赖外部 --env-file；任务书第六节要求）
// ────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
loadEnv()

const BASE = `http://localhost:${process.env.PORT || 3001}/api/v1`
const ts = Date.now()
const TEST_START = new Date()

let passed = 0
let failed = 0
const created = {
  orderIds: [],
  taskIds: [],
  paymentRecordIds: [],
  settlementIds: [],
  purchaserId: null,
  userId: null,
  auditRowIds: [],
}
const evidenceLines = []
const say = (s) => {
  console.log(s)
  evidenceLines.push(s)
}

function check(name, cond, extra) {
  if (cond) {
    passed++
    say('  ✅ ' + name)
  } else {
    failed++
    say('  ❌ ' + name + (extra ? ' → ' + JSON.stringify(extra) : ''))
  }
  return !!cond
}

function abort(msg) {
  failed++
  say('  ❌ ' + msg)
  say('')
  say('='.repeat(56))
  say(`卡AH 自测中止：✅ 通过 ${passed} 项 / ❌ 失败 ${failed} 项（未跑完）`)
  say('='.repeat(56))
  process.exit(1)
}

async function call(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// dist 里的判定唯一实现（与线上跑的是同一份编译产物）
let util = null
try {
  util = require(path.join(__dirname, '..', 'dist', 'common', 'utils', 'pay-status.util.js'))
} catch (e) {
  console.error('❌ 未找到 backend/dist/common/utils/pay-status.util.js —— 请先 `npm run build` 再跑本脚本')
  process.exit(1)
}
const { hasPayProof, payStatusOf, buyerPayStatusTextOf, readUnpaidMark, unpaidMarkViewOf } = util

/** 收紧前的旧实现（仅用于「老数据不翻车」逐行对比，不参与任何业务） */
function oldHasPayProof(payProof) {
  if (!payProof) return false
  const photos = payProof.photos
  return Array.isArray(photos) ? photos.length > 0 : true
}

// ────────────────────────────────────────────────────────────────
// 证据目录
// ────────────────────────────────────────────────────────────────
const EVID_DIR = path.join(__dirname, '..', '..', '自测证据', 'cardAH-20260930')
fs.mkdirSync(EVID_DIR, { recursive: true })

const readSrc = (rel) => {
  const p = path.join(__dirname, '..', '..', rel)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
}

const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** 全表资金快照：订单/明细/结算 的条数与金额字段（用于证明「钱一分没动」） */
async function moneySnapshot() {
  const agg = await prisma.order.aggregate({
    _count: { _all: true },
    _sum: { amountOrdered: true, amountFinal: true, deliveryFee: true },
  })
  const items = await prisma.orderItem.aggregate({
    _count: { _all: true },
    _sum: { qtyAccepted: true, supplyPrice: true },
  })
  const settle = await prisma.settlement.aggregate({
    _count: { _all: true },
    _sum: { grossAmount: true, netAmount: true, serviceFee: true },
  })
  return {
    order: {
      count: agg._count._all,
      amountOrdered: String(agg._sum.amountOrdered),
      amountFinal: String(agg._sum.amountFinal),
      deliveryFee: String(agg._sum.deliveryFee),
    },
    orderItem: { count: items._count._all, qtyAccepted: String(items._sum.qtyAccepted), supplyPrice: String(items._sum.supplyPrice) },
    settlement: {
      count: settle._count._all,
      grossAmount: String(settle._sum.grossAmount),
      netAmount: String(settle._sum.netAmount),
      serviceFee: String(settle._sum.serviceFee),
    },
  }
}

async function main() {
  say('='.repeat(56))
  say('卡AH · 配送员「客户未付款」标记 自测')
  say(`时间：${new Date().toISOString()}　目标：${BASE}`)
  say('='.repeat(56))
  say('')

  // ── 0. 登录四角色 ──
  const admin = await call('POST', '/auth/wx-login', { code: 'admin' })
  const supplier = await call('POST', '/auth/wx-login', { code: 'demo_supplier' })
  const courier = await call('POST', '/auth/wx-login', { code: 'courier' })
  const at = admin?.data?.token
  const st = supplier?.data?.token
  const ct = courier?.data?.token
  if (!admin?.data?.token || !supplier?.data?.token || !courier?.data?.token) {
    abort('四角色登录失败，请确认后端在线（' + BASE + '）')
  }
  say('【0. 登录】运营 / 供应商 / 配送员 登录成功')
  check('配送员当前角色 = courier', courier.data.currentRole === 'courier', courier.data)

  // 演示采购方（新建一个，避免碰任何既有采购方数据）
  const buyerCode = 'ahbuyer_' + ts
  const buyerLogin = await call('POST', '/auth/wx-login', { code: buyerCode })
  const buyerPhone = '139' + String(ts).slice(-8)
  const reg = await call(
    'POST',
    '/buyer/register',
    { shopName: '卡AH自测餐馆', contact: '自测', phone: buyerPhone, address: '自测路 1 号' },
    buyerLogin.data.token,
  )
  if (reg.code !== 0) abort('采购方注册失败：' + JSON.stringify(reg))
  created.purchaserId = reg.data?.purchaserId ?? null
  created.userId = buyerLogin.data?.userId ?? null
  const buyerId = created.userId

  // 运营核实通过 → 重新登录拿激活后的 token
  const pend = await call('GET', '/admin/buyers/pending?pageSize=100', null, at)
  const hit = (pend.data?.list || []).find((x) => x.phone === buyerPhone)
  if (!hit) abort('运营待审队列里找不到自测采购方（phone=' + buyerPhone + '）')
  created.purchaserId = hit.purchaserId
  const verify = await call('POST', `/admin/buyers/${hit.purchaserId}/verify`, { methods: [1], result: 1 }, at)
  if (verify.code !== 0) abort('运营核实失败：' + JSON.stringify(verify))
  const bt = (await call('POST', '/auth/wx-login', { code: buyerCode })).data.token
  const prof = await call('GET', '/buyer/profile', null, bt)
  check('自测采购方已激活(accountStatus=2)', prof.data?.accountStatus === 2, prof.data)

  // ── 0.1 前置依赖（硬规矩 3）：最大 id 在售商品必须挂供货关联，否则整片假红 ──
  const goods = await call('GET', '/product/list?pageSize=5', null, bt)
  if (!goods?.data?.list?.length) abort('商品列表为空，无法下单')
  const pid = goods.data.list[0].id
  const pidPrice = Number(goods.data.list[0].salePrice)

  // ── 0.1b 资金基线：必须在**造任何数据之前**取，收尾时与「清理后快照」逐字段比对 ──
  const moneyBaseline = await moneySnapshot()
  say('  自测开始前资金基线（尚未造任何数据）：' + JSON.stringify(moneyBaseline))

  // ── 0.2 造两单（COD），走完整链路到「已送达(60)」──
  say('')
  say('【1. 造数：采购方下单(COD) → 备货完成 → 派单 → 取货 → 出发 → 交付】')
  const DELIVER_DATE = '2026-12-15' // 刻意选无人使用的月份，隔离本次自测数据
  const mkOrder = async (qty) => {
    const o = await call('POST', '/order', { deliveryDate: DELIVER_DATE, timeWindow: 1, items: [{ productId: pid, qty }] }, bt)
    if (o.code !== 0) abort('下单失败：' + JSON.stringify(o))
    created.orderIds.push(o.data.orderId)
    const pay = await call('POST', `/order/${o.data.orderId}/pay`, { payMethod: 2 }, bt)
    if (pay.code !== 0) abort('选择货到付款失败：' + JSON.stringify(pay))
    return o.data.orderId
  }
  const orderA = await mkOrder(2)
  const orderB = await mkOrder(2)
  say(`  自造订单：A=#${orderA}　B=#${orderB}（均货到付款 · 送达日 ${DELIVER_DATE}）`)

  for (const oid of [orderA, orderB]) {
    const h = await call('POST', '/supplier-fulfill/handover', { orderId: oid }, st)
    if (h.code !== 0) abort(`订单 #${oid} 确认备货完成失败：` + JSON.stringify(h))
  }

  // ⚠️ handover 内会**自动派单**（supplier-fulfill.service.ts autoAssignOrder）：
  //    订单 30→40→45(ASSIGNED)，并为每个订单建一个 DeliveryTask（stationList 只含自身）。
  //    所以这里**不能**再手工调 /admin/dispatch（会因「存在非待配送状态订单」被拒）。
  //    正确做法：查出自动派出的任务并复用；仅当确实没有自动派单时才手工补派。
  const resolveTasks = async () => {
    const all = await prisma.deliveryTask.findMany({
      where: { status: { in: [0, 1, 2] } },
      select: { id: true, courierId: true, status: true, stationList: true },
    })
    const map = new Map()
    for (const t of all) {
      const stations = Array.isArray(t.stationList) ? t.stationList : []
      for (const s of stations) {
        if (s.type === 'deliver' && (Number(s.orderId) === orderA || Number(s.orderId) === orderB)) map.set(Number(s.orderId), t)
      }
    }
    return map
  }
  let taskOfOrder = await resolveTasks()
  say(`  自动派单结果：订单 #${orderA}→任务 ${taskOfOrder.get(orderA)?.id ?? '无'}，订单 #${orderB}→任务 ${taskOfOrder.get(orderB)?.id ?? '无'}`)
  for (const oid of [orderA, orderB]) {
    if (taskOfOrder.has(oid)) continue
    const disp = await call('POST', '/admin/dispatch', { courierId: 1, orderIds: [oid] }, at)
    if (disp.code !== 0) abort(`订单 #${oid} 自动派单缺失且手工派单失败：` + JSON.stringify(disp))
    taskOfOrder = await resolveTasks()
  }
  const taskIds = [...new Set([orderA, orderB].map((oid) => Number(taskOfOrder.get(oid).id)))]
  created.taskIds.push(...taskIds)
  check('两个自造订单都拿到了派送任务（自动派单：一单一任务）', taskIds.length === 2, taskIds)
  check('派送任务归属演示配送员 id=1（pickup/deliver 有归属校验）',
    [orderA, orderB].every((oid) => Number(taskOfOrder.get(oid).courierId) === 1),
    [orderA, orderB].map((oid) => Number(taskOfOrder.get(oid).courierId)))

  let pickupOk = true
  for (const tid of taskIds) {
    const r = await call('POST', `/courier/task/${tid}/pickup`, {}, ct)
    if (r.code !== 0) pickupOk = false
  }
  check('扫码取货（任务→配送中 1、订单 45→50）—— 逐任务', pickupOk)
  const depart = await call('POST', '/courier/depart', {}, ct)
  check('出发（所有已取货任务→已出发 2）',
    depart.code === 0 && (depart.data?.departedTasks || 0) === taskIds.length, depart)

  let deliveredOrders = 0
  const codOrders = []
  let deliverOk = true
  for (const tid of taskIds) {
    const r = await call('POST', `/courier/task/${tid}/deliver`, { photos: ['ah.jpg'], signature: 'ah.png' }, ct)
    if (r.code !== 0) deliverOk = false
    deliveredOrders += r.data?.deliveredOrders || 0
    codOrders.push(...(r.data?.codOrders || []))
  }
  check('交付确认（任务→3、订单 50→60 已送达；合计 2 单）', deliverOk && deliveredOrders === 2, { deliveredOrders })
  check('交付后返回 2 单待收款（COD 队列）', codOrders.length === 2, codOrders)
  check('COD 队列两单正是自造订单 A/B',
    codOrders.map((o) => o.orderId).sort((a, b) => a - b).join(',') === [orderA, orderB].sort((a, b) => a - b).join(','),
    codOrders)

  // ── 判据 1：前端（静态断言；前端行为无法在 node 里跑，用源码+编译产物双重证据）──
  say('')
  say('【2. 判据1 · 配送员端「客户未付款」次要按钮】')
  const codPaySrc = readSrc('frontend/src/subpkg-courier/pages/cod-pay.vue')
  const deliverSrc = readSrc('frontend/src/subpkg-courier/pages/deliver.vue')
  const homeSrc = readSrc('frontend/src/subpkg-courier/pages/home.vue')
  const wxml = readSrc('frontend/dist/self/mp-weixin/subpkg-courier/pages/cod-pay.wxml')
  const deliverWxml = readSrc('frontend/dist/self/mp-weixin/subpkg-courier/pages/deliver.wxml')
  const homeWxml = readSrc('frontend/dist/self/mp-weixin/subpkg-courier/pages/home.wxml')

  check('收款页源码含「客户未付款」按钮', codPaySrc.includes('客户未付款'))
  check('收款页按钮为**次要样式**（pbtn outline）', /pbtn outline[\s\S]{0,200}客户未付款/.test(codPaySrc))
  check('收款页按钮只在!onlinePaid 分支内渲染（已线上到账的单不显示）', /v-if="!onlinePaid"[\s\S]{0,1200}客户未付款/.test(codPaySrc))
  check('收款页含二次确认半屏 + 备注（选填）', codPaySrc.includes('确认这单没收到钱？') && codPaySrc.includes('备注') && codPaySrc.includes('markRemark'))
  check('收款页提示写明「标记自动失效」', codPaySrc.includes('标记自动失效'))
  check('交付完成页为半屏两路选择', deliverSrc.includes('本单需要收款') && deliverSrc.includes('客户已付款') && deliverSrc.includes('客户未付款'))
  check('任务列表沿用同一套标签体系（新增 cargo-unpaid-tag）', homeSrc.includes('cargo-unpaid-tag') && homeSrc.includes('unpaidMarkedAt'))
  check('编译产物已包含新增交互（cod-pay.wxml / deliver.wxml / home.wxml）',
    wxml.includes('客户未付款') && deliverWxml.includes('客户未付款') && homeWxml.includes('cargo-unpaid-tag'))

  // ── 判据 2：标记落库 + 状态不变 + 备注 ──
  say('')
  say('【3. 判据2 · 标记落库（unpaidMark）且订单仍停在 60】')
  const markA = await call('POST', `/courier/order/${orderA}/unpaid-mark`, { remark: '客户说下午转' }, ct)
  check('POST /courier/order/:id/unpaid-mark 成功', markA.code === 0, markA)
  check('接口回传状态仍为 60（未推进订单）', markA.data?.status === 60, markA.data)

  const rowA0 = await prisma.order.findUnique({ where: { id: BigInt(orderA) } })
  const mkA = readUnpaidMark(rowA0.payProof)
  check('库里 order.pay_proof.unpaidMark 存在', !!mkA, rowA0.payProof)
  check('unpaidMark.remark = 客户说下午转', mkA?.remark === '客户说下午转', mkA)
  check('unpaidMark.by = 配送员 userId', String(mkA?.by) === String(courier.data.userId), { by: mkA?.by, uid: courier.data.userId })
  check('unpaidMark.at 是合法 ISO 时间', !!mkA?.at && !Number.isNaN(Date.parse(mkA.at)), mkA?.at)
  check('订单状态仍是 60 已送达', rowA0.status === 60, rowA0.status)

  const markB = await call('POST', `/courier/order/${orderB}/unpaid-mark`, {}, ct)
  check('不传备注也能标记成功（remark 选填）', markB.code === 0, markB)
  const rowB0 = await prisma.order.findUnique({ where: { id: BigInt(orderB) } })
  const mkB = readUnpaidMark(rowB0.payProof)
  check('无备注时 unpaidMark.remark = null', mkB?.remark === null, mkB)

  // 反向：订单不存在
  const notFound = await call('POST', '/courier/order/999999999/unpaid-mark', {}, ct)
  check('不存在的订单 → 4001 资源不存在', notFound.code === 4001, notFound)

  // 审计留痕
  const auditMark = await prisma.auditLog.findMany({
    where: { action: 'COURIER_UNPAID_MARK', entity: 'order', entityId: { in: [BigInt(orderA), BigInt(orderB)] } },
  })
  check('审计：COURIER_UNPAID_MARK 各落一条（共 2 条）', auditMark.length === 2, auditMark.map((a) => Number(a.entityId)))
  check('审计 after 里带 remark 与「状态不变」说明',
    auditMark.some((a) => JSON.stringify(a.after || {}).includes('客户说下午转') && a.after?.status === 60))

  // ── 判据 3：客户侧文案 + 运营后台可见 ──
  say('')
  say('【4. 判据3 · 客户侧仍「未支付」+ 运营后台可见标记】')
  const buyerA = await call('GET', `/order/${orderA}`, null, bt)
  check('客户侧订单详情 payStatusText = 未支付', buyerA.data?.payStatusText === '未支付', buyerA.data?.payStatusText)
  // 卡AH 的要求是「标记后客户侧**文案**仍『未支付』」。注意：
  //   · `payStatus`（机器码，如 cod_pending）是卡S2/卡AG 起就存在的**前端配色字段**，本卡未改、不属本卡范围；
  //   · 真正要守的是「运营侧的作业用词（待收款）不落到客户payload / 客户看到的文案不是作业口径」。
  const buyerBodyStr = JSON.stringify(buyerA.data || {})
  check('客户侧**不出现**运营作业用词「待收款」',
    !buyerBodyStr.includes('待收款'), buyerBodyStr.match(/.{0,40}待收款.{0,40}/)?.[0] ?? null)
  check('客户侧无配送员侧专用标记字段（unpaidMark* 不外泄给采购方）',
    !Object.keys(buyerA.data || {}).some((k) => /unpaidMark/i.test(k)), Object.keys(buyerA.data || {}))

  const deliveredList = await call('GET', '/admin/order/delivered', null, at)
  const rowAdminA = (deliveredList.data || []).find((o) => o.orderId === orderA)
  const rowAdminB = (deliveredList.data || []).find((o) => o.orderId === orderB)
  check('后台订单列表带出 unpaidMarked/unpaidMarkedAt',
    rowAdminA?.unpaidMarked === true && !!rowAdminA?.unpaidMarkedAt, rowAdminA)
  check('后台订单列表标记**仍生效**（unpaidMarkEffective=true，未线上到账）',
    rowAdminA?.unpaidMarkEffective === true && rowAdminA?.unpaidMarkOverridden === false, rowAdminA)
  check('后台订单列表带出备注与标记人姓名',
    rowAdminA?.unpaidMarkRemark === '客户说下午转' && !!rowAdminA?.unpaidMarkByName, rowAdminA)
  const markedRows = (deliveredList.data || []).filter((o) => o.unpaidMarkEffective)
  check('「仅看已标记未收款」筛选口径可命中 2 行（= unpaidMarkEffective 计数）', markedRows.length >= 2, markedRows.length)
  check('后台订单列表「有凭证」判定由后端给（hasProof）', rowAdminA?.hasProof === false, rowAdminA?.hasProof)

  const detailA = await call('GET', `/admin/order/${orderA}/detail`, null, at)
  check('订单详情带出标记时间线数据（未线上支付 → overridden=false）',
    detailA.data?.unpaidMarked === true && detailA.data?.unpaidMarkOverridden === false && detailA.data?.onlinePaid === false, detailA.data)
  check('订单详情带出标记人姓名与备注',
    detailA.data?.unpaidMarkByName === rowAdminA?.unpaidMarkByName && detailA.data?.unpaidMarkRemark === '客户说下午转')

  const recon = await call('GET', `/admin/finance/daily-reconciliation?date=${DELIVER_DATE}`, null, at)
  const markedCount = recon.data?.summary?.unpaidMarkedCount ?? 0
  const markedAmount = recon.data?.summary?.unpaidMarkedAmount ?? 0
  const expectMarkedAmount = (recon.data?.orderList || []).reduce((s, r) => s + (r.unpaidMarkEffective ? Number(r.unpaid) : 0), 0)
  check('每日对账「未收」下子标注统计到 2 单已标记未收款', markedCount === 2, recon.data?.summary)
  check('已标记未收款金额 = 这些单的未收金额之和', Math.abs(Number(markedAmount) - expectMarkedAmount) < 0.01,
    { markedAmount, expectMarkedAmount })
  check('对账清单行带出标记字段（供行标红 + 只看已标记未收款）',
    (recon.data?.orderList || []).filter((r) => r.unpaidMarkEffective).length === 2)
  // 🔴 红线：标记不参与金额口径 —— 「未收」金额 = 这两单应收（与标记前一致）
  const expectUnpaid = (recon.data?.orderList || []).reduce((s, r) => s + Number(r.unpaid), 0)
  check('标记不改变「未收」金额口径（仍等于各单未收之和）',
    Math.abs(Number(recon.data?.summary?.unpaid) - expectUnpaid) < 0.01,
    { unpaid: recon.data?.summary?.unpaid, expectUnpaid })

  // ── 判据 5：改口（提交凭证 → 清掉标记）──
  say('')
  say('【5. 判据5 · 改口：配送员提交收款凭证 → unpaidMark 被清掉】')
  const proofA = await call('POST', `/courier/order/${orderA}/pay-proof`, { photos: ['ah-A.jpg'] }, ct)
  check('提交收款凭证成功', proofA.code === 0, proofA)
  const rowA1 = await prisma.order.findUnique({ where: { id: BigInt(orderA) } })
  const payProofA = rowA1.payProof || {}
  check('pay_proof 里已无 unpaidMark 键', !('unpaidMark' in payProofA), payProofA)
  check('pay_proof.photos 已写入（1 张）', Array.isArray(payProofA.photos) && payProofA.photos.length === 1, payProofA)
  check('提交凭证后订单推进 60→70（卡AG 支付即收货）', rowA1.status === 70, rowA1.status)
  const buyerA2 = await call('GET', `/order/${orderA}`, null, bt)
  check('客户侧文案变「已付款 · 扫码付款」', buyerA2.data?.payStatusText === '已付款 · 扫码付款', buyerA2.data?.payStatusText)
  const deliveredList2 = await call('GET', '/admin/order/delivered', null, at)
  const rowAdminA2 = (deliveredList2.data || []).find((o) => o.orderId === orderA)
  check('后台列表 A 行不再算「已标记未收款」（unpaidMarked=false）', rowAdminA2?.unpaidMarked === false, rowAdminA2)

  // ── 判据 6（端到端）：只有 unpaidMark、没有 photos → 判「未支付」──
  say('')
  say('【6. 判据6 · hasPayProof 收紧：只有 unpaidMark、没有 photos → 判「未支付」】')
  // 改口后 A 已有 photos；这里用 B（此刻 pay_proof 里**只有** unpaidMark）做端到端验证
  const rowB1 = await prisma.order.findUnique({ where: { id: BigInt(orderB) } })
  check('B 的 pay_proof 此刻只有 unpaidMark（无 photos）',
    !!readUnpaidMark(rowB1.payProof) && !Array.isArray(rowB1.payProof?.photos), rowB1.payProof)
  const buyerB1 = await call('GET', `/order/${orderB}`, null, bt)
  check('【端到端】该单客户侧判「未支付」（**不是**「已付款 · 扫码付款」）',
    buyerB1.data?.payStatusText === '未支付' && buyerB1.data?.payStatusCode !== 'paid_proof',
    { text: buyerB1.data?.payStatusText, code: buyerB1.data?.payStatusCode })
  const adminB1 = await call('GET', '/admin/order/delivered', null, at)
  check('【端到端】后台列表 B 行也判未收（hasProof=false / unpaidMarkEffective=true）',
    (adminB1.data || []).find((o) => o.orderId === orderB)?.hasProof === false)

  // 单元级断言（直接调 dist 里的唯一实现）
  const onlyMark = { unpaidMark: { by: 1, at: new Date().toISOString(), remark: null } }
  const stOnlyMark = payStatusOf({ payMethod: 2, status: 60, onlinePaid: false, hasProof: hasPayProof(onlyMark) })
  check('hasPayProof({unpaidMark}) === false', hasPayProof(onlyMark) === false)
  check('该单运营口径 = cod_pending（待收款）', stOnlyMark.code === 'cod_pending', stOnlyMark)
  check('该单客户版文案 = 未支付', buyerPayStatusTextOf(stOnlyMark) === '未支付')
  const withPhotos = { photos: ['a.jpg'], courierId: 1, paidAt: new Date().toISOString() }
  check('hasPayProof({photos:[1]}) === true 且判「已付款 · 扫码付款」',
    hasPayProof(withPhotos) === true &&
      payStatusOf({ payMethod: 2, status: 60, onlinePaid: false, hasProof: true }).code === 'paid_proof')
  check('hasPayProof(null/{} /{photos:[]}) 一律 false',
    hasPayProof(null) === false && hasPayProof({}) === false && hasPayProof({ photos: [] }) === false)
  say('  收紧前后判定对比（构造样本）：')
  const samples = [
    ['只有 unpaidMark，无 photos', onlyMark],
    ['unpaidMark + 空 photos', { photos: [], unpaidMark: onlyMark.unpaidMark }],
    ['unpaidMark + 非空 photos', { photos: ['a.jpg'], unpaidMark: onlyMark.unpaidMark }],
    ['只有 photos（老数据常态）', { photos: ['a.jpg'] }],
    ['非空但 photos 不是数组（脏数据）', { photos: 'not-array' }],
    ['{} 空对象', {}],
  ]
  for (const [label, sample] of samples) {
    say(`    · ${label}：旧=${oldHasPayProof(sample)}　新=${hasPayProof(sample)}`)
  }

  // ── 判据 4：客户线上支付 → 60→70 + 标记自动失效 ──
  say('')
  say('【7. 判据4 · 客户线上支付成功 → 60→70、标记自动失效】')
  const rowBpre = await prisma.order.findUnique({ where: { id: BigInt(orderB) } })
  const receivableB = rowBpre.amountFinal != null
    ? Number(rowBpre.amountFinal)
    : Number(rowBpre.amountOrdered) + Number(rowBpre.deliveryFee)
  // 本机无法真的拉起微信收银台（prepay 需真凭证）→ 直接建一条 channel='wechat'、status=0 的流水
  // （等价于 prepay 的建单结果），再走**真实的**模拟支付回调链路 confirmPayment（WX_MOCK_PAY=1）。
  // 回调里 hasWechatPaidRecord / completeOrderOnPayment 都是生产同一份代码，不是打桩。
  const payNo = require('crypto').randomBytes(16).toString('hex')
  const pr = await prisma.paymentRecord.create({
    data: { orderId: BigInt(orderB), payNo, channel: 'wechat', amount: receivableB, status: 0 },
  })
  created.paymentRecordIds.push(Number(pr.id))
  const mockPay = await call('POST', '/payment/mock/pay', { payNo }, bt)
  check('客户线上支付回调成功（模拟通道）', mockPay.code === 0 && mockPay.data?.status === 1, mockPay)

  const rowB2 = await prisma.order.findUnique({ where: { id: BigInt(orderB) } })
  check('订单推进 60→70（支付即收货）', rowB2.status === 70, rowB2.status)
  check('标记本身仍在库（历史痕迹保留，未被清）', !!readUnpaidMark(rowB2.payProof), rowB2.payProof)
  const buyerB2 = await call('GET', `/order/${orderB}`, null, bt)
  check('客户侧变「已付款 · 微信直接支付」', buyerB2.data?.payStatusText === '已付款 · 微信直接支付', buyerB2.data?.payStatusText)
  const detailB2 = await call('GET', `/admin/order/${orderB}/detail`, null, at)
  check('后台详情：onlinePaid=true + unpaidMarkOverridden=true（标记自动失效）',
    detailB2.data?.onlinePaid === true && detailB2.data?.unpaidMarkOverridden === true && detailB2.data?.unpaidMarkEffective === false,
    detailB2.data)
  check('后台详情带出线上到账时间 / 金额 / 流水号（时间线绿行数据）',
    !!detailB2.data?.onlinePaidAt && Math.abs(Number(detailB2.data?.wechatPaidAmount) - receivableB) < 0.01 && !!detailB2.data?.onlinePayNo,
    { at: detailB2.data?.onlinePaidAt, amt: detailB2.data?.wechatPaidAmount, payNo: detailB2.data?.onlinePayNo })
  const adminB2 = await call('GET', '/admin/order/delivered', null, at)
  const rowAdminB2 = (adminB2.data || []).find((o) => o.orderId === orderB)
  check('后台列表 B 行不再算「未收款」（unpaidMarkEffective=false, overridden=true）',
    rowAdminB2?.unpaidMarkEffective === false && rowAdminB2?.unpaidMarkOverridden === true, rowAdminB2)
  const recon2 = await call('GET', `/admin/finance/daily-reconciliation?date=${DELIVER_DATE}`, null, at)
  check('对账「其中配送员已标记未收款」归零（标记自动失效后不再计入）',
    (recon2.data?.summary?.unpaidMarkedCount ?? -1) === 0, recon2.data?.summary)

  // 反向：已线上到账的单拒绝标记（判据 1 的「不显示按钮」在服务端的兜底）
  say('')
  say('【8. 反向 · 已线上到账的单拒绝标记】')
  await prisma.order.update({ where: { id: BigInt(orderB) }, data: { status: 60 } }) // 仅为了命中「线上到账」这条校验
  const rejOnline = await call('POST', `/courier/order/${orderB}/unpaid-mark`, {}, ct)
  await prisma.order.update({ where: { id: BigInt(orderB) }, data: { status: 70 } }) // 复原
  check('已线上到账的单被拒（提示含「已通过线上支付到账」）',
    rejOnline.code !== 0 && String(rejOnline.msg || '').includes('已通过线上支付到账'), rejOnline)
  const rowB3 = await prisma.order.findUnique({ where: { id: BigInt(orderB) } })
  check('被拒后标记未被改写（remark 仍为 null，未写入新标记）', readUnpaidMark(rowB3.payProof)?.remark === null, rowB3.payProof)

  // ── 判据 7：老数据不翻车 ──
  say('')
  say('【9. 判据7 · 老数据（带 pay_proof 的行）新旧判定逐行一致】')
  // ⚠️ 判据 7 的口径是「**老数据**不翻车」——必须**排除本脚本自造的 A/B**：
  //    B 刻意只带 unpaidMark（无 photos），本来就会「旧 true / 新 false」，那是判据 6 要证的东西，
  //    混进这里会把「老数据逐行一致」这条验成假红。
  const legacy = await prisma.order.findMany({
    where: { payProof: { not: null }, id: { notIn: [BigInt(orderA), BigInt(orderB)] } },
    select: { id: true, payProof: true, status: true, payMethod: true },
  })
  let diff = 0
  let noPhotos = 0
  for (const o of legacy) {
    const oldV = oldHasPayProof(o.payProof)
    const newV = hasPayProof(o.payProof)
    if (oldV !== newV) diff++
    if (!Array.isArray(o.payProof?.photos) || o.payProof.photos.length === 0) noPhotos++
  }
  say(`  扫描到**老数据**（带 pay_proof、排除本自测 A/B）${legacy.length} 行`)
  check(`老数据新旧实现判定结果逐行一致（差异 ${diff} 行 = 0）`, diff === 0, { diff })
  check('老数据中「无有效 photos 数组」的行数为 0（故收紧不会把任何一行从已付款翻成未付款）',
    noPhotos === 0, { noPhotos })

  // 对照：本自测自造的行（A 有 photos / B 只有 unpaidMark）已知会「旧 true / 新 false」——这是判据 6 的预期
  const selfRows = await prisma.order.findMany({
    where: { id: { in: [BigInt(orderA), BigInt(orderB)] } },
    select: { id: true, payProof: true },
  })
  say('  对照（本自测自造行，不参与判据 7）：' +
    selfRows.map((o) => `#${o.id} photos=${Array.isArray(o.payProof?.photos) ? o.payProof.photos.length : '无'} 新判定=${hasPayProof(o.payProof)}`).join('　'))

  // ── 判据 8：钱一分没动 ──
  say('')
  say('【10. 判据8 · 钱一分没动】')
  say('  自测开始前资金基线：' + JSON.stringify(moneyBaseline))

  // 结算单仍能生成：选一个**没有任何数据**的期间（本次自测订单所在月），
  // 生成后只保留「本自测自造的那几行」并在清理阶段按精确 id 删除。
  const preSettle = await prisma.settlement.findMany({ where: { period: '2026-12' }, select: { id: true, grossAmount: true } })
  const gen = await call('POST', '/admin/finance/generate', { period: '2026-12' }, at)
  check('结算单生成链路可用（POST /admin/finance/generate 返回 0）', gen.code === 0, gen)
  const postSettle = await prisma.settlement.findMany({ where: { period: '2026-12' }, select: { id: true, grossAmount: true } })
  const preIds = new Set(preSettle.map((s) => Number(s.id)))
  const newSettleIds = postSettle.map((s) => Number(s.id)).filter((id) => !preIds.has(id))
  const newSettleRows = postSettle.filter((s) => !preIds.has(Number(s.id)))
  created.settlementIds.push(...newSettleIds)
  say(`  期间 2026-12：生成前 ${preIds.size} 行 → 生成后 ${postSettle.length} 行（本次新增 ${newSettleIds.length} 行，将按 id 清理）`)
  say('  本次新增结算行：' + JSON.stringify(newSettleRows.map((s) => ({ id: Number(s.id), gross: String(s.grossAmount) }))))
  // 🔴 红线：标记只写 order.pay_proof，**不进结算基数**——基数仍是 Σ(qtyAccepted × supplyPrice)
  // 本自测 2 单 × 2 件 × 供货价 2 = 8.00，验证结算链路仍能把这批单算进基数且金额 > 0
  check('本次自测订单真的进了结算基数（2026-12 新增结算行 ≥ 1 且 grossAmount > 0）',
    newSettleIds.length >= 1 && newSettleRows.some((s) => Number(s.grossAmount) > 0),
    { newSettleIds, rows: newSettleRows.map((s) => String(s.grossAmount)) })

  // 订单金额逐字段：A/B 自身
  const amtA = await prisma.order.findUnique({
    where: { id: BigInt(orderA) },
    select: { amountOrdered: true, amountFinal: true, deliveryFee: true, payMethod: true },
  })
  const amtB = await prisma.order.findUnique({
    where: { id: BigInt(orderB) },
    select: { amountOrdered: true, amountFinal: true, deliveryFee: true, payMethod: true },
  })
  // 应收 = amountFinal ?? amountOrdered + 运费，与支付口径一致（下单后未核单时不重算）
  const amtBExpect = rowBpre.amountFinal != null ? Number(rowBpre.amountFinal) : Number(rowBpre.amountOrdered) + Number(rowBpre.deliveryFee)
  check('B 单支付金额 = 应收口径（amountFinal ?? 商品金额+运费）', Math.abs(receivableB - amtBExpect) < 0.01, { receivableB, amtBExpect })
  check('A/B 订单金额字段最终未变（amountOrdered 仍为 2 件 × 销售价）',
    Math.abs(Number(amtA.amountOrdered) - 2 * pidPrice) < 0.01 && Math.abs(Number(amtB.amountOrdered) - 2 * pidPrice) < 0.01,
    { amtA, amtB, pidPrice })
  check('A/B payMethod 仍为 2（货到付款，标记未改支付方式）', amtA.payMethod === 2 && amtB.payMethod === 2)

  // 全局快照：本自测只在 A/B 上动过，且清理阶段已把它们按精确 id 删净
  // → 用「清理后快照 === 自测开始前基线」来证明「钱一分没动」（最强的全表口径）
  say('  结算/对账相关接口仍可用：GET /admin/finance/settlements = ' +
    (await call('GET', '/admin/finance/settlements?pageSize=1', null, at)).code)

  // ── 收尾：清理 ──
  say('')
  say('【11. 清理（只删本自测自造的精确 id 集合）】')
  const auditRows = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: TEST_START },
      OR: [
        {
          entityId: {
            in: [
              BigInt(orderA),
              BigInt(orderB),
              ...created.taskIds.map((t) => BigInt(t)),
              BigInt(created.purchaserId || 0),
              BigInt(created.userId || 0),
            ],
          },
        },
        { action: 'GENERATE_SETTLEMENT' },
      ],
    },
    select: { id: true, action: true, entity: true, entityId: true },
  })
  created.auditRowIds = auditRows.map((a) => Number(a.id))

  const willDelete = {
    由: '卡AH 自测脚本 unpaid-mark-test.js（只删本脚本自造的精确 id）',
    时间: new Date().toISOString(),
    orderIds: created.orderIds,
    deliveryTaskIds: created.taskIds,
    paymentRecordIds: created.paymentRecordIds,
    settlementIds: created.settlementIds,
    auditRowIds: created.auditRowIds,
    purchaserId: created.purchaserId,
    userId: created.userId,
  }
  fs.writeFileSync(path.join(EVID_DIR, '清理-将删清单.json'), JSON.stringify(willDelete, null, 2), 'utf8')
  say('  「将删清单」已落盘：自测证据/cardAH-20260930/清理-将删清单.json')
  say('  将删：订单 ' + created.orderIds.length + ' / 任务 ' + created.taskIds.length +
    ' / 支付流水 ' + created.paymentRecordIds.length + ' / 结算 ' + created.settlementIds.length +
    ' / 审计 ' + created.auditRowIds.length + ' / 采购方 1 / 用户 1')

  const oids = created.orderIds.map((i) => BigInt(i))
  const pids = created.settlementIds.map((i) => BigInt(i))
  const tids = created.taskIds.map((i) => BigInt(i))
  const aids = created.auditRowIds.map((i) => BigInt(i))
  const PID = BigInt(created.purchaserId)
  const UID = BigInt(created.userId)

  // ⚠️ 顺序 = 子表 → 父表；**每一张引用了 order_id / purchaser_id / user_id 的表都要覆盖**，
  //    漏一张就会撞 FK（首次中止那次就是漏了 verification_log 与 cartItem 字段名）。
  await prisma.orderShipping.deleteMany({ where: { orderId: { in: oids } } })
  await prisma.paymentRecord.deleteMany({ where: { orderId: { in: oids } } })
  await prisma.aftersaleOrder.deleteMany({ where: { orderId: { in: oids } } })
  await prisma.deliveryException.deleteMany({ where: { orderId: { in: oids } } })
  await prisma.orderItem.deleteMany({ where: { orderId: { in: oids } } })
  if (pids.length) await prisma.settlement.deleteMany({ where: { id: { in: pids } } })
  if (aids.length) await prisma.auditLog.deleteMany({ where: { id: { in: aids } } })
  await prisma.deliveryTask.deleteMany({ where: { id: { in: tids } } })
  await prisma.order.deleteMany({ where: { id: { in: oids } } })
  // —— 采购方档案侧（引用 purchaser.id 的全部表）——
  await prisma.purchaseBill.deleteMany({ where: { purchaserId: PID } })
  await prisma.verificationLog.deleteMany({ where: { purchaserId: PID } })
  await prisma.appealRecord.deleteMany({ where: { purchaserId: PID } })
  await prisma.purchaseDemandItem.deleteMany({ where: { purchaserId: PID } })
  await prisma.demandNotifyLog.deleteMany({ where: { purchaserId: PID } })
  await prisma.demandSubscribeQuota.deleteMany({ where: { purchaserId: PID } })
  await prisma.cartItem.deleteMany({ where: { userId: UID } }) // ⚠️ cart_item 的外键是 user_id，不是 purchaser_id
  await prisma.purchaser.deleteMany({ where: { id: PID } })
  await prisma.user.deleteMany({ where: { id: UID } })

  // ── 残留 = 0 断言 ──
  const residual = {
    orders: await prisma.order.count({ where: { id: { in: oids } } }),
    orderItems: await prisma.orderItem.count({ where: { orderId: { in: oids } } }),
    paymentRecords: await prisma.paymentRecord.count({ where: { orderId: { in: oids } } }),
    orderShipping: await prisma.orderShipping.count({ where: { orderId: { in: oids } } }),
    aftersale: await prisma.aftersaleOrder.count({ where: { orderId: { in: oids } } }),
    deliveryExceptions: await prisma.deliveryException.count({ where: { orderId: { in: oids } } }),
    deliveryTasks: tids.length ? await prisma.deliveryTask.count({ where: { id: { in: tids } } }) : 0,
    settlements: pids.length ? await prisma.settlement.count({ where: { id: { in: pids } } }) : 0,
    auditRows: aids.length ? await prisma.auditLog.count({ where: { id: { in: aids } } }) : 0,
    purchaseBills: await prisma.purchaseBill.count({ where: { purchaserId: PID } }),
    verificationLogs: await prisma.verificationLog.count({ where: { purchaserId: PID } }),
    purchasers: await prisma.purchaser.count({ where: { id: PID } }),
    users: await prisma.user.count({ where: { id: UID } }),
    cartItems: await prisma.cartItem.count({ where: { userId: UID } }),
  }
  say('  残留检查：' + JSON.stringify(residual))
  check('残留 = 0（订单/明细/流水/发货台账/售后/异常工单/任务/结算/审计/账单/核实记录/采购方/用户/购物车 全部清空）',
    Object.values(residual).every((v) => v === 0), residual)

  const moneyAfter = await moneySnapshot()
  say('  清理后资金快照：' + JSON.stringify(moneyAfter))
  check('钱一分没动：全表订单/明细/结算 条数与金额与「自测开始前基线」逐字段相等',
    jsonEqual(moneyBaseline, moneyAfter), { before: moneyBaseline, after: moneyAfter })

  // ── 汇总 ──
  say('')
  say('='.repeat(56))
  say(`卡AH 自测结果：✅ 通过 ${passed} 项 / ❌ 失败 ${failed} 项`)
  say('='.repeat(56))
  fs.writeFileSync(path.join(EVID_DIR, 'unpaid-mark-test-输出.txt'), evidenceLines.join('\n'), 'utf8')
  await prisma.$disconnect()
  process.exit(failed ? 1 : 0)
}

main().catch(async (e) => {
  say('')
  say('脚本异常终止：' + (e && e.stack ? e.stack : e))
  say('⚠️ 可能有残留，请按 自测证据/cardAH-20260930/清理-将删清单.json 手工清理')
  try { await prisma.$disconnect() } catch (_) {}
  process.exit(1)
})
