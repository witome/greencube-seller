/**
 * 审计留痕实测交叉验证
 * 真跑 5 个关键写接口 → 直查 audit_log 表（真实 SQL）
 * 运行：cd backend && node ../自测证据/AUDIT-20260911/_审计-05-实测交叉验证.js
 */
const { execFileSync } = require('child_process')

const BASE = 'http://127.0.0.1:3001/api/v1'
const MYSQL = 'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe'
const DBARGS = ['-ulvlifang_app', '-pAKC4VYr3mGVZ66QuUXOMKXKokc2gOjH8', '-h127.0.0.1', '-P3306', 'lvlifang', '--table']
const DBNAME = 'lvlifang'

function sql(q) {
  const out = execFileSync(MYSQL, [...DBARGS, '-e', q], { encoding: 'utf8' })
  return out.replace(/mysql: \[Warning\][^\n]*\n/g, '').replace(/Using a password[^\n]*\n/g, '')
}

/** 标量查询：独立参数（不能带 --table，否则 --batch 被覆盖）*/
function scalar(q) {
  const args = ['-ulvlifang_app', '-pAKC4VYr3mGVZ66QuUXOMKXKokc2gOjH8', '-h127.0.0.1', '-P3306', DBNAME, '--batch', '--skip-column-names', '-e', q]
  const out = execFileSync(MYSQL, args, { encoding: 'utf8' })
  const m = out.match(/\d+/)
  return m ? Number(m[0]) : NaN
}

async function call(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  try { return JSON.parse(text) } catch (e) { return { _http: r.status, _raw: text.slice(0, 200) } }
}

const results = []
function step(no, title, req, resp, auditWhere) {
  results.push({ no, title, req, resp, auditWhere })
}

;(async () => {
  console.log('══════════ 审计留痕实测交叉验证 ══════════')
  console.log('时间:', new Date().toISOString())

  // ── 登录 ──
  const login = await call('POST', '/auth/wx-login', { code: 'admin' })
  const at = login.data.token
  const me = login.data.user
  console.log('运营登录: code=' + login.code + ' userId=' + (me?.userId) + ' role=' + (me?.currentRole))

  const before = sql(`SELECT COUNT(*) AS n FROM audit_log`)
  console.log('\n实测前 audit_log 总行数:')
  console.log(before.trim())

  const baseMax = scalar(`SELECT IFNULL(MAX(id),0) FROM audit_log;`)
  console.log('实测前最大 audit_log.id =', baseMax)

  // ══ 1. 改拆单 RE_SPLIT（订单 212 / status=30）══
  console.log('\n──────── ① 改拆单（RE_SPLIT）────────')
  const preview = await call('GET', '/admin/order/212/split-preview', null, at)
  const payload = {
    items: (preview.data || []).map((p) => ({
      productId: p.productId,
      allocations: (p.allocations || []).map((a) => ({ supplierId: a.supplierId, qty: a.qty })),
    })),
  }
  console.log('GET  /admin/order/212/split-preview →', JSON.stringify(preview.data))
  const r1 = await call('POST', '/admin/order/212/split', payload, at)
  console.log('POST /admin/order/212/split  body=' + JSON.stringify(payload))
  console.log('  →', JSON.stringify(r1))

  // ══ 2. 设置供货优先级 ══
  console.log('\n──────── ② 设置供货优先级（SET_SUPPLY_PRIORITY）────────')
  const r2 = await call('PUT', '/admin/goods/1/priority', { items: [{ supplierId: 1, priority: 1 }, { supplierId: 2, priority: 2 }] }, at)
  console.log('PUT  /admin/goods/1/priority  body={"items":[{"supplierId":1,"priority":1},{"supplierId":2,"priority":2}]}')
  console.log('  →', JSON.stringify(r2))

  // ══ 3. 服务费配置 ══
  console.log('\n──────── ③ 服务费配置（UPDATE_SERVICE_FEE）────────')
  const r3 = await call('PUT', '/admin/finance/service-fee', { rate: 0.05 }, at)
  console.log('PUT  /admin/finance/service-fee  body={"rate":0.05}')
  console.log('  →', JSON.stringify(r3))

  // ══ 4. 生成结算单 ══
  console.log('\n──────── ④ 生成结算单（GENERATE_SETTLEMENT）────────')
  const r4 = await call('POST', '/admin/finance/generate', { period: '2026-09' }, at)
  console.log('POST /admin/finance/generate  body={"period":"2026-09"}')
  console.log('  →', JSON.stringify(r4))

  // ══ 5. 售后处理 ══
  console.log('\n──────── ⑤ 售后处理（AFTERSALE_HANDLE）────────')
  const afId = scalar(`SELECT id FROM aftersale_order WHERE status=0 ORDER BY id ASC LIMIT 1;`)
  console.log('取一张待处理工单 id =', afId)
  const r5 = await call('POST', `/admin/aftersale/${afId}/handle`, { action: 'compensate', compensateAmount: 1.38, compensateMethod: 3, handleRemark: '审计复核实测-补偿' }, at)
  console.log(`POST /admin/aftersale/${afId}/handle  body={"action":"compensate","compensateAmount":1.38,"compensateMethod":3,...}`)
  console.log('  →', JSON.stringify(r5))

  // ══ 6. 【对照】无审计的接口：处理异常工单（缺口实证）══
  console.log('\n──────── ⑥ 【对照·缺口实证】处理异常工单（预期：无审计写入）────────')
  const excList = await call('GET', '/admin/dispatch/exceptions', null, at)
  const excRows = Array.isArray(excList.data) ? excList.data : (excList.data?.list || [])
  const pending = excRows.find((e) => e.status === 0)
  if (pending) {
    const beforeExc = scalar(`SELECT IFNULL(MAX(id),0) FROM audit_log;`)
    const re = await call('PUT', `/admin/dispatch/exceptions/${pending.exceptionId}`, null, at)
    console.log(`PUT  /admin/dispatch/exceptions/${pending.exceptionId} →`, JSON.stringify(re))
    const afterExc = scalar(`SELECT IFNULL(MAX(id),0) FROM audit_log;`)
    console.log(`  audit_log max(id): ${beforeExc} → ${afterExc}  ${afterExc === beforeExc ? '★ 无新增记录 = 缺口实证' : '有新增'}`)
  } else {
    console.log('  （库内无 status=0 的异常工单，跳过实测，仅代码层判定）')
  }

  // ══ 真实 SQL 查询：本次新增的审计记录 ══
  console.log('\n══════════ 真实 SQL 查询结果 ══════════')
  const sqlText = `SELECT id, operator_id, action, entity, entity_id, LEFT(IFNULL(after,'-'),58) AS after_snip, created_at FROM audit_log WHERE id > ${baseMax} ORDER BY id ASC;`
  console.log('SQL> ' + sqlText)
  console.log(sql(sqlText))

  const sql2 = `SELECT action, COUNT(*) AS cnt FROM audit_log WHERE id > ${baseMax} GROUP BY action ORDER BY cnt DESC;`
  console.log('SQL> ' + sql2)
  console.log(sql(sql2))

  const sql3 = `SELECT COUNT(*) AS audit_total_all FROM audit_log;`
  console.log('SQL> ' + sql3)
  console.log(sql(sql3))
})().catch((e) => { console.error('实测异常:', e); process.exit(1) })
