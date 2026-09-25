/**
 * 本地「假微信服务」—— 只为自测「到货通知」的发送分支与模板字段探测，**不要在生产用**
 *
 * 为什么需要它：本机没有真实「到货通知」订阅消息模板 id（那要公众平台申请），
 * 也**不允许**拿测试流量去碰线上微信接口。但下面这些分支恰恰必须在真实 HTTP 往返上验，
 * 而且结果必须**真的落库**到 demand_notify_log：
 *   · 订阅消息发出去了 / 客户没授权 → 降级客服消息 / 额度用完了 / 客服消息超 48 小时（45015）
 *   · **47003（模板字段名/格式不匹配）** —— 模板字段探测与自动映射的正确性只能这样验
 *   · 模板字段自动探测：正常返回 / 列表里没有这个模板 / 接口报错（要能降级到默认映射）
 *
 * 做法：起一个假的微信服务端，把后端的 `WX_API_BASE` 指过来。
 *
 * 用法：
 *   node scripts/wx-fake-server.js                       # 默认监听 3952
 *   FAKE_WX_PORT=3952 FAKE_TMPL_ID=<模板id> node scripts/wx-fake-server.js
 *   # 后端侧（行内环境变量覆盖，**不写 .env**）：
 *   WX_API_BASE=http://127.0.0.1:3952 WX_SUBSCRIBE_TMPL_DEMAND=<模板id> PORT=3001 node dist/main
 *
 * 行为开关：
 *   ① 按接收人 openid 里的关键字（逐人分支）
 *      openid 含 'refuse'   → 订阅消息返回 43101（用户拒收）
 *      openid 含 'expired'  → 客服消息返回 45015（超出 48 小时窗口）
 *      openid 含 'badfield' → 订阅消息返回 47003（模板字段名/格式不匹配）
 *   ② 全局模式 GET /__mode?name=xxx（模板探测分支）
 *      normal   —— 正常返回模板列表（默认）
 *      nompl    —— 列表里**没有**我们的模板（验「找不到 → 降级默认映射」）
 *      tmpl500  —— 模板列表接口返回错误码（验「调不通 → 降级并落日志」）
 *
 * 取证接口：
 *   GET /__log   → { mode, tokenCalls, tmplCalls, calls:[...] }
 *                  tokenCalls 证明 access_token **取一次就复用**；
 *                  tmplCalls 证明模板列表也是缓存复用。
 *   GET /__reset → 清空计数、日志，并把模式复位成 normal
 *
 * 🔒 只记录 pathname，**不记录 query**：/cgi-bin/token 的 query 里带 appid 与 secret。
 */
const http = require('http')

const PORT = Number(process.env.FAKE_WX_PORT || process.argv[2] || 3952)
/** 假模板 id —— 必须与后端 WX_SUBSCRIBE_TMPL_DEMAND 一致 */
const TMPL_ID = process.env.FAKE_TMPL_ID || 'FAKE_TMPL_DEMAND_0001'

let tokenCalls = 0
let tmplCalls = 0
let mode = 'normal'
let calls = []

/** 真实模板的形状：一次性订阅(type=2) + 商品名称/商品单价/温馨提示。
 *  ⚠️ 字段名按官方格式写在 content 的 {{xxx.DATA}} 里（官方 gettemplate **不返回 kid 数组**）。 */
const OUR_TEMPLATE = {
  priTmplId: TMPL_ID,
  title: '预约商品到货通知',
  content: '商品名称:{{thing1.DATA}}\n商品单价:{{amount2.DATA}}\n温馨提示:{{thing3.DATA}}',
  example: '商品名称:荷兰豆\n商品单价:¥5.80\n温馨提示:已到货 可下单',
  type: 2,
}
const OTHER_TEMPLATE = {
  priTmplId: 'OTHER_TMPL_NOT_OURS',
  title: '订单发货通知',
  content: '订单编号:{{character_string1.DATA}}\n发货时间:{{time2.DATA}}',
  example: '订单编号:20240925001\n发货时间:09:30',
  type: 2,
}

const json = (res, obj, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost')
  const path = u.pathname
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (path === '/__reset') {
      tokenCalls = 0
      tmplCalls = 0
      mode = 'normal'
      calls = []
      return json(res, { ok: true, mode })
    }
    if (path === '/__mode') {
      mode = u.searchParams.get('name') || 'normal'
      calls.push({ at: new Date().toISOString(), path, kind: 'mode', mode })
      return json(res, { ok: true, mode })
    }
    if (path === '/__log') return json(res, { mode, tokenCalls, tmplCalls, calls })

    if (path === '/cgi-bin/token') {
      tokenCalls++
      // ⚠️ 只记 pathname，query 里有 secret
      calls.push({ at: new Date().toISOString(), path, kind: 'token', seq: tokenCalls })
      return json(res, { access_token: `FAKE_TOKEN_${tokenCalls}`, expires_in: 7200 })
    }

    // ── 模板列表（字段自动探测）──
    if (path === '/wxaapi/newtmpl/gettemplate') {
      tmplCalls++
      calls.push({ at: new Date().toISOString(), path, kind: 'gettemplate', mode })
      if (mode === 'tmpl500') {
        return json(res, { errcode: 50001, errmsg: 'system error (fake)' })
      }
      if (mode === 'nompl') {
        return json(res, { errcode: 0, errmsg: 'ok', data: [OTHER_TEMPLATE] })
      }
      return json(res, { errcode: 0, errmsg: 'ok', data: [OUR_TEMPLATE, OTHER_TEMPLATE] })
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
      if (touser.includes('badfield')) {
        return json(res, { errcode: 47003, errmsg: 'argument invalid! data.amount2.value invalid (fake)' })
      }
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
  console.log(`[假微信] 已启动 http://127.0.0.1:${PORT}（仅自测用）｜模板 id=${TMPL_ID}`)
  console.log('[假微信] 取证：GET /__log ｜ 切换模式：GET /__mode?name=normal|nompl|tmpl500 ｜ 重置：GET /__reset')
})
