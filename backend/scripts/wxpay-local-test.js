/**
 * 真实微信支付 · 本地自测（卡R1 §五）—— 自包含编排：假微信支付服务器 + 后端隔离实例 + 全部用例
 *
 * 运行（backend 目录下）：node scripts/wxpay-local-test.js
 * 前置：npm run build 已产出 dist；MySQL 本机库可用。不依赖生产凭证（全部用自签测试材料）。
 *
 * 端口隔离（交接页推荐做法，不碰别人的 3001）：
 *   假微信支付服务器 3953 ｜ 支付用例后端 3011（WX_MOCK_PAY=0）｜ 超时用例后端 3012（阈值1分钟、cron 2秒）
 *   ｜ 回归后端 3013（WX_MOCK_PAY=1，因 187 基线含模拟通道用例；生产恒为 0）
 *
 * 覆盖（对应卡R1 §五）：
 *   1 正常回调（验签+解密）→ 订单 10→30、流水 status=1、paidAt 有值
 *   2 验签失败 → 拒绝、callbackPayload 留痕、订单不动
 *   3 重复回调 → 第二次幂等成功、订单/流水不重复推进（audit_log 不新增）
 *   4 金额不一致 → 拒绝 + 留痕 + 订单不动
 *   5 退款：out_refund_no / 金额 / out_trade_no 三者一致；重复退款幂等
 *   6 超时关单（ORDER_PAY_TIMEOUT_MINUTES=1）→ 订单 91、流水 2、审计有记录
 *   5b（加菜）COD 送达后「微信直接支付」→ prepay 金额取 amountFinal、回调只落已支付不推进订单
 *   7 回归：验收测试.js 副本（sed 到 3013）期望 187 通过 / 0 失败（输出原样透传）
 */
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const BACKEND_DIR = path.resolve(__dirname, '..')
const PROJECT_ROOT = path.resolve(BACKEND_DIR, '..')
const DATA_DIR = path.join(PROJECT_ROOT, '自测证据', 'wxpay-local')

const FAKE_PORT = 3953
const PORT_PAY = 3011
const PORT_TIMEOUT = 3012
const PORT_REGRESSION = 3013

let passed = 0, failed = 0
const children = new Map() // key → child

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name) }
  else { failed++; console.log('  ❌ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')) }
}

const fetchJson = async (method, url, body, token) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json }
}

/// 读 KEY=VALUE env 文件（不打印任何值）
function parseEnvFile(p) {
  const out = {}
  if (!fs.existsSync(p)) return out
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '')
  }
  return out
}

