/**
 * 卡AG（2026-09-30）· 客户侧付款文案 + 「支付即收货」—— 端到端自测
 *
 * 覆盖任务书「第四节 验收判据」1~8：
 *   1  采购方列表/详情：COD 已送达未收 与 unpaid 档**都显示「未支付」**
 *   2  同一单在**运营后台**仍是「待收款」（同源不同受众）；配送员端不消费后端文案
 *   3  采购方侧文案只有客户版三种取值（不出现「待收款」这种第三套）
 *   4  线上支付成功（**真实微信沙箱链路** + **mock 模拟通道**各一单）→ 订单 60→70，
 *      且客户侧文案变「已付款 · 微信直接支付」，全程无需人工
 *   5  订单**不是 60** 时支付成功 → 状态不动（10 的单走既有 10→30；非 10/60 的单回调只落已支付不动）
 *   6  配送员提交收款凭证 → 订单 60→70，客户侧文案变「已付款 · 扫码付款」
 *   7  老接口 POST /order/:id/receive 仍可用（60→70）
 *   8  钱一分没动：订单/明细金额逐字段相等；结算单仍能生成（**60 档的单也要能进结算**）
 *   9  跑完清理自造数据，并断言「残留 = 0」（异常退出也走清理）
 *
 * 用法（backend 目录，**前台**跑；脚本自己拉假微信服务 + 后端实例）：
 *   npm run build && node scripts/pay-status-audience-test.js
 *
 * 端口隔离（不碰别人的 3001/3011/3016/3953）：
 *   假微信支付服务器 3954 ｜ 本脚本后端实例 3017
 *
 * ⚠️ 本脚本必须自己加载 backend/.env（Prisma 不自动读 .env），写法与 account-cancel-test.js /
 *    aftersale-ledger-test.js 一致；WXPAY_* 自签测试材料来自 自测证据/wxpay-local/test.env
 *    （由 wxpay-fake-server.js 首次启动时生成，与生产凭证无关）。
 * ⚠️ 库为真实开发库 —— 自造数据全部登记、跑完（含异常退出）按主键/精确 openid 清理，并断言残留=0。
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const BACKEND_DIR = path.resolve(__dirname, '..')
const PROJECT_ROOT = path.resolve(BACKEND_DIR, '..')
const DATA_DIR = path.join(PROJECT_ROOT, '自测证据', 'wxpay-local')
const FAKE_PORT = Number(process.env.AG_FAKE_PORT || 3954)
const PORT = Number(process.env.AG_PORT || 3017)
const BASE = `http://127.0.0.1:${PORT}/api/v1`
const FAKE = `http://127.0.0.1:${FAKE_PORT}`

/* ───────────────── 自己加载 backend/.env（Prisma 不自动读） ───────────────── */
function parseEnvFile(p) {
  const out = {}
  if (!fs.existsSync(p)) return out
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}
const backendEnv = parseEnvFile(path.join(BACKEND_DIR, '.env'))
if (!backendEnv.DATABASE_URL) {
  console.error('❌ 未读到 backend/.env 的 DATABASE_URL —— 本脚本必须自己加载 backend/.env')
  process.exit(1)
}
for (const [k, v] of Object.entries(backendEnv)) if (process.env[k] === undefined) process.env[k] = v

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    failures.push(name)
    let d = detail
    try {
      JSON.stringify(d)
    } catch {
      d = String(d)
    }
    console.log(`  ❌ ${name}${d !== undefined ? `  → 实际：${JSON.stringify(d)}` : ''}`)
  }
}

const children = new Map()
const spawnNode = (key, script, env, tag) => {
  const child = spawn(process.execPath, [script], { cwd: BACKEND_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', () => {})
  child.stderr.on('data', (d) => process.stderr.write(`[${tag}][stderr] ${d}`))
  children.set(key, child)
  return child
}
const killAll = () => {
  for (const [, c] of children) {
    try {
      c.kill()
    } catch {
      /* 忽略 */
    }
  }
  children.clear()
}
process.on('exit', killAll)
process.on('SIGINT', () => {
  killAll()
  process.exit(130)
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitHttp = async (url, timeoutMs = 60000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url)
      return true
    } catch {
      await sleep(500)
    }
  }
  return false
}

const fetchJson = async (method, url, body, token) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 空体 */
  }
  return { status: res.status, json }
}

/* ───────────────── 文案常量（与 pay-status.util 对齐；改文案要同步改这里） ───────────────── */
const T_BUYER_UNPAID = '未支付'
const T_OP_PENDING = '待收款' // 运营版（cod_pending）
const T_PAID_WECHAT = '已付款 · 微信直接支付'
const T_PAID_PROOF = '已付款 · 扫码付款'
const T_GROUP_UNPAID = '未收'
const BUYER_TEXTS = [T_BUYER_UNPAID, T_PAID_WECHAT, T_PAID_PROOF] // 客户侧只允许出现这三种

