/**
 * 本地「假微信支付服务器」（卡R1 · 真实微信支付接入的本地自测件）—— 只为自测，不要在生产用
 *
 * 作用：把后端 .env 的 WXPAY_API_BASE 指到本脚本，就能在本机跑通「JSAPI 下单 → 构造并签名
 * 加密回调 → POST 到后端 notify → 退款」的完整 APIv3 回路（验签/解密/幂等/金额核对全都真跑）。
 *
 * 自签材料（首次启动自动生成，之后复用；放在 自测证据/wxpay-local/，该目录不入库）：
 *   - 平台侧 RSA 密钥对：private 仅本脚本持有（模拟微信签名回调/应答），public 写给后端 WXPAY_PUBLIC_KEY_PATH 验签
 *   - 商户侧 RSA 密钥对 + 自签证书（有 openssl 就带证书，没有也能跑：验请求签名用私钥派生的公钥）
 *   - 32 位测试 APIv3 密钥 + test.env（后端启动时以行内环境变量喂进去，不写进仓库 .env）
 * ⚠️ 全部是**测试材料**，与生产凭证无关；日志只打印文件路径与键名，不打印任何密钥内容。
 *
 * 用法：
 *   node scripts/wxpay-fake-server.js                 # 默认监听 3953
 *   FAKE_WXPAY_PORT=3953 FAKE_WXPAY_DIR=<目录> node scripts/wxpay-fake-server.js
 *
 * /v3 接口（与微信同形，响应均带 Wechatpay-Timestamp/Nonce/Signature/Serial 头）：
 *   POST /v3/pay/transactions/jsapi                    → { prepay_id }（验请求签名；记录 notify_url/金额）
 *   POST /v3/refund/domestic/refunds                   → 退款受理（out_refund_no 幂等：重复返回同一结果）
 *   GET  /v3/pay/transactions/out-trade-no/:no         → 交易查询
 *
 * 取证 / 控制：
 *   POST /__notify  body { outTradeNo, mode?, amountCents? } → 构造并加密回调，POST 到后端 notify_url，
 *                    返回 { backendStatus }。mode: normal | badsign | wrongamount | notsuccess
 *   GET  /__mode?name=xxx                                    → 设置全局回调模式（同上四种）
 *   GET  /__log                                              → { mode, jsapiCalls, refundCalls, notifySends }
 *   GET  /__reset                                            → 清空记录、模式复位 normal
 */
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const PORT = Number(process.env.FAKE_WXPAY_PORT || process.argv[2] || 3953)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const DATA_DIR = process.env.FAKE_WXPAY_DIR || path.join(PROJECT_ROOT, '自测证据', 'wxpay-local')
const PUBLIC_KEY_ID = 'PUB_KEY_ID_LOCALTEST00000001'

