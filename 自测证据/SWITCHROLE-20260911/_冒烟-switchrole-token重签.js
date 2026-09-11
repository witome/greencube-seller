/**
 * B 卡接口冒烟：switch-role 重签 token + 判权生效验证（掩码输出，不落明文 token）
 * 前置：user 10（dev_buyer）已临时挂 supplier 身份（supplier id=8，测后回滚）
 */
const BASE = 'http://127.0.0.1:3001/api/v1'

function parseJwtPayload(token) {
  try {
    const p = token.split('.')[1]
    return JSON.parse(Buffer.from(p, 'base64').toString('utf8'))
  } catch (e) {
    return { error: '解析失败' }
  }
}
const mask = (t) => (t ? t.slice(0, 12) + '...' + t.slice(-8) + ' (len=' + t.length + ')' : '(空)')
const summarize = (pl) => ({ userId: pl.userId, roles: pl.roles, currentRole: pl.currentRole })

async function call(method, url, token, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = {}
  try { json = await res.json() } catch (e) {}
  return { http: res.status, code: json.code, msg: json.msg, data: json.data }
}

;(async () => {
  let fail = 0
  const chk = (name, ok, extra) => {
    console.log((ok ? '✅ ' : '❌ ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''))
    if (!ok) fail++
  }

  // ① 以 buyer 登录（user 10，purchaser+supplier 双身份）
  const login = await call('POST', '/auth/wx-login', null, { code: 'buyer' })
  const oldToken = login.data?.token
  chk('① buyer 登录（user 10）', !!oldToken && login.code === 0, { roles: login.data?.roles, currentRole: login.data?.currentRole })
  console.log('  旧 token 掩码:', mask(oldToken))
  console.log('  旧 token payload:', JSON.stringify(summarize(parseJwtPayload(oldToken))))

  // ② 切换到 supplier → 新 token
  const sw = await call('POST', '/auth/switch-role', oldToken, { role: 'supplier' })
  const newToken = sw.data?.token
  chk('② POST /auth/switch-role {role:supplier} 成功', sw.code === 0 && !!newToken, { currentRole: sw.data?.currentRole })
  console.log('  新 token 掩码:', mask(newToken))
  const newPl = parseJwtPayload(newToken)
  console.log('  新 token payload:', JSON.stringify(summarize(newPl)))
  const oldPl = parseJwtPayload(oldToken)
  chk('③ token 确实重签（字符串不同 + payload.currentRole 变化）', newToken !== oldToken && oldPl.currentRole === 'purchaser' && newPl.currentRole === 'supplier', {
    before: oldPl.currentRole, after: newPl.currentRole, sameToken: newToken === oldToken,
  })

  // ③ 判权生效：新 token（supplier）能进供应商接口；旧 token（purchaser）被拒
  const goods = await call('GET', '/supplier-goods', newToken)
  chk('④ 新 token(supplier) GET /supplier-goods → 200', goods.code === 0, { itemCount: (goods.data?.list || []).length, stall: '测试摊位-身份切换验证' })
  const forbidden = await call('GET', '/supplier-goods', oldToken)
  chk('⑤ 旧 token(purchaser) GET /supplier-goods → 被拒（FORBIDDEN 2002）', forbidden.code === 2002, { code: forbidden.code, http: forbidden.http })

  // ⑥ 反向：切换到不具名身份 → 后端拒绝
  const bad = await call('POST', '/auth/switch-role', newToken, { role: 'courier' })
  chk('⑥ 切到不具备的身份(courier) → 服务端拒绝', bad.code !== 0, { code: bad.code, msg: bad.msg })

  console.log(fail ? `\n❌ 冒烟失败 ${fail} 项` : '\n✅ 冒烟全部通过')
  process.exit(fail ? 1 : 0)
})()
