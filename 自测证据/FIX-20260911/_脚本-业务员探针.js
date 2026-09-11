// 业务员权限探针：打印业务员 token 访问关键接口的返回码（用于「删兜底 前/后」对照取证）
const fs = require('fs'), crypto = require('crypto')
const BASE = 'http://localhost:3001/api/v1'
const raw = (fs.readFileSync(__dirname + '/.env', 'utf8').match(/^JWT_SECRET=(.*)$/m) || [])[1] || ''
const jwtSecret = raw.trim().replace(/^['"]|['"]$/g, '')
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const h = b64({ alg: 'HS256', typ: 'JWT' })
const p = b64({ sub: 1, userId: 1, roles: ['business_agent'], currentRole: 'business_agent' })
const tok = h + '.' + p + '.' + crypto.createHmac('sha256', jwtSecret).update(h + '.' + p).digest('base64url')

const CASES = [
  ['GET', '/admin/payments', 'ADMIN接口·支付流水'],
  ['GET', '/admin/finance/settlements', 'ADMIN接口·资金结算'],
  ['GET', '/admin/dispatch', 'ADMIN接口·派单调度'],
  ['GET', '/admin/goods/pending', 'ADMIN接口·商品管理'],
  ['GET', '/audit', 'ADMIN接口·审计日志'],
  ['GET', '/admin/buyers/pending?pageSize=1', '应得·采购方待审列表'],
]

;(async () => {
  console.log('业务员 token 探针（' + new Date().toISOString() + '）')
  console.log('-' .repeat(64))
  for (const [m, path, label] of CASES) {
    const r = await fetch(BASE + path, { method: m, headers: { Authorization: 'Bearer ' + tok } })
    const j = await r.json()
    const verdict = j.code === 2002 ? '拒绝(2002 FORBIDDEN)' : j.code === 0 ? '★放行(0 OK)' : '其它(' + j.code + ')'
    console.log(String(j.code).padEnd(6) + verdict.padEnd(24) + path + '   # ' + label)
  }
})()