/* ───────────────── 自签材料准备 ───────────────── */
function ensureMaterial() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const files = {
    platformPriv: path.join(DATA_DIR, 'platform-private.pem'),
    platformPub: path.join(DATA_DIR, 'platform-public.pem'),
    merchantPriv: path.join(DATA_DIR, 'merchant-private.pem'),
    merchantPub: path.join(DATA_DIR, 'merchant-public.pem'),
    merchantCert: path.join(DATA_DIR, 'merchant-cert.pem'),
    testEnv: path.join(DATA_DIR, 'test.env'),
  }
  // 平台侧（模拟微信）：验签公钥给后端，签名私钥自留
  if (!fs.existsSync(files.platformPriv)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    fs.writeFileSync(files.platformPriv, privateKey.export({ type: 'pkcs1', format: 'pem' }))
    fs.writeFileSync(files.platformPub, publicKey.export({ type: 'spki', format: 'pem' }))
  }
  // 商户侧（模拟商户号）：请求签名私钥给后端，验签公钥自留
  if (!fs.existsSync(files.merchantPriv)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    fs.writeFileSync(files.merchantPriv, privateKey.export({ type: 'pkcs1', format: 'pem' }))
    fs.writeFileSync(files.merchantPub, publicKey.export({ type: 'spki', format: 'pem' }))
  }
  // 商户自签证书（可选：本机有 openssl 才生成；⚠️ 必须从**已有私钥**出证书（-key），
  // 绝不能用 -newkey -keyout 覆盖商户私钥 —— 那会让 merchant-public.pem 与私钥不再配对）
  let certSerial = ''
  if (!fs.existsSync(files.merchantCert)) {
    const gen = spawnSync('openssl', [
      'req', '-x509', '-key', files.merchantPriv,
      '-out', files.merchantCert, '-days', '30', '-subj', '/CN=lvlifang-local-test',
    ], { stdio: 'ignore' })
    if (gen.status !== 0 || !fs.existsSync(files.merchantCert)) {
      try { fs.unlinkSync(files.merchantCert) } catch {}
    }
  }
  if (fs.existsSync(files.merchantCert)) {
    const ser = spawnSync('openssl', ['x509', '-in', files.merchantCert, '-noout', '-serial'], { encoding: 'utf8' })
    if (ser.status === 0 && /serial=([0-9A-Fa-f]+)/.test(ser.stdout)) certSerial = RegExp.$1.toLowerCase()
  }
  // 公钥文件始终从当前私钥重派生（自愈：防止历史遗留的不配对文件）
  fs.writeFileSync(files.merchantPub, crypto.createPublicKey(fs.readFileSync(files.merchantPriv, 'utf8')).export({ type: 'spki', format: 'pem' }))

  // test.env：存在则复用（保证多进程/多轮一致），否则生成
  const readEnv = (p) => {
    const out = {}
    if (!fs.existsSync(p)) return out
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) out[m[1]] = m[2]
    }
    return out
  }
  const env = readEnv(files.testEnv)
  if (!env.WXPAY_APIV3_KEY) env.WXPAY_APIV3_KEY = crypto.randomBytes(16).toString('hex') // 32 位测试密钥
  env.WXPAY_MCHID = env.WXPAY_MCHID || '1111111111' // 假商户号（非真实）
  env.WXPAY_PUBLIC_KEY_ID = PUBLIC_KEY_ID
  env.WXPAY_CERT_SERIAL = env.WXPAY_CERT_SERIAL || certSerial || crypto.randomBytes(10).toString('hex')
  env.WXPAY_KEY_PATH = files.merchantPriv
  env.WXPAY_PUBLIC_KEY_PATH = files.platformPub
  env.WXPAY_CERT_PATH = fs.existsSync(files.merchantCert) ? files.merchantCert : ''
  env.WXPAY_API_BASE = `http://127.0.0.1:${PORT}`
  env.WXPAY_NOTIFY_URL = env.WXPAY_NOTIFY_URL || `http://127.0.0.1:3011/api/v1/payment/wechat/notify`
  fs.writeFileSync(
    files.testEnv,
    Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n',
    'utf8',
  )
  return { files, env }
}

const { files, env: TEST_ENV } = ensureMaterial()

/* ───────────────── 密钥与签名工具 ───────────────── */
const platformPriv = fs.readFileSync(files.platformPriv, 'utf8')
const platformPubForBadSign = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey // badsign 模式用一次性错钥
const merchantPub = crypto.createPublicKey(fs.readFileSync(files.merchantPriv, 'utf8')) // 验后端请求签名

const signPlatform = (message, priv = platformPriv) =>
  crypto.createSign('RSA-SHA256').update(message).sign(priv, 'base64')

const verifyMerchantRequest = (method, urlWithQuery, ts, nonce, body, signature) => {
  const message = `${method}\n${urlWithQuery}\n${ts}\n${nonce}\n${body}\n`
  try {
    return crypto.createVerify('RSA-SHA256').update(message).verify(merchantPub, signature, 'base64')
  } catch {
    return false
  }
}

const parseAuth = (authHeader) => {
  const m = String(authHeader || '').match(/mchid="([^"]*)",nonce_str="([^"]*)",signature="([^"]*)",timestamp="([^"]*)",serial_no="([^"]*)"/)
  return m ? { mchid: m[1], nonce: m[2], signature: m[3], timestamp: m[4], serial: m[5] } : null
}

