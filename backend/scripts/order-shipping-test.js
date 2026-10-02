/**
 * 卡S1 自测：小程序发货信息管理 + 订单详情按 payNo 直达 + COD 线上收款联动
 *
 * 运行（backend 目录下，前台或走管道）：node scripts/order-shipping-test.js
 * 前置：cd backend && npm run build（已产出 dist）；本机 MySQL 可用；**不依赖任何真实凭证**。
 *
 * 端口隔离（不碰别人的 3001）：假小程序服务 3956 ｜ 后端实例 3015
 *
 * 覆盖（对应卡S1 第三节验收）：
 *   1 送达即录入：COD「已线上支付」单自动录入，付款的现金单不调微信
 *   2 录入成功 → 请求体逐项断言（order_number_type=1 / logistics_type=2 / item_desc 非空 / upload_time 是 RFC 3339 / openid）
 *   3 重复录入幂等 → 不再打微信（微信侧一笔支付单只有一次"重新发货"机会）
 *   4 录入失败 → 订单主流程不受影响 + 台账落 retry + 补偿任务能捞出来重试成功
 *   5 10060003（重新发货机会已用掉）→ 终态，补偿任务不再打微信
 *   6 GET /order/by-pay-no/:payNo 只能查到自己订单（换人 → 业务错；格式非法 → 1001）
 *   7 COD 线上到账后：订单详情 onlinePaidAt 有值、现金单为 null；配送员「交付后待收款」队列**排除**已线上收款单
 *   8 平台状态 / 特殊发货报备（含参数校验）
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const BACKEND_DIR = path.resolve(__dirname, '..')
const FAKE_PORT = 3956
const PORT = 3015
const BASE = `http://127.0.0.1:${PORT}/api/v1`

let passed = 0
let failed = 0
const children = new Map()

function check(name, cond, extra) {
  if (cond) {
    passed++
    console.log('  ✅ ' + name)
  } else {
    failed++
    console.log('  ❌ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''))
  }
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

function parseEnvFile(p) {
  const out = {}
  if (!fs.existsSync(p)) return out
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '')
  }
  return out
}

function spawnNode(key, script, env) {
  const child = spawn(process.execPath, [script], { cwd: BACKEND_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', () => {})
  child.stderr.on('data', (d) => process.stderr.write(`[${key}][stderr] ${d}`))
  children.set(key, child)
  return child
}

const waitHttp = async (url, timeoutMs = 60000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url)
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  return false
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
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/

async function main() {
  if (!fs.existsSync(path.join(BACKEND_DIR, 'dist', 'main.js'))) {
    console.log('❌ 未找到 dist/main.js —— 请先 cd backend && npm run build')
    process.exit(1)
  }
  const backendEnv = parseEnvFile(path.join(BACKEND_DIR, '.env'))
  for (const [k, v] of Object.entries(backendEnv)) if (process.env[k] === undefined) process.env[k] = v

  const { PrismaClient } = require('@prisma/client')
  const jwt = require('jsonwebtoken')
  const prisma = new PrismaClient()

  console.log('='.repeat(64))
  console.log('【0. 启动假小程序服务(3956) + 后端隔离实例(3015)】')
  console.log('='.repeat(64))
  spawnNode('fake', path.join(BACKEND_DIR, 'scripts', 'wx-shipping-fake-server.js'), {
    ...process.env,
    FAKE_SHIP_PORT: String(FAKE_PORT),
  })
  const fakeUp = await waitHttp(`http://127.0.0.1:${FAKE_PORT}/__log`, 20000)
  check('假小程序服务就绪', fakeUp)
  if (!fakeUp) {
    killAll()
    process.exit(1)
  }
  const fakeMode = (m) => fetchJson('POST', `http://127.0.0.1:${FAKE_PORT}/__mode`, m)
  const fakeLog = async () => (await fetchJson('GET', `http://127.0.0.1:${FAKE_PORT}/__log`)).json

  spawnNode('backend', path.join(BACKEND_DIR, 'dist', 'main.js'), {
    ...process.env,
    ...backendEnv,
    PORT: String(PORT),
    WX_API_BASE: `http://127.0.0.1:${FAKE_PORT}`, // 小程序接口指向假服务
    WX_APPID: 'wx_selftest_appid',
    WX_SECRET: 'selftest_secret',
    WXPAY_MCHID: '1900000000', // 假商户号（本用例不需要真支付）
    WX_MOCK_LOGIN: '1',
    WX_MOCK_PAY: '0',
    ORDER_SHIPPING_CRON: '0 0 3 * * *', // 关掉自动补偿，用例里手动触发（避免竞态）
  })
  const up = await waitHttp(`${BASE}/product/categories`)
  check(`后端实例(3015) 就绪`, up)
  if (!up) {
    killAll()
    process.exit(1)
  }

  const call = (method, p, body, token) => fetchJson(method, BASE + p, body, token)
  const ts = Date.now()

  // ── 准备：买家A / 买家B（都要注册+审核） ──
  const loginAndVerify = async (tag) => {
    const first = await call('POST', '/auth/wx-login', { code: `${tag}_${ts}` })
    const token0 = first.json?.data?.token
    const phone = '138' + String(crypto.randomInt(10_000_000, 99_999_999))
    await call('POST', '/buyer/register', { shopName: `${tag}自测店${ts}`, contact: '自测员', phone, address: '自测路 1 号-' + ts }, token0) // 卡BL：地址带唯一后缀，避开「同址 30 天 3 联系人」限制
    const admin0 = await call('POST', '/auth/wx-login', { code: 'admin' })
    const adminToken0 = admin0.json?.data?.token
    let hit = null
    for (let page = 1; page <= 6 && !hit; page++) {
      const r = await call('GET', `/admin/buyers/pending?pageSize=50&page=${page}`, null, adminToken0)
      hit = (r.json?.data?.list || []).find((x) => x.phone === phone)
    }
    if (hit) await call('POST', `/admin/buyers/${hit.purchaserId}/verify`, { methods: [1], result: 1 }, adminToken0)
    const re = await call('POST', '/auth/wx-login', { code: `${tag}_${ts}` })
    return { token: re.json?.data?.token, phone }
  }

  const A = await loginAndVerify('ship_a')
  const B = await loginAndVerify('ship_b')
  check('买家A 可用', !!A.token)
  check('买家B 可用（越权用例用）', !!B.token)

  const adminLogin = await call('POST', '/auth/wx-login', { code: 'admin' })
  const adminToken = adminLogin.json?.data?.token
  check('运营 token 可用', !!adminToken)

  const goods = await call('GET', '/product/list?pageSize=5', null, A.token)
  const product = goods.json?.data?.list?.[0]
  check('取到在售商品', !!product?.id)

  // 配送员：直接用 prisma 建档案 + 自签 token（本用例只关心交付确认那一步）
  const courierUser = await prisma.user.create({
    data: { wxOpenid: `ship_courier_${ts}`, name: '自测配送员', roles: ['courier'] },
  })
  const courier = await prisma.courier.create({
    data: { userId: courierUser.id, source: 1, status: 1, online: 1, priority: 100, maxOrders: 10 },
  })
  const courierToken = jwt.sign(
    { sub: Number(courierUser.id), userId: Number(courierUser.id), roles: ['courier'], currentRole: 'courier' },
    backendEnv.JWT_SECRET,
    { expiresIn: '30m' },
  )

  /**
   * 造一个「已送达 + 已线上支付」的订单（这就是发货信息录入的目标形态）
   * payMethod=2 的会先走 /order/:id/pay 选 COD，再直接改状态到已送达（跳过真实配送链路）
   */
  const makeOrder = async (opts = {}) => {
    const token = opts.token || A.token
    const created = await call('POST', '/order', {
      deliveryDate: '2026-10-10',
      timeWindow: 1,
      items: [{ productId: product.id, qty: 2 }],
    }, token)
    const orderId = created.json?.data?.orderId
    if (!orderId) return null
    const detail0 = await call('GET', `/order/${orderId}`, null, token)
    const baseAmount = Math.round((Number(detail0.json.data.amountOrdered) + Number(detail0.json.data.deliveryFee)) * 100) / 100
    if (opts.cod) await call('POST', `/order/${orderId}/pay`, { payMethod: 2 }, token)
    await prisma.order.update({
      where: { id: BigInt(orderId) },
      data: { status: 60, ...(opts.amountFinal != null ? { amountFinal: opts.amountFinal } : {}) },
    })
    let payNo = null
    if (opts.onlinePaid) {
      payNo = crypto.randomBytes(16).toString('hex')
      await prisma.paymentRecord.create({
        data: {
          orderId: BigInt(orderId),
          payNo,
          channel: 'wechat',
          amount: opts.amountFinal != null ? opts.amountFinal : baseAmount,
          status: 1,
          paidAt: new Date(),
        },
      })
    }
    return { orderId, payNo, baseAmount }
  }

  // ── 1+2. 送达即录入（配送员交付确认触发）；现金单不调微信 ──
  console.log('\n【1+2. 交付确认触发录入：COD 已线上付的单自动录入，现金单不调微信】')
  const orderA = await makeOrder({ cod: true, onlinePaid: true, amountFinal: 12.34 })
  const orderB = await makeOrder({ cod: true, onlinePaid: false })
  check('订单A（COD+已线上付）/订单B（COD现金，未线上付）建好', !!orderA?.orderId && !!orderB?.orderId)

  const task = await prisma.deliveryTask.create({
    data: {
      courierId: courier.id,
      routeNo: `SHIP${ts}`,
      status: 2, // 已出发（交付确认的前置状态）
      stationList: [
        { type: 'deliver', orderId: orderA.orderId, seq: 1 },
        { type: 'deliver', orderId: orderB.orderId, seq: 2 },
      ],
    },
  })
  const delivered = await call('POST', `/courier/task/${Number(task.id)}/deliver`, {
    photos: ['/uploads/selftest-deliver.png'],
    remark: '卡S1 自测',
  }, courierToken)
  check('交付确认成功（HTTP 路由通）', delivered.json?.code === 0, delivered.json)

  const codOrderIds = (delivered.json?.data?.codOrders || []).map((x) => x.orderId)
  check('待收款队列**排除**已线上收款单（A）', !codOrderIds.includes(orderA.orderId), codOrderIds)
  check('待收款队列**保留**现金未付单（B）', codOrderIds.includes(orderB.orderId), codOrderIds)

  await sleep(1500) // 录入是旁路副作用，给它落地时间
  const ledA = await prisma.orderShipping.findUnique({ where: { orderId: BigInt(orderA.orderId) } })
  check('A 的录入台账存在且已录入（status=1）', ledA?.status === 1, ledA && { status: ledA.status, err: ledA.lastError })
  const ledB = await prisma.orderShipping.findUnique({ where: { orderId: BigInt(orderB.orderId) } })
  check('B（现金未付）不建台账、绝不调微信', ledB == null)

  const log1 = await fakeLog()
  const upA = log1.calls.upload.filter((u) => u.body?.order_key?.out_trade_no === orderA.payNo)
  check('微信侧收到且仅收到 1 次该单录入', upA.length === 1, upA.length)
  if (upA.length) {
    const b = upA[0].body
    const itemDesc = b.shipping_list?.[0]?.item_desc
    check('order_key.order_number_type=1（商户号+商户单号）', b.order_key?.order_number_type === 1)
    check('order_key.mchid 用的是配置的商户号', b.order_key?.mchid === '1900000000')
    check('order_key.out_trade_no = payment_record.payNo', b.order_key?.out_trade_no === orderA.payNo)
    check('logistics_type=2（同城配送）', b.logistics_type === 2)
    check('delivery_mode=1（统一发货）', b.delivery_mode === 1)
    check('item_desc 非空且含商品名与数量（不是占位文本）', typeof itemDesc === 'string' && itemDesc.includes(product.name) && itemDesc.includes('2'), itemDesc)
    check('shipping_list 只有 1 条（统一发货）', Array.isArray(b.shipping_list) && b.shipping_list.length === 1)
    check('upload_time 是 RFC 3339 且带时区', RFC3339.test(String(b.upload_time)), b.upload_time)
    const buyerUser = await prisma.user.findUnique({ where: { phone: A.phone } })
    check('payer.openid = 买家自己的 openid', !!buyerUser?.wxOpenid && b.payer?.openid === buyerUser.wxOpenid, { got: !!b.payer?.openid })
  }

  // ── 3. 幂等：重复补录不再打微信 ──
  console.log('\n【3. 重复录入幂等（不再打微信，保住唯一一次"重新发货"机会）】')
  const again = await call('POST', `/admin/order-shipping/${orderA.orderId}/upload`, {}, adminToken)
  const log2 = await fakeLog()
  const cnt2 = log2.calls.upload.filter((u) => u.body?.order_key?.out_trade_no === orderA.payNo).length
  // 信封是 {code,msg,data}；但带 code 字段的返回会被拦截器原样透传，故两种形状都接受
  const okOf = (r) => (r?.data?.ok ?? r?.ok) === true
  check('重复补录返回成功（幂等）', again.json?.code === 0 && okOf(again.json), again.json)
  check('微信侧调用次数未增加（仍 1 次）', cnt2 === 1, cnt2)

  // ── 4. 失败可重试 + 不影响主流程 ──
  console.log('\n【4. 录入失败：订单主流程不受影响 + 台账可重试 + 补偿任务能救回来】')
  const orderC = await makeOrder({ cod: true, onlinePaid: true })
  await fakeMode({ upload: 'bad' })
  const failRes = await call('POST', `/admin/order-shipping/${orderC.orderId}/upload`, {}, adminToken)
  check('录入失败返回业务错（不是 500）', failRes.json?.code !== 0 || failRes.json?.data?.ok === false, failRes.json)
  const ledC = await prisma.orderShipping.findUnique({ where: { orderId: BigInt(orderC.orderId) } })
  check('C 台账 status=2（可重试）+ attempts=1', ledC?.status === 2 && ledC?.attempts === 1, ledC && { s: ledC.status, a: ledC.attempts })
  check('C 台账记下了微信 errcode 原文', String(ledC?.lastError || '').includes('10060005'), ledC?.lastError)
  const orderCRow = await prisma.order.findUnique({ where: { id: BigInt(orderC.orderId) } })
  check('订单本身没被影响（仍 已送达 60）', orderCRow?.status === 60, orderCRow?.status)
  const auditFail = await prisma.auditLog.count({ where: { entity: 'order', entityId: BigInt(orderC.orderId), action: 'ORDER_SHIPPING_FAIL' } })
  check('失败留痕（audit ≥1 条）', auditFail >= 1, auditFail)

  await fakeMode({ upload: 'ok' })
  const retryRes = await call('POST', '/admin/order-shipping/retry-pending', {}, adminToken)
  const ledC2 = await prisma.orderShipping.findUnique({ where: { orderId: BigInt(orderC.orderId) } })
  check('补偿任务把 C 救回来（status=1）', ledC2?.status === 1, ledC2 && { s: ledC2.status, err: ledC2.lastError })
  check('补偿任务返回统计', retryRes.json?.code === 0, retryRes.json)

  // ── 5. 10060003 = 终态，不再重试 ──
  console.log('\n【5. 10060003（重新发货机会已用掉）→ 终态，补偿不再打微信】')
  const orderD = await makeOrder({ cod: true, onlinePaid: true })
  await fakeMode({ upload: 'noretry' })
  await call('POST', `/admin/order-shipping/${orderD.orderId}/upload`, {}, adminToken)
  const ledD = await prisma.orderShipping.findUnique({ where: { orderId: BigInt(orderD.orderId) } })
  check('D 台账 status=3（终态）', ledD?.status === 3, ledD?.status)
  const before = (await fakeLog()).calls.upload.filter((u) => u.body?.order_key?.out_trade_no === orderD.payNo).length
  await call('POST', '/admin/order-shipping/retry-pending', {}, adminToken)
  const after = (await fakeLog()).calls.upload.filter((u) => u.body?.order_key?.out_trade_no === orderD.payNo).length
  check('补偿后微信侧调用次数不变（终态不重试）', before === after, { before, after })

  // ── 6. by-pay-no 直达 + 越权 ──
  console.log('\n【6. GET /order/by-pay-no/:payNo（微信订单详情 path 用）】')
  const byA = await call('GET', `/order/by-pay-no/${orderA.payNo}`, null, A.token)
  check('本人 payNo 能查到自己的订单', byA.json?.code === 0 && Number(byA.json?.data?.orderId) === orderA.orderId, byA.json?.code)
  const byB = await call('GET', `/order/by-pay-no/${orderA.payNo}`, null, B.token)
  check('**换别人的 token 查不到**（业务错，不泄露他人订单）', byB.json?.code !== 0, byB.json?.code)
  const bad = await call('GET', `/order/by-pay-no/ab`, null, A.token)
  check('格式非法直接拒（业务码 1001）', bad.json?.code === 1001, bad.json)
  const notExist = await call('GET', `/order/by-pay-no/${'f'.repeat(32)}`, null, A.token)
  check('不存在的 payNo → 业务错（不是 500）', notExist.json?.code !== 0 && notExist.status < 500, notExist.json?.code)

  // ── 7. COD 线上到账联动 ──
  console.log('\n【7. COD 线上到账联动：详情透出 onlinePaidAt、现金单为 null】')
  const detA = await call('GET', `/order/${orderA.orderId}`, null, A.token)
  check('A（已线上付）onlinePaidAt 有值', !!detA.json?.data?.onlinePaidAt, detA.json?.data?.onlinePaidAt)
  check('A 的 buyerPaidClaimAt 仍为空（线上到账 ≠ 客户称已付，两者不混）', !detA.json?.data?.buyerPaidClaimAt)
  const detB = await call('GET', `/order/${orderB.orderId}`, null, B.token)
  void detB

  // ── 8. 平台状态 / 特殊报备 ──
  console.log('\n【8. 平台状态 + 特殊发货报备（测试单）】')
  const ps = await call('GET', '/admin/order-shipping/platform-status', null, adminToken)
  check('platform-status 返回已开通 + 已确认结算管理', ps.json?.data?.managed === true && ps.json?.data?.confirmed === true, ps.json?.data)
  const rep2 = await call('POST', `/admin/order-shipping/${orderA.orderId}/special-report`, { type: 2 }, adminToken)
  check('测试单报备成功', rep2.json?.code === 0 && rep2.json?.data?.ok === true, rep2.json)
  const rep1 = await call('POST', `/admin/order-shipping/${orderA.orderId}/special-report`, { type: 1 }, adminToken)
  check('预售报备缺 delayTo → 参数错 1001', rep1.json?.code === 1001, rep1.json)
  const repBad = await call('POST', `/admin/order-shipping/${orderA.orderId}/special-report`, { type: 7 }, adminToken)
  check('非法 type → 参数错 1001', repBad.json?.code === 1001, repBad.json)
  const logEnd = await fakeLog()
  check('报备用的是商户单号（order_id = payNo）', logEnd.calls.special.some((s) => s.order_id === orderA.payNo), logEnd.calls.special)

  // 清理：本次造的数据只删自测产物（订单/任务/台账留在库里作为证据，不动别人的数据）
  await prisma.$disconnect()
  killAll()

  console.log('\n' + '='.repeat(64))
  console.log(`卡S1 自测：通过 ${passed} / 失败 ${failed}`)
  console.log('='.repeat(64))
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('自测脚本异常：', e)
  killAll()
  process.exit(1)
})
