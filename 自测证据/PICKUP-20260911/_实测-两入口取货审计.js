/**
 * 实测：courier 两个取货入口的审计留痕
 * 入口A（任务级）：POST /courier/task/:taskId/pickup → service.pickup()
 * 入口B（订单级）：POST /courier/order/:orderId/pickup → service.pickupOrder()（本卡新补）
 * 前置：经 admin 派单为订单 216 / 218 各创建一个任务（courier_id=1）
 */
const { execFileSync } = require('child_process')
const path = require('path')

const BASE = 'http://127.0.0.1:3001/api/v1'
const MYSQL = 'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe'
const DB_ARGS = ['-ulvlifang_app', '-pAKC4VYr3mGVZ66QuUXOMKXKokc2gOjH8', '-h127.0.0.1', '-P3306', '--default-character-set=utf8mb4', 'lvlifang']

function scalar(sql) {
  // 标量查询必须 --batch --skip-column-names（--table 会覆盖 --batch 致解析错）
  const out = execFileSync(MYSQL, [...DB_ARGS, '--batch', '--skip-column-names', '-e', sql], { encoding: 'utf8' })
  return String(out).trim()
}
function table(sql) {
  const out = execFileSync(MYSQL, [...DB_ARGS, '--table', '-e', sql], { encoding: 'utf8' })
  return String(out).split('\n').filter((l) => !/Warning|password/i.test(l)).join('\n')
}

async function call(method, url, body, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { _raw: text.slice(0, 300) } }
  return { http: res.status, ...json }
}

function mask(o) {
  // 打印前掩码：token/authorization 字段只留前 6 位
  const s = JSON.stringify(o)
  return s.replace(/("(?:token|Authorization|authorization)"\s*:\s*")([^"]{6})[^"]*/g, '$1$2***')
}

;(async () => {
  let fail = 0
  const chk = (name, ok, extra) => {
    console.log((ok ? '✅ ' : '❌ ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''))
    if (!ok) fail++
  }

  const admin = await call('POST', '/auth/wx-login', { code: 'admin' })
  console.log('admin 登录原始返回(掩码):', mask(admin).slice(0, 400))
  const at = admin.data?.token
  chk('admin 登录', !!at, { userId: admin.data?.userId, currentRole: admin.data?.currentRole })
  const courier = await call('POST', '/auth/wx-login', { code: 'courier' })
  console.log('courier 登录原始返回(掩码):', mask(courier).slice(0, 400))
  const ct = courier.data?.token
  chk('courier 登录', !!ct, { userId: courier.data?.userId, currentRole: courier.data?.currentRole })

  const m0 = Number(scalar('SELECT IFNULL(MAX(id),0) FROM audit_log;'))
  console.log('audit_log 基线 max(id) =', m0)

  // ══════ 入口A（任务级）：订单216 → 派单 → task pickup ══════
  console.log('\n──────── 入口A：POST /courier/task/:taskId/pickup（任务级）────────')
  const st216 = Number(scalar('SELECT status FROM `order` WHERE id=216;'))
  console.log('订单 216 派单前 status =', st216)
  const assignA = await call('POST', '/admin/dispatch', { courierId: 1, orderIds: [216] }, at)
  console.log('POST /admin/dispatch {courierId:1, orderIds:[216]} →', mask(assignA))
  const taskIdA = assignA.data?.taskId ?? assignA.taskId
  chk('入口A 派单成功（拿到 taskId）', !!taskIdA, { taskIdA })

  const m1 = Number(scalar('SELECT IFNULL(MAX(id),0) FROM audit_log;'))
  const resA = await call('POST', `/courier/task/${taskIdA}/pickup`, null, ct)
  const m2 = Number(scalar('SELECT IFNULL(MAX(id),0) FROM audit_log;'))
  console.log(`POST /courier/task/${taskIdA}/pickup →`, JSON.stringify(resA), `  audit max(id): ${m1} → ${m2}`)
  chk('入口A 接口成功', resA.http === 200 || resA.http === 201, { code: resA.code, msg: resA.msg })
  const rowsA = scalar(`SELECT GROUP_CONCAT(CONCAT(id,':',action,':',entity,':',entity_id)) FROM audit_log WHERE id > ${m1};`)
  chk('入口A 落审计 COURIER_PICKUP(entity=delivery_task)', /COURIER_PICKUP:delivery_task/.test(rowsA), { rowsA })

  // ══════ 入口B（订单级）：订单218 → 派单 → order pickup ══════
  console.log('\n──────── 入口B：POST /courier/order/:orderId/pickup（订单级，本卡补）────────')
  const st218 = Number(scalar('SELECT status FROM `order` WHERE id=218;'))
  console.log('订单 218 派单前 status =', st218)
  const assignB = await call('POST', '/admin/dispatch', { courierId: 1, orderIds: [218] }, at)
  console.log('POST /admin/dispatch {courierId:1, orderIds:[218]} →', mask(assignB))
  const taskIdB = assignB.data?.taskId ?? assignB.taskId
  chk('入口B 派单成功（拿到 taskId）', !!taskIdB, { taskIdB })

  const m3 = Number(scalar('SELECT IFNULL(MAX(id),0) FROM audit_log;'))
  const resB = await call('POST', `/courier/order/218/pickup`, null, ct)
  const m4 = Number(scalar('SELECT IFNULL(MAX(id),0) FROM audit_log;'))
  console.log(`POST /courier/order/218/pickup →`, JSON.stringify(resB), `  audit max(id): ${m3} → ${m4}`)
  chk('入口B 接口成功', resB.http === 200 || resB.http === 201, { code: resB.code, msg: resB.msg })
  chk('入口B 落审计（max(id) 增长）', m4 > m3, { m3, m4 })
  chk('入口B action = COURIER_PICKUP（沿用同名）', scalar(`SELECT action FROM audit_log WHERE id=${m4};`) === 'COURIER_PICKUP')
  chk('入口B entity = order（与任务级区分入口）', scalar(`SELECT entity FROM audit_log WHERE id=${m4};`) === 'order')

  // ══════ 审计行明细（真实 SQL 输出）══════
  console.log('\n══════════ 两入口审计行明细（本卡新增）══════════')
  const q = `SELECT id, operator_id, action, entity, entity_id,\`before\`,\`after\` FROM audit_log WHERE id > ${m0} AND action='COURIER_PICKUP' ORDER BY id;`
  console.log('SQL> ' + q)
  console.log(table(q))

  console.log(fail === 0 ? '\n全部通过 ✅' : `\n${fail} 项失败 ❌`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('脚本异常:', e.message)
  process.exit(1)
})