/** AES-256-GCM 加密（ciphertext base64 = 密文+16字节 tag，与微信格式一致） */
const encryptResource = (plainObj, apiV3Key, associatedData, nonce) => {
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'))
  cipher.setAAD(Buffer.from(associatedData, 'utf8'))
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(plainObj), 'utf8')), cipher.final()])
  return Buffer.concat([ct, cipher.getAuthTag()]).toString('base64')
}

/* ───────────────── 状态 ───────────────── */
let mode = 'normal'
const prepayRecords = new Map() // outTradeNo → { totalCents, openid, notifyUrl, mchid }
const refunds = new Map() // outRefundNo → refund 对象
let seq = 0
const jsapiCalls = []
const refundCalls = []
const notifySends = []

const signedJson = (res, obj, code = 200) => {
  const body = JSON.stringify(obj)
  const ts = Math.floor(Date.now() / 1000).toString()
  const nonce = crypto.randomBytes(12).toString('hex')
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Request-ID': `fake-${++seq}`,
    'Wechatpay-Timestamp': ts,
    'Wechatpay-Nonce': nonce,
    'Wechatpay-Serial': PUBLIC_KEY_ID,
    'Wechatpay-Signature': signPlatform(`${ts}\n${nonce}\n${body}\n`),
  }
  res.writeHead(code, headers)
  res.end(body)
}

/** 构造 + 加密 + 签名回调，POST 到后端 notify_url；返回后端 HTTP 状态 */
function sendNotify(outTradeNo, opts = {}) {
  const rec = prepayRecords.get(outTradeNo)
  if (!rec) return { error: 'unknown outTradeNo' }
  const m = opts.mode || mode
  const totalCents = m === 'wrongamount' ? Number(opts.amountCents ?? rec.totalCents + 1) : rec.totalCents
  const nonce = crypto.randomBytes(12).toString('hex')
  const resource = {
    original_type: 'transaction',
    algorithm: 'AEAD_AES_256_GCM',
    associated_data: 'transaction',
    nonce,
    ciphertext: encryptResource(
      {
        out_trade_no: outTradeNo,
        transaction_id: `WXTEST${String(++seq).padStart(10, '0')}`,
        trade_type: 'JSAPI',
        trade_state: m === 'notsuccess' ? 'CLOSED' : 'SUCCESS',
        amount: { total: totalCents, payer_total: totalCents, currency: 'CNY' },
        payer: { openid: rec.openid },
        success_time: new Date().toISOString().replace(/\.\d{3}Z$/, '+08:00'),
      },
      TEST_ENV.WXPAY_APIV3_KEY,
      'transaction',
      nonce,
    ),
  }
  const bodyObj = {
    id: `EV-${Date.now()}-${seq}`,
    create_time: new Date().toISOString(),
    resource_type: 'encrypt-resource',
    event_type: 'TRANSACTION.SUCCESS',
    summary: '支付成功',
    resource,
  }
  const body = JSON.stringify(bodyObj)
  const ts = Math.floor(Date.now() / 1000).toString()
  const cbNonce = crypto.randomBytes(12).toString('hex')
  // badsign：用一次性错钥签名 → 后端验签必败
  const signPriv = m === 'badsign' ? platformPubForBadSign : platformPriv
  const headers = {
    'Content-Type': 'application/json',
    'Wechatpay-Timestamp': ts,
    'Wechatpay-Nonce': cbNonce,
    'Wechatpay-Serial': PUBLIC_KEY_ID,
    'Wechatpay-Signature': signPlatform(`${ts}\n${cbNonce}\n${body}\n`, signPriv),
  }
  notifySends.push({ at: new Date().toISOString(), outTradeNo, mode: m, totalCents, url: rec.notifyUrl })
  return postJson(rec.notifyUrl, body, headers)
}

function postJson(url, body, headers) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers, timeout: 8000 },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ backendStatus: res.statusCode, backendBody: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('error', (e) => resolve({ error: String(e && e.message ? e.message : e) }))
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }) })
    req.end(body)
  })
}

