/**
 * 本地「假微信服务」—— 只为自测「到货通知」的四条发送分支，**不要在生产用**
 *
 * 为什么需要它：本机没有真实「到货通知」订阅消息模板 id（那要公众平台申请 + 大辉操作），
 * 也**不允许**拿测试流量去碰线上微信接口。但「订阅消息发出去了 / 客户没授权 → 降级客服消息 /
 * 额度用完了 / 客服消息超 48 小时（45015）」这些分支恰恰必须在真实 HTTP 往返上验，
 * 而且结果必须**真的落库**到 demand_notify_log。
 *
 * 做法：起一个假的微信服务端，把后端的 `WX_API_BASE` 指过来。
 *
 * 用法：
 *   node scripts/wx-fake-server.js                       # 默认监听 3952
 *   FAKE_WX_PORT=3952 node scripts/wx-fake-server.js
 *   # 后端侧（行内环境变量覆盖，**不写 .env**）：
 *   WX_API_BASE=http://127.0.0.1:3952 WX_SUBSCRIBE_TMPL_DEMAND=FAKE_TMPL_DEMAND_0001 PORT=3001 node dist/main
 *
 * 行为开关（按接收人 openid 里的关键字）：
 *   openid 含 'refuse'  → 订阅消息返回 43101（用户拒收）
 *   openid 含 'expired' → 客服消息返回 45015（超出 48 小时窗口）
 *   其它                → 返回 errcode 0
 *
 * 取证接口：
 *   GET /__log   → { tokenCalls, calls:[...] }（tokenCalls 用来证明 access_token **取一次就复用**）
 *   GET /__reset → 清空计数与日志
 *
 * 🔒 只记录 pathname，**不记录 query**：/cgi-bin/token 的 query 里带 appid 与 secret。
 */
const http = require('http')

const PORT = Number(process.env.FAKE_WX_PORT || process.argv[2] || 3952)
let tokenCalls = 0
let calls = []

const json = (res, obj, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

const server = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (path === '/__reset') {
      tokenCalls = 0
      calls = []
      return json(res, { ok: true })
    }
    if (path === '/__log') return json(res, { tokenCalls, calls })

    if (path === '/cgi-bin/token') {
      tokenCalls++
      // ⚠️ 只记 pathname，query 里有 secret
      calls.push({ at: new Date().toISOString(), path, kind: 'token', seq: tokenCalls })
      return json(res, { access_token: `FAKE_TOKEN_${tokenCalls}`, expires_in: 7200 })
    }

    let parsed = {}
    try {
      parsed = JSON.parse(body || '{}')
    } catch (e) {
      /* 保持空对象 */
    }
    const touser = String(parsed.touser || '')

    if (path === '/cgi-bin/message/subscribe/send') {
      calls.push({
        at: new Date().toISOString(),
        path,
        kind: 'subscribe',
        touser,
        templateId: parsed.template_id,
        page: parsed.page,
        data: parsed.data,
      })
      if (touser.includes('refuse')) {
        return json(res, { errcode: 43101, errmsg: 'user refuse to accept the msg' })
      }
      return json(res, { errcode: 0, errmsg: 'ok' })
    }

    if (path === '/cgi-bin/message/custom/send') {
      calls.push({
        at: new Date().toISOString(),
        path,
        kind: 'custom',
        touser,
        content: parsed.text && parsed.text.content,
      })
      if (touser.includes('expired')) {
        return json(res, { errcode: 45015, errmsg: 'response out of time limit or subscription is canceled' })
      }
      return json(res, { errcode: 0, errmsg: 'ok' })
    }

    json(res, { errcode: 404, errmsg: 'not found' }, 404)
  })
})

server.listen(PORT, () => {
  console.log(`[假微信] 已启动 http://127.0.0.1:${PORT}（仅自测用）`)
  console.log('[假微信] 取证：GET /__log  ·  重置：GET /__reset')
})
