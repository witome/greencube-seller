/**
 * 假·微信小程序服务端（卡S1 自测用）—— 只实现发货信息管理那一族接口
 *
 * 为什么自己造：真机/生产才会真调微信，本地无法联调；而这一族接口有三个"形状坑"
 * （必须 POST、要 appid、get_order 字段名不同），只有让假服务器**逐字段断言**才能固化。
 *
 * 运行：FAKE_SHIP_PORT=3956 node scripts/wx-shipping-fake-server.js
 * 控制面：POST /__mode {upload:'ok'|'bad'|'noretry'|'done'|'timeout', managed, confirmed, special}
 *         GET  /__log   → { mode, calls }
 * ⚠️ 绝不打印任何密钥（本服务不需要密钥）。
 */
const http = require('http')

const PORT = Number(process.env.FAKE_SHIP_PORT || 3956)

const mode = { upload: 'ok', managed: true, confirmed: true, special: 'ok' }
const calls = { token: 0, upload: [], special: [], getOrder: [], isManaged: 0, isConfirmed: 0 }

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const u = new URL(req.url, 'http://127.0.0.1')
    const send = (o) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(o))
    }
    let j = {}
    try {
      j = JSON.parse(body || '{}')
    } catch {
      /* 忽略 */
    }

    if (u.pathname === '/__mode') {
      Object.assign(mode, j)
      return send({ ok: true, mode })
    }
    if (u.pathname === '/__log') {
      return send({ mode, calls })
    }
    if (u.pathname === '/cgi-bin/token') {
      calls.token++
      return send({ access_token: `FAKE_MP_TOKEN_${calls.token}`, expires_in: 7200 })
    }
    if (u.pathname === '/wxa/sec/order/is_trade_managed') {
      calls.isManaged++
      if (!j.appid) return send({ errcode: 40097, errmsg: 'invalid args' }) // 复刻真接口：空体报错
      return send({ errcode: 0, errmsg: 'ok', is_trade_managed: mode.managed })
    }
    if (u.pathname === '/wxa/sec/order/is_trade_management_confirmation_completed') {
      calls.isConfirmed++
      if (!j.appid) return send({ errcode: 40097, errmsg: 'invalid args' })
      return send({ errcode: 0, errmsg: 'ok', completed: mode.confirmed })
    }
    if (u.pathname === '/wxa/sec/order/upload_shipping_info') {
      calls.upload.push({ body: j, at: new Date().toISOString() })
      if (mode.upload === 'done') return send({ errcode: 10060002, errmsg: '支付单已完成发货，无法继续发货' })
      if (mode.upload === 'noretry') return send({ errcode: 10060003, errmsg: '支付单已使用重新发货机会' })
      if (mode.upload === 'bad') return send({ errcode: 10060005, errmsg: '物流类型有误' })
      if (mode.upload === 'timeout') return send({ errcode: -1, errmsg: 'system error' })
      return send({ errcode: 0, errmsg: 'ok' })
    }
    if (u.pathname === '/wxa/sec/order/opspecialorder') {
      calls.special.push(j)
      if (mode.special === 'fail') return send({ errcode: 10060012, errmsg: 'system error' })
      return send({ errcode: 0, errmsg: 'ok' })
    }
    if (u.pathname === '/wxa/sec/order/get_order') {
      calls.getOrder.push(j)
      // 复刻真接口的字段名（merchant_id / merchant_trade_no）——传成 mchid/out_trade_no 真接口回 47001
      if (!j.merchant_id || !j.merchant_trade_no) return send({ errcode: 47001, errmsg: 'data format error' })
      return send({
        errcode: 0,
        errmsg: 'ok',
        order: { merchant_id: j.merchant_id, merchant_trade_no: j.merchant_trade_no, order_state: mode.orderState ?? 1 },
      })
    }
    return send({ errcode: 63002, errmsg: `unknown path ${u.pathname}` })
  })
})

server.listen(PORT, '127.0.0.1', () => console.log(`[fake-ship] listening 127.0.0.1:${PORT}`))
