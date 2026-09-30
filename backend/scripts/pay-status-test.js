/**
 * 卡S2 自测：支付/收款状态口径收口（去「跳过收款」/ 去「我已付款」/ 订单列表加支付状态）
 *
 * 运行（backend 目录下，前台或走管道）：node scripts/pay-status-test.js
 * 前置：cd backend && npm run build（已产出 dist）；本机 MySQL 可用；**不依赖任何真实凭证**。
 *
 * 端口隔离（不碰别人的 3001/3015）：后端实例 3016（本卡不调微信，无需假微信服务）
 *
 * 覆盖（对应卡S2 第四节验收）：
 *   1 纯函数四档判定逐一命中（含「两条并存 → 以线上为准」、photos 空数组=无凭证）
 *   2 采购方订单列表：新增 payStatusText / onlinePaidAt / paidProofAt
 *   3 采购方订单详情：payStatus/payStatusText 四档逐一命中（不论 payMethod 的线上到账）
 *   4 退款回退：流水置 2 → 自动回退（onlinePaidAt 变 null）
 *   5 「我已付款」接口（POST /buyer/order/:id/claim-paid）仍可调通（证明没被删，只是前端不调用）
 *   6 后台对账：三档归组 + 「待收款」子标注 + 两条并存警示 + 历史口径只读标注 + 汇总计数与新三档一致
 *
 * ⚠️ 卡AG（2026-09-30）改动说明：本卡给采购方侧文案加了**客户版映射**
 *    （cod_pending 对采购方显示「未支付」，运营侧仍是「待收款」），
 *    因此本脚本里**采购方侧**的 cod_pending 期望值由「待收款」改为「未支付」；
 *    后台对账侧期望值不变（仍「待收款」）。判定 code 与金额口径均未变。
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const BACKEND_DIR = path.resolve(__dirname, '..')
const PORT = 3016
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

// 与 pay-status.util 的文案保持一致（改文案要同步改这里）
// ⚠️ 卡AG（2026-09-30）：文案分**两套受众** ——
//   运营版（payStatusOf().text，用于后台对账）：cod_pending = 「待收款」
//   客户版（buyerPayStatusTextOf()，用于采购方列表/详情）：cod_pending = 「未支付」（与 unpaid 同文案）
//   本脚本的采购方侧断言用客户版（T_UNPAID），后台对账侧断言用运营版（T_PENDING）。
const T_WECHAT = '已付款 · 微信直接支付'
const T_PROOF = '已付款 · 扫码付款'
const T_PENDING = '待收款' // 运营版（后台对账）
const T_UNPAID = '未支付' // 客户版（采购方侧；unpaid 与 cod_pending 都是它）
const T_GROUP_PAID_WECHAT = '已付款 · 微信直接支付'
const T_GROUP_PAID_PROOF = '已付款 · 扫码付款'
const T_GROUP_UNPAID = '未收'
const T_HISTORIC = '曾称已付（历史口径）'
const T_DUPLICATE = '⚠️ 另有现金收款凭证，请核对是否重复收款'

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

  // ── 1. 纯函数四档判定（require 编译产物，无需起服务）──
  console.log('='.repeat(64))
  console.log('【1. pay-status.util 纯函数：四档判定 + 两条并存以线上为准】')
  console.log('='.repeat(64))
  const util = require(path.join(BACKEND_DIR, 'dist', 'common', 'utils', 'pay-status.util.js'))
  const judge = (o) => util.payStatusOf({ payMethod: o.payMethod ?? 0, status: o.status ?? 10, onlinePaid: !!o.onlinePaid, hasProof: !!o.hasProof })

  let r = judge({ payMethod: 0, status: 10 })
  check('未选支付方式 + 无流水无凭证 → 未支付', r.code === 'unpaid' && r.text === T_UNPAID, r)
  r = judge({ payMethod: 2, status: 60 })
  check('COD + 已送达(60) + 无流水无凭证 → 待收款', r.code === 'cod_pending' && r.text === T_PENDING, r)
  r = judge({ payMethod: 2, status: 70 })
  check('COD + 已完成(70) + 无流水无凭证 → 待收款', r.code === 'cod_pending', r)
  r = judge({ payMethod: 2, status: 40 })
  check('COD + 未送达(40) → 未支付（待收款只认 60/70）', r.code === 'unpaid', r)
  r = judge({ payMethod: 1, status: 30, onlinePaid: true })
  check('微信支付 + 有已付流水 → 已付款·微信直接支付', r.code === 'paid_wechat' && r.text === T_WECHAT, r)
  r = judge({ payMethod: 0, status: 60, onlinePaid: true })
  check('线上到账**不论 payMethod**（payMethod=0 也算已付）', r.code === 'paid_wechat', r)
  r = judge({ payMethod: 2, status: 60, hasProof: true })
  check('COD 已送达 + 有凭证 → 已付款·扫码付款', r.code === 'paid_proof' && r.text === T_PROOF, r)
  r = judge({ payMethod: 2, status: 60, onlinePaid: true, hasProof: true })
  check('两条并存（流水+凭证）→ 以线上为准', r.code === 'paid_wechat', r)
  check('hasPayProof：photos 空数组 = 无凭证', util.hasPayProof({ photos: [] }) === false)
  check('hasPayProof：photos 非空 = 有凭证', util.hasPayProof({ photos: ['x.png'] }) === true)
  check('hasPayProof：payProof 为空 = 无凭证', util.hasPayProof(null) === false)
  check('hasWechatPaidRecord：wechat+status=1 命中', util.hasWechatPaidRecord([{ channel: 'wechat', status: 1 }]) === true)
  check('hasWechatPaidRecord：wechat+status=2（退款）不命中', util.hasWechatPaidRecord([{ channel: 'wechat', status: 2 }]) === false)
  check('三档归组：cod_pending → 未收 + 子标注待收款', (() => { const g = util.payStatusGroup('cod_pending'); return g.text === T_GROUP_UNPAID && g.subText === '待收款' })())
  check('三档归组：paid_* 无子标注', util.payStatusGroup('paid_wechat').subText === null && util.payStatusGroup('paid_proof').subText === null)

  // ── 起隔离后端实例（3016）──
  console.log('\n【启动隔离后端实例(3016)】')
  spawnNode('backend', path.join(BACKEND_DIR, 'dist', 'main.js'), {
    ...process.env,
    ...backendEnv,
    PORT: String(PORT),
    WX_MOCK_LOGIN: '1',
    WX_MOCK_PAY: '0',
    // 本卡不验证发货录入；把微信接口指向一个必然失败的本地端口 → 录入只落失败台账，不影响断言
    WX_API_BASE: 'http://127.0.0.1:39999',
    WX_APPID: 'wx_selftest_appid',
    WX_SECRET: 'selftest_secret',
    ORDER_SHIPPING_CRON: '0 0 3 * * *',
  })
  const up = await waitHttp(`${BASE}/product/categories`)
  check('后端实例(3016) 就绪', up)
  if (!up) {
    killAll()
    process.exit(1)
  }

  const call = (method, p, body, token) => fetchJson(method, BASE + p, body, token)
  const ts = Date.now()

  // ── 准备：买家（注册+审核）──
  const loginAndVerify = async (tag) => {
    const first = await call('POST', '/auth/wx-login', { code: `${tag}_${ts}` })
    const token0 = first.json?.data?.token
    const phone = '139' + String(crypto.randomInt(10_000_000, 99_999_999))
    await call('POST', '/buyer/register', { shopName: `${tag}自测店${ts}`, contact: '自测员', phone, address: '自测路 1 号' }, token0)
    const admin0 = await call('POST', '/auth/wx-login', { code: 'admin' })
    const adminToken0 = admin0.json?.data?.token
    let hit = null
    for (let page = 1; page <= 6 && !hit; page++) {
      const res = await call('GET', `/admin/buyers/pending?pageSize=50&page=${page}`, null, adminToken0)
      hit = (res.json?.data?.list || []).find((x) => x.phone === phone)
    }
    if (hit) await call('POST', `/admin/buyers/${hit.purchaserId}/verify`, { methods: [1], result: 1 }, adminToken0)
    const re = await call('POST', '/auth/wx-login', { code: `${tag}_${ts}` })
    return { token: re.json?.data?.token, phone }
  }

  const A = await loginAndVerify('pays_a')
  check('买家A 可用', !!A.token)
  const adminLogin = await call('POST', '/auth/wx-login', { code: 'admin' })
  const adminToken = adminLogin.json?.data?.token
  check('运营 token 可用', !!adminToken)

  const goods = await call('GET', '/product/list?pageSize=5', null, A.token)
  const product = goods.json?.data?.list?.[0]
  check('取到在售商品', !!product?.id)

  // 对账按「送达日」查 —— 用例单的送达日都用今天，方便对账断言
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)

  /** 造一个订单：可选 COD / 线上流水 / 现金凭证 / 指定状态 */
  const makeOrder = async (opts = {}) => {
    const created = await call('POST', '/order', {
      deliveryDate: today,
      timeWindow: 1,
      items: [{ productId: product.id, qty: 2 }],
    }, A.token)
    const orderId = created.json?.data?.orderId
    if (!orderId) return null
    const detail0 = await call('GET', `/order/${orderId}`, null, A.token)
    const baseAmount = Math.round((Number(detail0.json.data.amountOrdered) + Number(detail0.json.data.deliveryFee)) * 100) / 100
    if (opts.cod) await call('POST', `/order/${orderId}/pay`, { payMethod: 2 }, A.token)
    if (opts.status != null) {
      await prisma.order.update({ where: { id: BigInt(orderId) }, data: { status: opts.status } })
    }
    let payNo = null
    if (opts.onlinePaid) {
      payNo = crypto.randomBytes(16).toString('hex')
      await prisma.paymentRecord.create({
        data: { orderId: BigInt(orderId), payNo, channel: 'wechat', amount: baseAmount, status: 1, paidAt: new Date() },
      })
    }
    if (opts.proof) {
      await prisma.order.update({
        where: { id: BigInt(orderId) },
        data: { payProof: { photos: ['/uploads/selftest-paystatus.png'], paidAt: new Date().toISOString(), note: '卡S2 自测凭证' } },
      })
    }
    if (opts.claim) {
      await prisma.order.update({ where: { id: BigInt(orderId) }, data: { buyerPaidClaimAt: new Date() } })
    }
    return { orderId, payNo, baseAmount }
  }

  // ── 2. 详情四档逐一命中（接口级）──
  console.log('\n【2. 采购方订单详情：payStatus/payStatusText 四档逐一命中】')
  const oUnpaid = await makeOrder({ status: 10 }) // 未选支付方式
  const oCod = await makeOrder({ cod: true, status: 60 }) // COD 已送达，未收
  const oProof = await makeOrder({ cod: true, status: 60, proof: true }) // COD 已送达 + 现金凭证
  const oWechat = await makeOrder({ cod: true, status: 60, onlinePaid: true }) // COD 已送达 + 线上到账
  check('四个用例单建好', !!oUnpaid?.orderId && !!oCod?.orderId && !!oProof?.orderId && !!oWechat?.orderId)

  const dUnpaid = await call('GET', `/order/${oUnpaid.orderId}`, null, A.token)
  check('① 未支付：payStatusText=未支付', dUnpaid.json?.data?.payStatus === 'unpaid' && dUnpaid.json?.data?.payStatusText === T_UNPAID, dUnpaid.json?.data)
  const dCod = await call('GET', `/order/${oCod.orderId}`, null, A.token)
  // 卡AG（2026-09-30）：采购方侧是**客户版**文案 —— cod_pending 对客户也显示「未支付」
  // （code 不变仍是 cod_pending，运营侧同单仍是「待收款」，见第 6 节）
  check('② COD 已送达未收：payStatus=cod_pending，客户版文案=未支付', dCod.json?.data?.payStatus === 'cod_pending' && dCod.json?.data?.payStatusText === T_UNPAID, dCod.json?.data)
  const dProof = await call('GET', `/order/${oProof.orderId}`, null, A.token)
  check('③ 已付款·扫码付款：有凭证', dProof.json?.data?.payStatus === 'paid_proof' && dProof.json?.data?.payStatusText === T_PROOF, dProof.json?.data)
  check('③ paidProofAt 透出（供前端显示时间）', !!dProof.json?.data?.paidProofAt)
  const dWechat = await call('GET', `/order/${oWechat.orderId}`, null, A.token)
  check('④ 已付款·微信直接支付：有流水（COD 单线上付也算，不论 payMethod）', dWechat.json?.data?.payStatus === 'paid_wechat' && dWechat.json?.data?.payStatusText === T_WECHAT, dWechat.json?.data)
  check('④ onlinePaidAt 透出', !!dWechat.json?.data?.onlinePaidAt)

  // ── 3. 采购方订单列表：新字段 + 文案 ──
  console.log('\n【3. 采购方订单列表：payStatusText / onlinePaidAt / paidProofAt】')
  const list = await call('GET', '/order?page=1&pageSize=50', null, A.token)
  const listMap = new Map((list.json?.data?.list || []).map((x) => [x.orderId, x]))
  const lCod = listMap.get(oCod.orderId)
  const lProof = listMap.get(oProof.orderId)
  const lWechat = listMap.get(oWechat.orderId)
  const lUnpaid = listMap.get(oUnpaid.orderId)
  check('列表含 payStatusText（COD 已送达未收 → 客户版「未支付」）', lCod?.payStatusText === T_UNPAID, lCod)
  check('列表含 payStatusText（已付款·扫码付款单）', lProof?.payStatusText === T_PROOF, lProof)
  check('列表含 payStatusText（已付款·微信直接支付单）', lWechat?.payStatusText === T_WECHAT, lWechat)
  check('列表含 payStatusText（未支付单）', lUnpaid?.payStatusText === T_UNPAID, lUnpaid)
  check('列表 onlinePaidAt / paidProofAt 透出', !!lWechat?.onlinePaidAt && !!lProof?.paidProofAt)

  // ── 4. 退款回退：流水置 2 → 客户版「未支付」 ──
  console.log('\n【4. 退款回退：支付流水置 2 → 自动回退（不需要新字段）】')
  await prisma.paymentRecord.updateMany({ where: { orderId: BigInt(oWechat.orderId) }, data: { status: 2 } })
  const dRefund = await call('GET', `/order/${oWechat.orderId}`, null, A.token)
  // 卡AG：采购方侧文案是客户版 —— 回退到 cod_pending 后显示「未支付」（不是「待收款」）
  check('退款后详情回退为 cod_pending + 客户版「未支付」', dRefund.json?.data?.payStatus === 'cod_pending' && dRefund.json?.data?.payStatusText === T_UNPAID, dRefund.json?.data)
  check('退款后 onlinePaidAt 变 null', dRefund.json?.data?.onlinePaidAt === null, dRefund.json?.data?.onlinePaidAt)
  // 恢复流水，供对账用例使用
  await prisma.paymentRecord.updateMany({ where: { orderId: BigInt(oWechat.orderId) }, data: { status: 1 } })

  // ── 5. claim-paid 接口仍可调通（没被删，只是新前端不调用）──
  console.log('\n【5. POST /buyer/order/:id/claim-paid 仍可调通（接口保留只为兼容老包）】')
  const claimRes = await call('POST', `/buyer/order/${oCod.orderId}/claim-paid`, {}, A.token)
  check('claim-paid 返回成功（code=0）', claimRes.json?.code === 0 && !!claimRes.json?.data?.buyerPaidClaimAt, claimRes.json)
  const dClaimed = await call('GET', `/order/${oCod.orderId}`, null, A.token)
  check('声明过已付款的单：payStatus **仍按新口径**（客户声明不是钱）', dClaimed.json?.data?.payStatus === 'cod_pending', dClaimed.json?.data?.payStatus)

  // ── 6. 后台对账：三档 + 子标注 + 并存警示 + 历史标注 + 汇总一致 ──
  console.log('\n【6. 后台对账：三档归组 / 并存警示 / 历史标注 / 汇总与新三档一致】')
  // 造两条并存单（流水+凭证）与一张历史声明单（都对账日 = 今天）
  const oDup = await makeOrder({ cod: true, status: 60, onlinePaid: true, proof: true })
  const oHist = await makeOrder({ cod: true, status: 60, claim: true })
  check('并存单/历史声明单建好', !!oDup?.orderId && !!oHist?.orderId)
  await sleep(300)
  const daily = await call('GET', `/admin/finance/daily-reconciliation?date=${today}`, null, adminToken)
  check('对账接口可用', daily.json?.code === 0, daily.json?.code)
  const rows = daily.json?.data?.orderList || []
  const rowOf = (id) => rows.find((x) => x.orderId === id)

  const rCod = rowOf(oCod.orderId)
  check('对账行：COD 未收 → 未收 + 子标注「待收款」', rCod?.payStatusGroupText === T_GROUP_UNPAID && rCod?.payStatusSubText === '待收款', rCod)
  check('对账行：COD 未收 → 运营版「待收款」（与客户版不同源受众，卡AG）', rCod?.payStatusText === T_PENDING, rCod?.payStatusText)
  check('对账行：同单采购方看「未支付」、运营看「待收款」（同源不同受众）',
    dCod.json?.data?.payStatusText === T_UNPAID && rCod?.payStatusText === T_PENDING)

  const rProof = rowOf(oProof.orderId)
  check('对账行：现金凭证 → 已付款·扫码付款', rProof?.payStatusGroupText === T_GROUP_PAID_PROOF, rProof)

  const rWechat = rowOf(oWechat.orderId)
  check('对账行：线上到账 → 已付款·微信直接支付', rWechat?.payStatusGroupText === T_GROUP_PAID_WECHAT, rWechat)

  const rDup = rowOf(oDup.orderId)
  check('对账行：两条并存 → 状态以线上为准', rDup?.payStatus === 'paid_wechat', rDup)
  check('对账行：并存警示出现且文案来自后端', rDup?.duplicateRisk === true && rDup?.duplicateWarnText === T_DUPLICATE, rDup?.duplicateWarnText)

  const rHist = rowOf(oHist.orderId)
  check('对账行：老数据「客户称已付」→ 历史口径只读标注', rHist?.historicClaimText === T_HISTORIC, rHist)
  check('对账行：历史标注单按新口径重判（仍是待收款）', rHist?.payStatus === 'cod_pending', rHist?.payStatus)

  const summary = daily.json?.data?.summary || {}
  const cnt = (code) => rows.filter((x) => x.payStatus === code).length
  check('汇总 wechatPaidCount = 行内 paid_wechat 计数（同一份实现）', summary.wechatPaidCount === cnt('paid_wechat'), { s: summary.wechatPaidCount, c: cnt('paid_wechat') })
  check('汇总 codPaidCount = 行内 paid_proof 计数', summary.codPaidCount === cnt('paid_proof'), { s: summary.codPaidCount, c: cnt('paid_proof') })
  check('汇总 codUnpaidCount = 行内 cod_pending 计数', summary.codUnpaidCount === cnt('cod_pending'), { s: summary.codUnpaidCount, c: cnt('cod_pending') })

  console.log('\n' + '='.repeat(64))
  console.log(`卡S2 自测完成：通过 ${passed} / 失败 ${failed}`)
  console.log('='.repeat(64))
  await prisma.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('脚本异常：', e)
  killAll()
  process.exit(1)
})
