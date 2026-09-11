const fs = require('fs'), crypto = require('crypto')
const BASE = 'http://localhost:3001/api/v1'
const env = fs.readFileSync(__dirname + '/.env', 'utf8')
const line = (env.match(/JWT_SECRET=.*/) || ['(无)'])[0]
console.log('--- .env JWT_SECRET 行:', line.slice(0, 30) + '...')
const jwtSecret = (env.match(/JWT_SECRET=(\S+)/) || [])[1]
console.log('secret 长度 =', jwtSecret && jwtSecret.length)

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const h = b64({ alg: 'HS256', typ: 'JWT' })
const p = b64({ sub: 1, userId: 1, roles: ['business_agent'], currentRole: 'business_agent' })
const tok = h + '.' + p + '.' + crypto.createHmac('sha256', jwtSecret).update(h + '.' + p).digest('base64url')

;(async () => {
  for (const path of ['/admin/payments', '/admin/buyers/pending?pageSize=1', '/admin/finance/settlements']) {
    const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + tok } })
    console.log('agentToken -> ' + path + ' :', JSON.stringify(await r.json()).slice(0, 200))
  }
  const la = await (await fetch(BASE + '/auth/wx-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'admin' }) })).json()
  console.log('admin login code =', la.code, 'hasToken =', !!la.data?.token)
  const r4 = await fetch(BASE + '/admin/payments?pageSize=1', { headers: { Authorization: 'Bearer ' + la.data.token } })
  console.log('adminToken -> /admin/payments :', JSON.stringify(await r4.json()).slice(0, 200))
})()