function spawnNode(key, script, env, tag) {
  const child = spawn(process.execPath, [script], { cwd: BACKEND_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', () => {})
  child.stderr.on('data', (d) => { process.stderr.write(`[${tag}][stderr] ${d}`) })
  children.set(key, child)
  return child
}

const stopBackend = (key) => {
  const c = children.get(key)
  if (c) {
    try { c.kill() } catch {}
    children.delete(key)
    console.log(`  已停止实例 ${key}`)
  }
}

const waitHttp = async (url, timeoutMs = 45000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { await fetch(url); return true } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const killAll = () => {
  for (const [key, c] of children) { try { c.kill() } catch {} }
  children.clear()
}
process.on('exit', killAll)
process.on('SIGINT', () => { killAll(); process.exit(130) })

async function main() {
  if (!fs.existsSync(path.join(BACKEND_DIR, 'dist', 'main.js'))) {
    console.log('❌ 未找到 dist/main.js —— 请先 cd backend && npm run build')
    process.exit(1)
  }
  const backendEnvFile = parseEnvFile(path.join(BACKEND_DIR, '.env'))
  // 测试脚本自身的 Prisma 也要能连库（只从 .env 取，不打印）
  for (const [k, v] of Object.entries(backendEnvFile)) if (process.env[k] === undefined) process.env[k] = v
  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient()

  // ── 0. 假微信支付服务器 ──
  console.log('='.repeat(60))
  console.log('【0. 启动假微信支付服务器(3953) + 后端隔离实例(3011/3012/3013)】')
  console.log('='.repeat(60))
  spawnNode('fake', path.join(BACKEND_DIR, 'scripts', 'wxpay-fake-server.js'),
    { ...process.env, FAKE_WXPAY_PORT: String(FAKE_PORT), FAKE_WXPAY_DIR: DATA_DIR }, 'fake')
  const fakeUp = await waitHttp(`http://127.0.0.1:${FAKE_PORT}/__log`, 20000)
  check('假微信支付服务器就绪', fakeUp)
  if (!fakeUp) { killAll(); process.exit(1) }

  const testEnv = parseEnvFile(path.join(DATA_DIR, 'test.env'))
  const makeBackendEnv = (port, extra = {}) => ({
    ...process.env,
    ...backendEnvFile,   // 后端 .env（JWT/数据库/微信登录等，值不打印）
    ...testEnv,          // 自签测试材料（WXPAY_*，值不打印）
    PORT: String(port),
    WXPAY_API_BASE: `http://127.0.0.1:${FAKE_PORT}`,
    WXPAY_NOTIFY_URL: `http://127.0.0.1:${port}/api/v1/payment/wechat/notify`,
    WX_MOCK_LOGIN: '1',
    WX_MOCK_PAY: '0',    // 支付链路用例默认关模拟通道（回归实例单独开）
    ...extra,
  })

  const startBackend = async (key, port, extra, tag) => {
    const child = spawnNode(key, path.join(BACKEND_DIR, 'dist', 'main.js'), makeBackendEnv(port, extra), tag)
    const up = await waitHttp(`http://127.0.0.1:${port}/api/v1/product/categories`)
    check(`后端实例 ${tag}(${port}) 就绪`, up)
    return up
  }

  const payUp = await startBackend('backend-pay', PORT_PAY, {}, 'backend-pay')
  if (!payUp) { killAll(); process.exit(1) }

  // ── 准备：采购方注册→审核→登录；取一个在售商品 ──
  const ts = Date.now()
  const BASE = (port) => `http://127.0.0.1:${port}/api/v1`
  const call = (method, urlPath, body, token, port = PORT_PAY) => fetchJson(method, BASE(port) + urlPath, body, token)

  const buyerLogin = await call('POST', '/auth/wx-login', { code: 'wxpay_buyer_' + ts })
  check('采购方登录(needRegister)', buyerLogin.json?.code === 0 && buyerLogin.json?.data?.needRegister === true)
  let token = buyerLogin.json?.data?.token
  const adminLogin = await call('POST', '/auth/wx-login', { code: 'admin' })
  const adminToken = adminLogin.json?.data?.token
  check('运营登录', adminLogin.json?.code === 0 && adminLogin.json?.data?.currentRole === 'admin')

  const regPhone = '137' + String(ts).slice(-8)
  await call('POST', '/buyer/register', { shopName: '微信支付自测店', contact: '自测员', phone: regPhone, address: '自测路 1 号' }, token)
  const found = await (async () => {
    let hit = null
    for (let p = 1; p <= 5 && !hit; p++) {
      const r = await call('GET', `/admin/buyers/pending?pageSize=50&page=${p}`, null, adminToken)
      hit = (r.json?.data?.list || []).find((x) => x.phone === regPhone)
    }
    return hit
  })()
  check('运营队列找到本次注册', !!found)
  if (found) {
    await call('POST', `/admin/buyers/${found.purchaserId}/verify`, { methods: [1], result: 1 }, adminToken)
    const relogin = await call('POST', '/auth/wx-login', { code: 'wxpay_buyer_' + ts })
    token = relogin.json?.data?.token
    check('审核通过后重登', !!token)
  }
  const goods = await call('GET', '/product/list?pageSize=5', null, token)
  const pid = goods.json?.data?.list?.[0]?.id
  check('取到在售商品', !!pid)
  if (!pid) { killAll(); process.exit(1) }

  const createOrder = async (port = PORT_PAY) => {
    const r = await call('POST', '/order', { deliveryDate: '2026-10-10', timeWindow: 1, items: [{ productId: pid, qty: 2 }] }, token, port)
    if (r.json?.code !== 0) return null
    const d = await call('GET', `/order/${r.json.data.orderId}`, null, token, port)
    return { orderId: r.json.data.orderId, detail: d.json?.data }
  }

  /// 下单 + prepay，返回 { orderId, expectedAmount, payNo, amount, paySign, ... }
  const prepayOrder = async (port = PORT_PAY) => {
    const o = await createOrder(port)
    if (!o) return null
    const expectedAmount = Math.round((Number(o.detail.amountOrdered) + Number(o.detail.deliveryFee)) * 100) / 100
    const p = await call('POST', '/payment/wechat/prepay', { orderId: o.orderId }, token, port)
    if (p.json?.code !== 0) return { orderId: o.orderId, failed: p.json }
    return { orderId: o.orderId, expectedAmount, ...p.json.data }
  }

  const getRecord = async (payNo) => prisma.paymentRecord.findUnique({ where: { payNo } })
  const auditCount = async (orderId, action) =>
    prisma.auditLog.count({ where: { entity: 'order', entityId: BigInt(orderId), ...(action ? { action } : {}) } })
  const auditFind = async (orderId, action) =>
    prisma.auditLog.findFirst({ where: { entity: 'order', entityId: BigInt(orderId), action } })
  const fakeLog = async () => (await fetchJson('GET', `http://127.0.0.1:${FAKE_PORT}/__log`)).json
  const fakeNotify = (outTradeNo, opts = {}) => fetchJson('POST', `http://127.0.0.1:${FAKE_PORT}/__notify`, { outTradeNo, ...opts })
  const cbEntries = (rec) => ((rec?.callbackPayload) || [])

  // ── 1. 正常回调 ──
  console.log('\n【1. 正常回调：验签通过+解密成功 → 订单 10→30、流水 status=1、paidAt 有值】')
  {
    const o = await prepayOrder()
    check('prepay 成功且返回收银台参数', !!o && !o.failed && !!o.payNo && !!o.paySign && o.signType === 'RSA' && String(o.package).startsWith('prepay_id='), o?.failed)
    if (o && !o.failed) {
      check('payNo 为 32 位不可枚举随机串(≤32字符)', /^[0-9a-f]{32}$/.test(o.payNo))
      check('金额=服务端取数(amountOrdered+deliveryFee)', Number(o.amount) === o.expectedAmount, o.expectedAmount)
      const js = await fakeLog()
      const call0 = (js.jsapiCalls || []).slice(-1)[0] || {}
      check('假服务器收到的下单请求签名验证通过', call0.sigOk === true, call0)
      check('下单金额(分)与流水一致', call0.totalCents === Math.round(o.expectedAmount * 100), call0.totalCents)

      // paySign 本地用商户公钥复验（appId\ntimeStamp\nnonceStr\npackage\n）
      const appid = backendEnvFile.WX_APPID
      const msg = `${appid}\n${o.timeStamp}\n${o.nonceStr}\n${o.package}\n`
      const merchantPub = crypto.createPublicKey(fs.readFileSync(path.join(DATA_DIR, 'merchant-public.pem'), 'utf8'))
      const paySignOk = crypto.createVerify('RSA-SHA256').update(msg).verify(merchantPub, o.paySign, 'base64')
      check('paySign 可用商户公钥验签通过', paySignOk)

      const notify = await fakeNotify(o.payNo)
      check('回调投递后 HTTP 200 空体', notify.json?.backendStatus === 200 && notify.json?.backendBody === '', notify.json)
      const rec = await getRecord(o.payNo)
      check('流水 status=1 且 paidAt 有值', rec?.status === 1 && !!rec?.paidAt)
      const od = await call('GET', `/order/${o.orderId}`, null, token)
      check('订单 10→30 且 payMethod=1', od.json?.data?.status === 30 && od.json?.data?.payMethod === 1, od.json?.data?.status)
      check('原始回调已写入 callbackPayload', cbEntries(rec).some((e) => e.source === 'wechat-notify' && e.accepted === true && e.out_trade_no === o.payNo))
      const payAudit = await auditFind(o.orderId, 'ORDER_PAY')
      check('prepay 审计(ORDER_PAY·微信支付待回调)', !!payAudit && payAudit.after?.note === '微信支付待回调', payAudit?.after?.note)
    }
  }

  // ── 2. 验签失败 ──
  console.log('\n【2. 验签失败 → 拒绝、callbackPayload 留痕、订单不动】')
  {
    const o = await prepayOrder()
    if (o && !o.failed) {
      const notify = await fakeNotify(o.payNo, { mode: 'badsign' })
      check('后端仍回 HTTP 200（避免重试风暴）', notify.json?.backendStatus === 200)
      const rec = await getRecord(o.payNo)
      check('callbackPayload 留痕(回调验签失败·rejected)', cbEntries(rec).some((e) => e.source === 'wechat-notify' && e.rejected === true && e.reason === '回调验签失败'))
      check('流水未推进(仍 0)', rec?.status === 0)
      const od = await call('GET', `/order/${o.orderId}`, null, token)
      check('订单不动(仍 10)', od.json?.data?.status === 10)
    }
  }

  // ── 3. 重复回调幂等 ──
  console.log('\n【3. 同一回调重复投递 → 第二次幂等成功、订单/流水不重复推进（audit_log 不新增）】')
  {
    const o = await prepayOrder()
    if (o && !o.failed) {
      await fakeNotify(o.payNo)
      const auditBefore = await auditCount(o.orderId)
      const recBefore = await getRecord(o.payNo)
      const cbLenBefore = cbEntries(recBefore).length
      const notify2 = await fakeNotify(o.payNo)
      check('第二次投递仍 HTTP 200', notify2.json?.backendStatus === 200)
      const recAfter = await getRecord(o.payNo)
      const od = await call('GET', `/order/${o.orderId}`, null, token)
      check('订单仍 30（未重复推进）', od.json?.data?.status === 30)
      check('流水仍 status=1', recAfter?.status === 1)
      check('audit_log 不新增', (await auditCount(o.orderId)) === auditBefore)
      check('callbackPayload 不新增留痕', cbEntries(recAfter).length === cbLenBefore)
    }
  }

  // ── 4. 金额不一致 ──
  console.log('\n【4. 金额不一致 → 拒绝 + 留痕 + 订单不动】')
  {
    const o = await prepayOrder()
    if (o && !o.failed) {
      const notify = await fakeNotify(o.payNo, { mode: 'wrongamount' })
      check('后端回 HTTP 200', notify.json?.backendStatus === 200)
      const rec = await getRecord(o.payNo)
      const entry = cbEntries(rec).find((e) => e.reason === '金额不一致')
      check('callbackPayload 留痕(金额不一致，含期望/通知金额)', !!entry && entry.expectedCents === Math.round(Number(rec.amount) * 100) && entry.notifiedCents === entry.expectedCents + 1, entry)
      check('流水未推进(仍 0)', rec?.status === 0)
      const od = await call('GET', `/order/${o.orderId}`, null, token)
      check('订单不动(仍 10)', od.json?.data?.status === 10)
    }
  }

  // ── 5. 退款（含幂等） ──
  console.log('\n【5. 退款：out_refund_no/金额/out_trade_no 三者一致；重复退款幂等】')
  {
    const o = await prepayOrder()
    if (o && !o.failed) {
      await fakeNotify(o.payNo)
      const r1 = await call('POST', '/payment/wechat/refund', { orderId: o.orderId }, adminToken)
      check('管理员退款成功', r1.json?.code === 0 && r1.json?.data?.refundStatus === 'SUCCESS', r1.json)
      const js = await fakeLog()
      const rf = (js.refundCalls || []).slice(-1)[0] || {}
      check('假服务器断言 out_refund_no = R+payNo', rf.outRefundNo === 'R' + o.payNo, rf)
      check('假服务器断言退款金额=流水金额(分)', rf.refundCents === Math.round(o.expectedAmount * 100), rf.refundCents)
      check('假服务器断言 out_trade_no = payNo', rf.outTradeNo === o.payNo, rf.outTradeNo)
      const rec1 = await getRecord(o.payNo)
      check('退款后流水置 2 且留痕', rec1?.status === 2 && cbEntries(rec1).some((e) => e.source === 'wechat-refund' && e.accepted === true))
      check('退款审计(ORDER_REFUND)', (await auditCount(o.orderId, 'ORDER_REFUND')) >= 1)

      const r2 = await call('POST', '/payment/wechat/refund', { orderId: o.orderId }, adminToken)
      check('重复退款幂等(alreadyRefunded)', r2.json?.code === 0 && r2.json?.data?.alreadyRefunded === true, r2.json)
      const js2 = await fakeLog()
      check('微信侧只收到 1 次退款请求（不会重复退钱）', (js2.refundCalls || []).length === 1, (js2.refundCalls || []).length)
    }
  }

  // ── 5b. 加菜：COD 送达后「微信直接支付」 ──
  console.log('\n【5b. COD 送达后微信直接支付：金额取 amountFinal、回调只落已支付不推进订单】')
  {
    const o = await createOrder()
    if (o) {
      await prisma.order.update({ where: { id: BigInt(o.orderId) }, data: { payMethod: 2, status: 60, amountFinal: 13.14 } })
      const p = await call('POST', '/payment/wechat/prepay', { orderId: o.orderId }, token)
      check('COD 送达单可 prepay 且金额=amountFinal', p.json?.code === 0 && Number(p.json?.data?.amount) === 13.14, p.json)
      if (p.json?.code === 0) {
        const notify = await fakeNotify(p.json.data.payNo)
        check('回调投递 200', notify.json?.backendStatus === 200)
        const rec = await getRecord(p.json.data.payNo)
        check('流水已支付(status=1)', rec?.status === 1)
        const od = await call('GET', `/order/${o.orderId}`, null, token)
        check('订单不推进(仍 60 已送达)', od.json?.data?.status === 60)
        const payAudit = await auditFind(o.orderId, 'ORDER_PAY')
        check('审计注明 COD 送达后线上支付', !!payAudit && String(payAudit.after?.note || '').includes('COD 送达后线上支付'))
      }
    }
  }

  // ══ Phase A 结束，关 3011 ══
  console.log('\n【Phase A 完成，关 3011，起 3012 跑超时关单】')
  stopBackend('backend-pay')

  // ── 6. 超时关单（3012：阈值 1 分钟、cron 每 2 秒） ──
  {
    const up = await startBackend('backend-timeout', PORT_TIMEOUT, { ORDER_PAY_TIMEOUT_MINUTES: '1', ORDER_TIMEOUT_CRON: '*/2 * * * * *' }, 'backend-timeout')
    if (up) {
      // 造两条 10 状态单：A 带微信待支付流水；B 未选支付方式
      const oA = await prepayOrder(PORT_TIMEOUT)
      check('超时用例 A：prepay 建微信待支付流水', !!oA && !oA.failed && !!oA.payNo, oA?.failed)
      const oB = await createOrder(PORT_TIMEOUT)
      check('超时用例 B：订单待支付(10)', oB?.detail?.status === 10)

      console.log('  ⏳ 等待超时阈值（1 分钟）+ 定时扫描（每 2 秒）…')
      let okA = false, okB = false
      for (let i = 0; i < 55 && !(okA && okB); i++) {
        await new Promise((r) => setTimeout(r, 2000))
        if (!okA && oA && !oA.failed) {
          const od = await call('GET', `/order/${oA.orderId}`, null, token, PORT_TIMEOUT)
          okA = od.json?.data?.status === 91
        }
        if (!okB && oB) {
          const od = await call('GET', `/order/${oB.orderId}`, null, token, PORT_TIMEOUT)
          okB = od.json?.data?.status === 91
        }
      }
      check('A（微信待支付）超时置 91', okA)
      if (oA && !oA.failed) {
        const rec = await getRecord(oA.payNo)
        check('A 流水 0→2 且留痕', rec?.status === 2 && cbEntries(rec).some((e) => e.source === 'order-timeout'))
        check('A 审计有 ORDER_TIMEOUT_CLOSE', (await auditCount(oA.orderId, 'ORDER_TIMEOUT_CLOSE')) >= 1)
      }
      check('B（未选支付方式）超时置 91', okB)
      if (oB) check('B 审计有 ORDER_TIMEOUT_CLOSE', (await auditCount(oB.orderId, 'ORDER_TIMEOUT_CLOSE')) >= 1)
    }
  }

  // ══ Phase B 结束，关 3012，起 3013 跑回归 ══
  console.log('\n【Phase B 完成，关 3012，起 3013 跑回归（WX_MOCK_PAY=1：187 基线含模拟通道用例；生产恒为 0）】')
  stopBackend('backend-timeout')
  {
    const up = await startBackend('backend-regression', PORT_REGRESSION, { WX_MOCK_PAY: '1' }, 'backend-regression')
    if (up) {
      const src = fs.readFileSync(path.join(BACKEND_DIR, '验收测试.js'), 'utf8')
      const tmpCopy = path.join(BACKEND_DIR, '验收测试-3013.tmp.js')
      fs.writeFileSync(tmpCopy, src.replace(/localhost:3001/g, `localhost:${PORT_REGRESSION}`), 'utf8')
      console.log(`\n【7. 回归】node 验收测试(副本 sed 3001→${PORT_REGRESSION})（期望 187 通过 / 0 失败）`)
      console.log('-'.repeat(60))
      const reg = await new Promise((resolve) => {
        const child = spawn(process.execPath, [tmpCopy], { cwd: BACKEND_DIR, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
        let out = '', errOut = ''
        child.stdout.on('data', (d) => { out += d; process.stdout.write(d) })
        child.stderr.on('data', (d) => { errOut += d; process.stderr.write(d) })
        const guard = setTimeout(() => { try { child.kill() } catch {} }, 300000)
        child.on('close', (code, signal) => { clearTimeout(guard); resolve({ code, signal, out, errOut }) })
      })
      console.log('-'.repeat(60))
      try { fs.unlinkSync(tmpCopy) } catch {}
      const m = String(reg.out || '').match(/通过\s*(\d+)\s*项\s*\/\s*.*?失败\s*(\d+)\s*项/)
      check('回归套件退出码 0', reg.code === 0, { code: reg.code, signal: reg.signal, stderr: String(reg.errOut || '').slice(0, 300) })
      check('回归结果 187 通过 / 0 失败', m && Number(m[1]) === 187 && Number(m[2]) === 0, m && `${m[1]}/${m[2]}`)
      check('回归临时副本已清理', !fs.existsSync(tmpCopy))
    }
  }

  // ── 收尾 ──
  killAll()
  await prisma.$disconnect().catch(() => {})
  console.log('\n' + '='.repeat(60))
  console.log(`微信支付本地自测：通过 ${passed} / 失败 ${failed}`)
  console.log('='.repeat(60))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('自测脚本异常：', e && e.message ? e.message : e)
  killAll()
  process.exit(1)
})