/* ───────────────── HTTP 服务 ───────────────── */
const json = (res, obj, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost')
  const p = u.pathname
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', async () => {
    if (p === '/__reset') {
      mode = 'normal'; jsapiCalls.length = 0; refundCalls.length = 0; notifySends.length = 0
      prepayRecords.clear(); refunds.clear()
      return json(res, { ok: true, mode })
    }
    if (p === '/__mode') {
      mode = u.searchParams.get('name') || 'normal'
      return json(res, { ok: true, mode })
    }
    if (p === '/__log') return json(res, { mode, jsapiCalls, refundCalls, notifySends })
    if (p === '/__notify') {
      let input = {}
      try { input = JSON.parse(raw || '{}') } catch {}
      if (!input.outTradeNo) return json(res, { error: 'outTradeNo required' }, 400)
      const r = await sendNotify(input.outTradeNo, { mode: input.mode, amountCents: input.amountCents })
      return json(res, r)
    }

    /* ── 以下模拟真实微信 /v3 接口：验请求签名 → 记录 → 签名应答 ── */
    const auth = parseAuth(req.headers.authorization)
    const sigOk = !!auth && verifyMerchantRequest(req.method, req.url, auth.timestamp, auth.nonce, raw, auth.signature)

    if (p === '/v3/pay/transactions/jsapi' && req.method === 'POST') {
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch {}
      jsapiCalls.push({
        at: new Date().toISOString(), sigOk,
        outTradeNo: body.out_trade_no, totalCents: body.amount && body.amount.total,
        openid: body.payer && body.payer.openid, notifyUrl: body.notify_url, appid: body.appid,
      })
      if (!sigOk) return json(res, { code: 'SIGN_ERROR', message: 'fake: 请求签名校验失败' }, 401)
      prepayRecords.set(body.out_trade_no, {
        totalCents: body.amount && body.amount.total,
        openid: body.payer && body.payer.openid,
        notifyUrl: body.notify_url,
        mchid: body.mchid,
      })
      return signedJson(res, { prepay_id: `PP${Date.now()}${String(++seq).padStart(4, '0')}` })
    }

    if (p === '/v3/refund/domestic/refunds' && req.method === 'POST') {
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch {}
      refundCalls.push({
        at: new Date().toISOString(), sigOk,
        outRefundNo: body.out_refund_no, outTradeNo: body.out_trade_no,
        refundCents: body.amount && body.amount.refund, totalCents: body.amount && body.amount.total,
      })
      if (!sigOk) return json(res, { code: 'SIGN_ERROR', message: 'fake: 请求签名校验失败' }, 401)
      // out_refund_no 幂等：重复请求返回同一退款对象（微信语义）
      const key = body.out_refund_no
      if (!refunds.has(key)) {
        refunds.set(key, {
          refund_id: `RF${Date.now()}${String(++seq).padStart(4, '0')}`,
          out_refund_no: body.out_refund_no,
          out_trade_no: body.out_trade_no,
          amount: body.amount,
          status: 'SUCCESS',
          success_time: new Date().toISOString(),
        })
      }
      return signedJson(res, refunds.get(key))
    }

    const mQuery = p.match(/^\/v3\/pay\/transactions\/out-trade-no\/([^/]+)$/)
    if (mQuery && req.method === 'GET') {
      const no = decodeURIComponent(mQuery[1])
      const rec = prepayRecords.get(no)
      if (!rec) return json(res, { code: 'ORDER_NOT_EXIST', message: 'fake: 订单不存在' }, 404)
      return signedJson(res, {
        out_trade_no: no, trade_state: 'SUCCESS',
        amount: { total: rec.totalCents, payer_total: rec.totalCents, currency: 'CNY' },
      })
    }

    json(res, { code: 'NOT_FOUND', message: 'fake: not found' }, 404)
  })
})

server.listen(PORT, () => {
  console.log(`[假微信支付] 已启动 http://127.0.0.1:${PORT}（仅自测用）`)
  console.log(`[假微信支付] 自签材料与 test.env 目录：${DATA_DIR}`)
  console.log(`[假微信支付] 取证：GET /__log ｜ 回调模式：GET /__mode?name=normal|badsign|wrongamount|notsuccess ｜ 触发回调：POST /__notify ｜ 重置：GET /__reset`)
})