/* ───────────────── 自造数据登记（清理与「残留=0」复核全靠它） ───────────────── */
const created = {
  userIds: [],
  openids: [],
  purchaserIds: [],
  supplierIds: [],
  courierIds: [],
  orderIds: [],
  orderItemIds: [],
  payNos: [],
  settlementIds: [],
  auditIds: [],
}

let prisma = null

/// 清理自造数据并返回残留计数（异常退出也会调它，绝不留脏数据）
async function cleanupResidue() {
  if (!prisma) return null
  const genAudits = await prisma.auditLog.findMany({
    where: { entity: 'settlement', action: 'GENERATE_SETTLEMENT', id: { gt: created.auditMaxBeforeGenerate ?? 0n } },
    select: { id: true },
  })
  const orderAudits = await prisma.auditLog.findMany({
    where: { entity: 'order', entityId: { in: created.orderIds } },
    select: { id: true },
  })
  created.auditIds = [...new Set([...created.auditIds, ...orderAudits.map((a) => a.id), ...genAudits.map((a) => a.id)])]

  await prisma.auditLog.deleteMany({ where: { id: { in: created.auditIds } } })
  await prisma.paymentRecord.deleteMany({ where: { payNo: { in: created.payNos } } })
  await prisma.orderItem.deleteMany({ where: { id: { in: created.orderItemIds } } })
  await prisma.cartItem.deleteMany({ where: { userId: { in: created.userIds } } })
  await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } })
  await prisma.settlement.deleteMany({ where: { id: { in: created.settlementIds } } })
  await prisma.courier.deleteMany({ where: { id: { in: created.courierIds } } })
  await prisma.supplier.deleteMany({ where: { id: { in: created.supplierIds } } })
  await prisma.purchaser.deleteMany({ where: { id: { in: created.purchaserIds } } })
  await prisma.user.deleteMany({
    where: { OR: [{ id: { in: created.userIds } }, { wxOpenid: { in: created.openids } }] },
  })

  return {
    user: await prisma.user.count({ where: { OR: [{ id: { in: created.userIds } }, { wxOpenid: { in: created.openids } }] } }),
    purchaser: await prisma.purchaser.count({ where: { id: { in: created.purchaserIds } } }),
    supplier: await prisma.supplier.count({ where: { id: { in: created.supplierIds } } }),
    courier: await prisma.courier.count({ where: { id: { in: created.courierIds } } }),
    order: await prisma.order.count({ where: { id: { in: created.orderIds } } }),
    orderItem: await prisma.orderItem.count({ where: { id: { in: created.orderItemIds } } }),
    pay: await prisma.paymentRecord.count({ where: { payNo: { in: created.payNos } } }),
    settlement: await prisma.settlement.count({ where: { id: { in: created.settlementIds } } }),
    audit: await prisma.auditLog.count({ where: { id: { in: created.auditIds } } }),
  }
}

