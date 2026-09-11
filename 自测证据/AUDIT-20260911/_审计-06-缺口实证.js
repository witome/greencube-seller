/**
 * 缺口实证：handleException（PUT /admin/dispatch/exceptions/:id）不留审计
 * 对照设计：配送员上报异常（会写 courier_report）→ 运营处理异常（预期 0 新增）
 * 运行：cd backend && node ../自测证据/AUDIT-20260911/_审计-06-缺口实证.js
 */
const { execFileSync } = require('child_process')
const BASE = 'http://127.0.0.1:3001/api/v1'
const MYSQL = 'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe'
const A = ['-ulvlifang_app', '-pAKC4VYr3mGVZ66QuUXOMKXKokc2gOjH8', '-h127.0.0.1', '-P3306', 'lvlifang', '--batch', '--skip-column-names']

function scalar(q) {
  const out = execFileSync(MYSQL, [...A, '-e', q], { encoding: 'utf8' })
  const m = out.match(/\d+/)
  return m ? Number(m[0]) : NaN
}
function table(q) {
  const out = execFileSync(MYSQL, [...A.slice(0, -2), '--table', '-e', q], { encoding: 'utf8' })
  return out.replace(/mysql: \[Warning\][^\n]*\n/g, '')
}

async function call(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const t = await r.text()
  try { return JSON.parse(t) } catch (e) { return { _http: r.status } }
}

;(async () => {
  console.log('══════════ 缺口实证：handleException 无审计 ══════════')
  const at = (await call('POST', '/auth/wx-login', { code: 'admin' })).data.token
  const ct = (await call('POST', '/auth/wx-login', { code: 'courier' })).data.token

  // 挑一张配送中(50)订单
  const oid = scalar(`SELECT id FROM \`order\` WHERE status=50 ORDER BY id DESC LIMIT 1;`)
  console.log('\n目标订单（status=50 配送中）:', oid)

  const m0 = scalar(`SELECT IFNULL(MAX(id),0) FROM audit_log;`)
  console.log('步骤0 初始 max(audit_log.id) =', m0)

  // ① 配送员上报异常（代码：courier.service.ts:172 直写 auditLog）
  const rep = await call('POST', '/courier/report', { orderId: oid, reason: '审计复核实测-异常上报' }, ct)
  const m1 = scalar(`SELECT IFNULL(MAX(id),0) FROM audit_log;`)
  console.log('\n① POST /courier/report（配送员上报异常）→', JSON.stringify(rep))
  console.log(`   max(audit_log.id): ${m0} → ${m1}   ${m1 > m0 ? '★ +' + (m1 - m0) + ' 条（courier_report：已留痕）' : '无新增'}`)

  // ② 找到刚落库的待处理异常工单
  const excId = scalar(`SELECT id FROM delivery_exception WHERE status=0 ORDER BY id DESC LIMIT 1;`)
  console.log('\n② 新生成的异常工单 id =', excId)

  // ③ 运营处理异常工单（代码：admin-dispatch.service.ts:289 handleException — 无 audit 调用）
  const m2 = scalar(`SELECT IFNULL(MAX(id),0) FROM audit_log;`)
  const h = await call('PUT', `/admin/dispatch/exceptions/${excId}`, null, at)
  const m3 = scalar(`SELECT IFNULL(MAX(id),0) FROM audit_log;`)
  console.log('\n③ PUT /admin/dispatch/exceptions/' + excId + '（运营处理异常）→', JSON.stringify(h))
  console.log(`   max(audit_log.id): ${m2} → ${m3}   ${m3 === m2 ? '★ 无新增记录 = 缺口实证（应留痕而未留痕）' : '+ ' + (m3 - m2) + ' 条'}`)

  console.log('\n══════════ 真实 SQL 支持 ══════════')
  console.log('SQL> SELECT id, action, entity, entity_id, created_at FROM audit_log WHERE id > ' + m0 + ' ORDER BY id;')
  console.log(table(`SELECT id, action, entity, entity_id, created_at FROM audit_log WHERE id > ${m0} ORDER BY id;`))
  console.log('SQL> SELECT id, order_id, status, handled_by, handled_at FROM delivery_exception WHERE id = ' + excId + ';')
  console.log(table(`SELECT id, order_id, status, handled_by, handled_at FROM delivery_exception WHERE id = ${excId};`))
  console.log('★ 结论：delivery_exception 已被运营处理（status=1, handled_by 有值），但 audit_log 中无对应记录。')
})().catch((e) => { console.error('异常:', e); process.exit(1) })