async function main() {
  if (!fs.existsSync(path.join(BACKEND_DIR, 'dist', 'main.js'))) {
    console.log('❌ 未找到 dist/main.js —— 请先 cd backend && npm run build')
    process.exit(1)
  }
  const { PrismaClient } = require('@prisma/client')
  prisma = new PrismaClient()

  console.log('\n═══ 卡AG 客户侧付款文案 + 支付即收货 自测 ═══\n')

  // ────────────────────────────────────────
  // 0. 假微信支付服务器 + 后端隔离实例
  // ────────────────────────────────────────
  console.log('【0】启动假微信支付服务器 + 后端隔离实例')
  spawnNode(
    'fake',
    path.join(BACKEND_DIR, 'scripts', 'wxpay-fake-server.js'),
    { ...process.env, FAKE_WXPAY_PORT: String(FAKE_PORT), FAKE_WXPAY_DIR: DATA_DIR },
    'fake',
  )
  const fakeUp = await waitHttp(`${FAKE}/__log`, 25000)
  check('假微信支付服务器就绪', fakeUp)
  if (!fakeUp) {
    killAll()
    process.exit(1)
  }
  const testEnv = parseEnvFile(path.join(DATA_DIR, 'test.env'))

  spawnNode(
    'backend',
    path.join(BACKEND_DIR, 'dist', 'main.js'),
    {
      ...process.env,
      ...backendEnv,
      ...testEnv, // WXPAY_* 自签测试材料
      PORT: String(PORT),
      WXPAY_API_BASE: FAKE,
      WXPAY_NOTIFY_URL: `${BASE}/payment/wechat/notify`,
      WX_MOCK_LOGIN: '1',
      WX_MOCK_PAY: '1', // 本卡要验 mock 通道的 60→70，故打开
      ORDER_SHIPPING_CRON: '0 0 3 * * *', // 别让补偿任务在自测期间乱跑
    },
    'backend',
  )
  const up = await waitHttp(`${BASE}/product/categories`)
  check(`后端实例(${PORT}) 就绪`, up)
  if (!up) {
    killAll()
    process.exit(1)
  }

  const call = (method, p, body, token) => fetchJson(method, BASE + p, body, token)
  const login = async (code) => {
    const r = await call('POST', '/auth/wx-login', { code })
    if (r.json?.code !== 0) throw new Error(`登录失败(${code})：${JSON.stringify(r.json)}`)
    return r.json.data
  }
  const fakeNotify = (outTradeNo) => fetchJson('POST', `${FAKE}/__notify`, { outTradeNo })

  const PAY_SECRET = backendEnv.PAY_CALLBACK_SECRET
  const mockSign = (payNo, amount) =>
    crypto.createHmac('sha256', PAY_SECRET).update(`${payNo}|${Number(amount)}`).digest('hex')

  const TS = Date.now()
  // ⚠️ mock 登录下 openid = `dev_${code}`（auth.service），所以自造用户的 openid 必须由登录 code 反推
  const CODE = { buyer: `ag_buyer_${TS}`, supplier: `ag_supplier_${TS}`, courier: `ag_courier_${TS}` }
  const OPENID = { buyer: `dev_${CODE.buyer}`, supplier: `dev_${CODE.supplier}`, courier: `dev_${CODE.courier}` }
  // 对账按「送达日」查 —— 本卡用例单的送达日都用今天
  const todayStr = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const day = new Date(`${todayStr}T00:00:00.000Z`)
  const SETTLE_PERIOD = '2099-01' // 自造账期：与任何真实数据都不重叠，便于精确清理
  const settleDay = new Date('2099-01-15T00:00:00.000Z')

  // ────────────────────────────────────────
  // 1. fixture（全部自造、带标记）
  // ────────────────────────────────────────
  console.log('\n【1】准备自造数据')
  const product = await prisma.product.findFirst({ where: { status: 1 } })
  if (!product) throw new Error('库里没有在售商品，无法造订单明细')

  let userSeq = 0
  const mkUser = async (tag, openid) => {
    // phone 是 user 表唯一键 → 每个自造用户必须给不同号码（3 + 6 + 2 = 11 位）
    const seq = ++userSeq
    const phone = '138' + String(TS).slice(-6) + String(seq).padStart(2, '0')
    const u = await prisma.user.create({
      data: { wxOpenid: openid, name: `卡AG${tag}`, phone, roles: [], status: 1 },
    })
    created.userIds.push(u.id)
    created.openids.push(openid)
    return u
  }

  const buyerUser = await mkUser('buyer', OPENID.buyer)
  const purchaser = await prisma.purchaser.create({
    data: {
      userId: buyerUser.id,
      shopName: `卡AG自测店${TS}`,
      contact: '卡AG',
      phone: buyerUser.phone,
      address: '卡AG自测地址',
      deliveryWindows: ['中 10-13'],
      accountStatus: 2, // 2 = ACTIVE，下单/支付接口才放行
    },
  })
  created.purchaserIds.push(purchaser.id)

  const supUser = await mkUser('supplier', OPENID.supplier)
  const supplier = await prisma.supplier.create({
    data: { userId: supUser.id, stallName: `卡AG自测档口${TS}`, address: '卡AG', status: 1, qualification: {} },
  })
  created.supplierIds.push(supplier.id)

  const courierUser = await mkUser('courier', OPENID.courier)
  const courier = await prisma.courier.create({ data: { userId: courierUser.id, source: 1, status: 1 } })
  created.courierIds.push(courier.id)

  const buyerToken = (await login(CODE.buyer)).token
  const supplierToken = (await login(CODE.supplier)).token
  const courierToken = (await login(CODE.courier)).token
  const adminToken = (await login('admin')).token
  check('四个身份都拿到 token', !!buyerToken && !!supplierToken && !!courierToken && !!adminToken, {
    buyer: !!buyerToken, supplier: !!supplierToken, courier: !!courierToken, admin: !!adminToken,
  })

  /** 造订单（直接落库，绕开注册/审核/拆单等无关链路） */
  const mkOrder = async (status, opts = {}) => {
    const o = await prisma.order.create({
      data: {
        purchaserId: purchaser.id,
        deliveryDate: opts.deliveryDate || day,
        timeWindow: 2,
        status,
        amountOrdered: opts.amountOrdered ?? 100,
        amountFinal: opts.amountFinal ?? null,
        deliveryFee: opts.deliveryFee ?? 5,
        payMethod: opts.payMethod ?? 2,
        remark: '卡AG自测',
      },
    })
    created.orderIds.push(o.id)
    return o
  }
  const mkItem = async (orderId, opts = {}) => {
    const it = await prisma.orderItem.create({
      data: {
        orderId,
        productId: product.id,
        supplierId: opts.supplierId ?? supplier.id,
        qtyOrdered: opts.qtyOrdered ?? 10,
        qtyAccepted: opts.qtyAccepted ?? 10,
        qtyReceived: opts.qtyReceived ?? null,
        salePrice: opts.salePrice ?? 2.5,
        supplyPrice: opts.supplyPrice ?? 2,
      },
    })
    created.orderItemIds.push(it.id)
    return it
  }
  const mkPayment = async (orderId, opts = {}) => {
    const payNo = crypto.randomBytes(16).toString('hex')
    await prisma.paymentRecord.create({
      data: {
        orderId,
        payNo,
        channel: opts.channel ?? 'wechat',
        amount: opts.amount ?? 105,
        status: opts.status ?? 0,
        paidAt: opts.status === 1 ? new Date() : null,
      },
    })
    created.payNos.push(payNo)
    return payNo
  }

  const round2 = (n) => Math.round(Number(n) * 100) / 100

  // 用例单（判据对应关系见文件头）
  const oCodUnpaid = await mkOrder(60) // 判据 1/2/3：COD 已送达未收
  const oUnpaidNone = await mkOrder(10, { payMethod: 0 }) // 判据 1：unpaid 档
  const oWechatPaid = await mkOrder(60) // 判据 1：已有线上流水 → 已付款·微信直接支付
  const oProof = await mkOrder(60) // 判据 1：已有凭证 → 已付款·扫码付款
  const oCourierProof = await mkOrder(60) // 判据 6：配送员留证 → 70
  const oWechatPay = await mkOrder(60) // 判据 4：真实微信沙箱回调 → 70
  const oMockPay60 = await mkOrder(60) // 判据 4：mock 通道回调 → 70
  const oMockPay10 = await mkOrder(10, { payMethod: 0 }) // 判据 5：10 → 30（不跳 70）
  const oNotDelivered = await mkOrder(60) // 判据 5：回调时已非 60 → 不动
  const oSettle = await mkOrder(60, { deliveryDate: settleDay }) // 判据 7/8：老接口 + 结算 + 钱不动

  const items = {}
  for (const o of [oCodUnpaid, oUnpaidNone, oWechatPaid, oProof, oCourierProof, oWechatPay, oMockPay60, oMockPay10, oNotDelivered]) {
    items[Number(o.id)] = await mkItem(o.id)
  }
  const settleItem = await mkItem(oSettle.id, { qtyAccepted: 8, supplyPrice: 3.5, qtyOrdered: 8 })
  check('用例单与明细已建好', Object.keys(items).length === 9 && !!settleItem.id)

  // 预置：线上已付流水 / 现金凭证（直接落库，用于「文案对照档」，不触发状态推进）
  await mkPayment(oWechatPaid.id, { amount: 105, status: 1 })
  await prisma.order.update({
    where: { id: oProof.id },
    data: { payProof: { photos: ['/uploads/ag-selftest.png'], paidAt: new Date().toISOString() } },
  })

  // ────────────────────────────────────────
  // 2. 判据 1/2/3：采购方=客户版文案、运营=运营版文案（同源不同受众）
  // ────────────────────────────────────────
  console.log('\n【2】判据 1/2/3：客户版 vs 运营版文案（同一单）')
  const detailOf = async (id) => {
    const r = await call('GET', `/order/${id}`, null, buyerToken)
    if (r.json?.code !== 0) console.log(`    (debug) GET /order/${id} → HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 300)}`)
    return r.json?.data
  }
  const listOf = async () => {
    const r = await call('GET', '/order?page=1&pageSize=50', null, buyerToken)
    if (r.json?.code !== 0) console.log(`    (debug) GET /order → HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 300)}`)
    return new Map((r.json?.data?.list || []).map((x) => [x.orderId, x]))
  }

  const dUnpaidCod = await detailOf(Number(oCodUnpaid.id))
  check(`① 采购方详情：COD 已送达未收 → payStatus=cod_pending 但文案「${T_BUYER_UNPAID}」`,
    dUnpaidCod?.payStatus === 'cod_pending' && dUnpaidCod?.payStatusText === T_BUYER_UNPAID, dUnpaidCod?.payStatusText)
  const dUnpaidNone = await detailOf(Number(oUnpaidNone.id))
  check(`① 采购方详情：unpaid 档 → 文案「${T_BUYER_UNPAID}」（与上一档对客户同文案）`,
    dUnpaidNone?.payStatus === 'unpaid' && dUnpaidNone?.payStatusText === T_BUYER_UNPAID, dUnpaidNone?.payStatusText)
  const dWechatPaid = await detailOf(Number(oWechatPaid.id))
  check(`① 采购方详情：有线上流水 → 「${T_PAID_WECHAT}」照旧`, dWechatPaid?.payStatusText === T_PAID_WECHAT, dWechatPaid?.payStatusText)
  const dProof = await detailOf(Number(oProof.id))
  check(`① 采购方详情：有现金凭证 → 「${T_PAID_PROOF}」照旧`, dProof?.payStatusText === T_PAID_PROOF, dProof?.payStatusText)

  const listMap = await listOf()
  check(`① 采购方列表：COD 已送达未收 → 「${T_BUYER_UNPAID}」`, listMap.get(Number(oCodUnpaid.id))?.payStatusText === T_BUYER_UNPAID,
    listMap.get(Number(oCodUnpaid.id))?.payStatusText)
  check(`① 采购方列表：unpaid 档 → 「${T_BUYER_UNPAID}」`, listMap.get(Number(oUnpaidNone.id))?.payStatusText === T_BUYER_UNPAID,
    listMap.get(Number(oUnpaidNone.id))?.payStatusText)

  // 判据 3：客户侧永远不出现「待收款」这种第三套文案
  const myIdSet = new Set(created.orderIds.map(Number))
  const myBuyerTexts = [...listMap.entries()].filter(([id]) => myIdSet.has(id)).map(([, v]) => v.payStatusText)
  check('③ 采购方侧文案只有客户版三种取值（绝不出现「待收款」）',
    myBuyerTexts.length > 0 && myBuyerTexts.every((t) => BUYER_TEXTS.includes(t)), myBuyerTexts)

  // 判据 2：运营后台（每日对账）同一单仍是「待收款」
  const daily = await call('GET', `/admin/finance/daily-reconciliation?date=${todayStr}`, null, adminToken)
  check('运营对账接口可用', daily.json?.code === 0, daily.json?.code)
  const rows = daily.json?.data?.orderList || []
  const opRow = rows.find((x) => x.orderId === Number(oCodUnpaid.id))
  check(`② 运营后台同一单 → 「${T_OP_PENDING}」（payStatusText）`, opRow?.payStatusText === T_OP_PENDING, opRow?.payStatusText)
  check(`② 运营后台同一单 → 归组「${T_GROUP_UNPAID}」+ 子标注「${T_OP_PENDING}」`,
    opRow?.payStatusGroupText === T_GROUP_UNPAID && opRow?.payStatusSubText === T_OP_PENDING,
    { g: opRow?.payStatusGroupText, s: opRow?.payStatusSubText })
  check('② 同一单：客户=「未支付」 与 运营=「待收款」并存（同源不同受众，非第三套）',
    !!opRow && opRow.payStatus === dUnpaidCod?.payStatus && opRow.payStatusText !== dUnpaidCod?.payStatusText)

  // 判据 2（配送员侧）：配送员端不消费后端 payStatusText —— 页面文案是硬编码，本卡未动、也不可能被本卡改变
  const courierDir = path.join(PROJECT_ROOT, 'frontend', 'src', 'subpkg-courier')
  const courierHits = []
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name)
      if (f.isDirectory()) walk(p)
      else if (/\.(vue|js|ts)$/.test(f.name) && fs.readFileSync(p, 'utf8').includes('payStatusText')) courierHits.push(p)
    }
  }
  if (fs.existsSync(courierDir)) walk(courierDir)
  check('② 配送员端不消费后端 payStatusText（文案为页面硬编码「待收款」，本卡零改动）', courierHits.length === 0, courierHits)

  // ────────────────────────────────────────
  // 3. 判据 8（前半）：改动前的钱快照
  // ────────────────────────────────────────
  console.log('\n【3】判据 8：改动前快照（订单/明细金额）')
  // ⚠️ 只比对**金额字段**：payMethod / status 属状态类，本卡预期会变（10→30 会置 payMethod=1），不算「钱」；
  //    oSettle 走的是老接口 receive（它会写 qtyReceived，既有行为），它的"钱没动"由下方 Settlement
  //    生成前后逐字段比对覆盖，故不进本快照。
  const moneyOrderIds = [oCourierProof.id, oWechatPay.id, oMockPay60.id, oMockPay10.id, oNotDelivered.id]
  const snap = (o) => JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? v.toString() : v)) // BigInt 不能直接序列化
  const moneySnapshot = async () => {
    const orders = await prisma.order.findMany({
      where: { id: { in: moneyOrderIds } },
      select: { id: true, amountOrdered: true, amountFinal: true, deliveryFee: true },
      orderBy: { id: 'asc' },
    })
    const its = await prisma.orderItem.findMany({
      where: { orderId: { in: moneyOrderIds } },
      select: { id: true, orderId: true, qtyOrdered: true, qtyDeclared: true, qtyAccepted: true, qtyReceived: true, salePrice: true, supplyPrice: true, supplierId: true },
      orderBy: { id: 'asc' },
    })
    return snap({ orders, items: its })
  }
  const moneyBefore = await moneySnapshot()
  check('钱快照已取（订单 + 明细逐字段）', moneyBefore.length > 0)

  // ────────────────────────────────────────
  // 4. 判据 6：配送员提交收款凭证 → 60→70
  // ────────────────────────────────────────
  console.log('\n【4】判据 6：配送员提交收款凭证 → 订单 60→70')
  const proofRes = await call('POST', `/courier/order/${Number(oCourierProof.id)}/pay-proof`,
    { photos: ['/uploads/ag-proof-1.png'] }, courierToken)
  check('配送员收款凭证接口成功', proofRes.json?.code === 0, proofRes.json)
  const oCourierAfter = await prisma.order.findUnique({ where: { id: oCourierProof.id } })
  check('订单 60 → 70（钱到账 = 收货完成）', oCourierAfter.status === 70, oCourierAfter.status)
  const dCourierAfter = await detailOf(Number(oCourierProof.id))
  check(`客户侧文案变「${T_PAID_PROOF}」`, dCourierAfter?.payStatus === 'paid_proof' && dCourierAfter?.payStatusText === T_PAID_PROOF, dCourierAfter?.payStatusText)
  const courierAudit = await prisma.auditLog.findFirst({
    where: { entity: 'order', entityId: oCourierProof.id, action: 'ORDER_COMPLETE_ON_PAYMENT' },
    orderBy: { id: 'desc' },
  })
  check('审计 ORDER_COMPLETE_ON_PAYMENT，source=courier-pay-proof',
    courierAudit?.after?.source === 'courier-pay-proof', courierAudit?.after)

  // ────────────────────────────────────────
  // 5. 判据 4：线上支付成功 → 60→70（真实微信沙箱 + mock 通道各一单）
  // ────────────────────────────────────────
  console.log('\n【5】判据 4：线上支付成功 → 60→70 + 客户文案变「已付款 · 微信直接支付」')
  // 5a. 真实微信沙箱链路（prepay → 假微信回调 notify）
  const prepay = await call('POST', '/payment/wechat/prepay', { orderId: Number(oWechatPay.id) }, buyerToken)
  check('微信 prepay 成功（金额服务端取数）', prepay.json?.code === 0 && !!prepay.json?.data?.payNo, prepay.json)
  const wechatPayNo = prepay.json?.data?.payNo
  if (wechatPayNo) created.payNos.push(wechatPayNo)
  const notify = wechatPayNo ? await fakeNotify(wechatPayNo) : { json: null }
  check('假微信回调投递后端 200', notify.json?.backendStatus === 200, notify.json)
  const oWechatAfter = await prisma.order.findUnique({ where: { id: oWechatPay.id } })
  check('订单 60 → 70（微信回调）', oWechatAfter.status === 70, oWechatAfter.status)
  const dWechatAfter = await detailOf(Number(oWechatPay.id))
  check(`客户侧文案变「${T_PAID_WECHAT}」（无需人工）`,
    dWechatAfter?.payStatus === 'paid_wechat' && dWechatAfter?.payStatusText === T_PAID_WECHAT, dWechatAfter?.payStatusText)
  const wxAudit = await prisma.auditLog.findFirst({
    where: { entity: 'order', entityId: oWechatPay.id, action: 'ORDER_COMPLETE_ON_PAYMENT' },
    orderBy: { id: 'desc' },
  })
  check('审计 ORDER_COMPLETE_ON_PAYMENT，source=wechat-notify', wxAudit?.after?.source === 'wechat-notify', wxAudit?.after)

  // 5b. mock 模拟通道（本地开发链路；与真实通道同口径）
  const mockPayNo = await mkPayment(oMockPay60.id, { channel: 'mock', amount: 105, status: 0 })
  const mockCb = await call('POST', '/payment/mock/callback', { payNo: mockPayNo, signature: mockSign(mockPayNo, 105) })
  check('mock 回调成功', mockCb.json?.code === 0 && mockCb.json?.data?.status === 1, mockCb.json)
  const oMockAfter = await prisma.order.findUnique({ where: { id: oMockPay60.id } })
  check('订单 60 → 70（mock 通道）', oMockAfter.status === 70, oMockAfter.status)
  const mockAudit = await prisma.auditLog.findFirst({
    where: { entity: 'order', entityId: oMockPay60.id, action: 'ORDER_COMPLETE_ON_PAYMENT' },
    orderBy: { id: 'desc' },
  })
  check('审计 ORDER_COMPLETE_ON_PAYMENT，source=mock-callback', mockAudit?.after?.source === 'mock-callback', mockAudit?.after)

  // ────────────────────────────────────────
  // 6. 判据 5：订单不是 60 时支付成功 → 状态不动
  // ────────────────────────────────────────
  console.log('\n【6】判据 5：订单不是 60 → 支付成功也**不跳到 70**')
  // 6a. 待确认(10) 的单支付成功 → 走既有 10→30，绝不跳 70
  const pay10 = await call('POST', `/order/${Number(oMockPay10.id)}/pay`, { payMethod: 1 }, buyerToken)
  check('待确认单创建支付单成功', pay10.json?.code === 0 && !!pay10.json?.data?.payNo, pay10.json)
  const p10No = pay10.json?.data?.payNo
  if (p10No) created.payNos.push(p10No)
  const cb10 = p10No
    ? await call('POST', '/payment/mock/callback', { payNo: p10No, signature: mockSign(p10No, pay10.json.data.amount) })
    : { json: null }
  check('回调成功', cb10.json?.code === 0, cb10.json)
  const o10After = await prisma.order.findUnique({ where: { id: oMockPay10.id } })
  check('订单 10 → 30（既有口径），**不是 70**', o10After.status === 30, o10After.status)
  const noAudit10 = await prisma.auditLog.findFirst({
    where: { entity: 'order', entityId: oMockPay10.id, action: 'ORDER_COMPLETE_ON_PAYMENT' },
  })
  check('未写 ORDER_COMPLETE_ON_PAYMENT 审计（没误触发）', noAudit10 === null, noAudit10 ? Number(noAudit10.id) : null)

  // 6b. 回调到达时订单已不是 60（配送中 50）→ 只落「已支付」，订单原地不动
  const prepay2 = await call('POST', '/payment/wechat/prepay', { orderId: Number(oNotDelivered.id) }, buyerToken)
  check('（沙箱）COD 送达单 prepay 成功', prepay2.json?.code === 0 && !!prepay2.json?.data?.payNo, prepay2.json)
  const ndNo = prepay2.json?.data?.payNo
  if (ndNo) created.payNos.push(ndNo)
  await prisma.order.update({ where: { id: oNotDelivered.id }, data: { status: 50 } }) // 模拟"钱到账时订单已非 60"
  const notify2 = ndNo ? await fakeNotify(ndNo) : { json: null }
  check('假微信回调投递后端 200', notify2.json?.backendStatus === 200, notify2.json)
  const oNdAfter = await prisma.order.findUnique({ where: { id: oNotDelivered.id } })
  const ndRec = ndNo ? await prisma.paymentRecord.findUnique({ where: { payNo: ndNo } }) : null
  check('流水已支付（钱确实记上了）', ndRec?.status === 1, ndRec?.status)
  check('订单状态**原地不动**（仍 50，不跳 70）', oNdAfter.status === 50, oNdAfter.status)
  const ndAudit = await prisma.auditLog.findFirst({
    where: { entity: 'order', entityId: oNotDelivered.id, action: 'ORDER_COMPLETE_ON_PAYMENT' },
  })
  check('未写 ORDER_COMPLETE_ON_PAYMENT 审计', ndAudit === null, ndAudit ? Number(ndAudit.id) : null)

  // ────────────────────────────────────────
  // 7. 判据 7 + 8：老接口仍可用；结算单仍能生成（60 档）；钱一分没动
  // ────────────────────────────────────────
  console.log('\n【7】判据 7/8：老接口 receive 仍可用 + 结算可生成 + 钱一分没动')
  const settleItemSnapshot = await prisma.orderItem.findUnique({ where: { id: settleItem.id } })
  created.auditMaxBeforeGenerate = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? 0n
  const gen1 = await call('POST', '/admin/finance/generate', { period: SETTLE_PERIOD }, adminToken)
  check('结算单生成成功（60 档的单也进结算）', gen1.json?.code === 0, gen1.json)
  const settlementAfterGen = await prisma.settlement.findUnique({
    where: { supplierId_period: { supplierId: supplier.id, period: SETTLE_PERIOD } },
  })
  if (settlementAfterGen) created.settlementIds.push(settlementAfterGen.id)
  check('本档口生成了结算单', !!settlementAfterGen)
  const expectBase = round2(Number(settleItemSnapshot.qtyAccepted) * Number(settleItemSnapshot.supplyPrice))
  check(`结算基数 = qtyAccepted × supplyPrice = ${expectBase}`,
    !!settlementAfterGen && Number(settlementAfterGen.grossAmount) === expectBase,
    settlementAfterGen ? Number(settlementAfterGen.grossAmount) : null)
  const settleSnapA = settlementAfterGen
    ? snap({ gross: String(settlementAfterGen.grossAmount), rate: String(settlementAfterGen.serviceFeeRate), fee: String(settlementAfterGen.serviceFee), net: String(settlementAfterGen.netAmount), status: settlementAfterGen.status })
    : ''
  const supplierView = await call('GET', `/supplier-finance/settlement/${SETTLE_PERIOD}`, null, supplierToken)
  check('供应商端能查到本期结算单且含该明细（60 档进结算）',
    supplierView.json?.code === 0 &&
      (supplierView.json?.data?.items || []).some((x) => Number(x.subtotal) === expectBase),
    supplierView.json?.data?.items)

  // 老接口：60 → 70（本卡只下线前端入口，接口一行未删）
  const recv = await call('POST', `/order/${Number(oSettle.id)}/receive`,
    { items: [{ orderItemId: Number(settleItem.id), qtyReceived: Number(settleItem.qtyAccepted), rejectQty: 0 }] }, buyerToken)
  check('老接口 POST /order/:id/receive 仍可用（60→70）', recv.json?.code === 0 && recv.json?.data?.status === 70, recv.json)

  // 状态变了，钱不能再动 —— 结算重算逐字段相等
  const gen2 = await call('POST', '/admin/finance/generate', { period: SETTLE_PERIOD }, adminToken)
  check('状态 60→70 后结算单可再次生成', gen2.json?.code === 0, gen2.json)
  const settlementAfterGen2 = await prisma.settlement.findUnique({
    where: { supplierId_period: { supplierId: supplier.id, period: SETTLE_PERIOD } },
  })
  const settleSnapB = settlementAfterGen2
    ? snap({ gross: String(settlementAfterGen2.grossAmount), rate: String(settlementAfterGen2.serviceFeeRate), fee: String(settlementAfterGen2.serviceFee), net: String(settlementAfterGen2.netAmount), status: settlementAfterGen2.status })
    : ''
  check('结算单金额字段逐字段相等（状态变更不影响钱）', settleSnapA !== '' && settleSnapA === settleSnapB, { A: settleSnapA, B: settleSnapB })

  const moneyAfter = await moneySnapshot()
  check('订单/明细金额字段逐字段相等（钱一分没动）', moneyBefore === moneyAfter, {
    before: moneyBefore.slice(0, 200), after: moneyAfter.slice(0, 200),
  })

  // ────────────────────────────────────────
  // 8. 清理 + 残留复核
  // ────────────────────────────────────────
  console.log('\n【8】清理自造数据 → 复核残留=0')
  const residue = await cleanupResidue()
  console.log('  清理后残留：' + JSON.stringify(residue))
  check('9.1 残留 user = 0', residue.user === 0, residue.user)
  check('9.2 残留 purchaser = 0', residue.purchaser === 0, residue.purchaser)
  check('9.3 残留 supplier = 0', residue.supplier === 0, residue.supplier)
  check('9.4 残留 courier = 0', residue.courier === 0, residue.courier)
  check('9.5 残留 order = 0', residue.order === 0, residue.order)
  check('9.6 残留 order_item = 0', residue.orderItem === 0, residue.orderItem)
  check('9.7 残留 payment_record = 0', residue.pay === 0, residue.pay)
  check('9.8 残留 settlement = 0', residue.settlement === 0, residue.settlement)
  check('9.9 残留 audit_log = 0', residue.audit === 0, residue.audit)

  console.log('\n' + '='.repeat(64))
  console.log(`卡AG 自测完成：通过 ${pass} / 失败 ${fail}`)
  if (failures.length) console.log('失败项：\n  - ' + failures.join('\n  - '))
  console.log('='.repeat(64))
  await prisma.$disconnect()
  killAll()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('脚本异常：', e)
  killAll()
  // ⚠️ 异常退出也要清干净（本卡判据 9 要求"跑完残留=0"）
  try {
    const residue = await cleanupResidue()
    if (residue) console.error('异常退出清理后残留：', JSON.stringify(residue))
  } catch (e2) {
    console.error('异常退出清理失败（需人工核对）：', e2)
  }
  if (prisma) await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
