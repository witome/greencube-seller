/**
 * 卡BO（2026-10-02）· 回执查询「窗口黑洞」修复自测（全 dry-run，零话费）
 *
 * 场景：48h 窗口内塞 205 条 SUPPLIER_NOTIFY_CALL 台账 ——
 *   前 200 条 result='connected'（已完结老行，id 更小，按插入顺序自然满足）；
 *   后 5 条 result='initiated' 且带 callId（被老行埋住的新行）。
 * 修复前：updateReceipts 取「最早 200 条」→ 老行占满窗口 → initiated 数到 0（黑洞）。
 * 修复后：查询层 JSON 路径过滤只取未完结行 → initiatedSeen=5。
 *
 * 断言（任务书第四节 6 项；第 6 项回归由 supplier-ack-test.js / supplier-ack-notify-test.js 承担）：
 *   1. 修复前语义复现：旧查询（无 result 过滤、asc、take 200）数到的 initiated = 0
 *   2. scan-once → receipts.initiatedSeen === 5；windowRows === 5（JSON 过滤生效）
 *   3. receipts.updated === 0（dry-run 零写入）且 205 条台账 after 跑前跑后逐位不变
 *   4. scan-once 原有字段键齐全（candidates/called/dryRun/real/skipped）
 *   5. 清理：205 条按 id 精确删除，残留 = 0；platform_config 全表快照逐位不变
 *
 * 用法（backend 目录）：node scripts/bn-receipt-window-test.js
 * 数据安全：台账自造自清（按 id 精确删除 + note 标记双重回读）；
 *           supplier_ack_reminder 键全程零写入（默认 enabled=false 即总刹车，误拨不可能）。
 */
const BASE = process.env.BN_TEST_BASE || 'http://127.0.0.1:3001/api/v1'
const fs = require('fs')
const path = require('path')
try {
  const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  for (const line of envTxt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
} catch (e) {
  console.error('读取 backend/.env 失败：', e.message)
}
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail !== undefined ? `  → 实际：${JSON.stringify(detail)}` : ''}`) }
}

async function api(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  let j = null
  try { j = await res.json() } catch (e) { /* 非 JSON */ }
  return { status: res.status, json: j, data: j?.data, code: j?.code, msg: j?.msg }
}

const CFG_KEY = 'supplier_ack_reminder'
const TS = Date.now()
const TAG = `卡BO自测${TS}`
const COUNT_DONE = 200 // 已完结老行
const COUNT_INI = 5 // 被埋住的未完结新行

async function main() {
  console.log('='.repeat(64))
  console.log(`卡BO · 回执查询窗口黑洞修复自测（${new Date().toISOString()}，全 dry-run）`)
  console.log('='.repeat(64))

  // ════ 0. 环境快照 + 安全检查 ════
  const cfgBefore = await prisma.platformConfig.findUnique({ where: { key: CFG_KEY } })
  if (cfgBefore && cfgBefore.value && cfgBefore.value.enabled !== false) {
    throw new Error('supplier_ack_reminder 当前 enabled=true，为防误拨先中止（本自测要求总刹车在位）')
  }
  const cfgTableBefore = await prisma.platformConfig.findMany({ select: { key: true, value: true } })
  check('环境安全：拨号总刹车在位（键不存在走默认 enabled=false）', !cfgBefore || cfgBefore.value?.enabled === false)

  // ════ 1. 造 205 条台账（顺序插入保证 id 递增）════
  const at = new Date(Date.now() - 5 * 60000) // 早于 90s cutoff、48h 窗口内
  const mkAfter = (result, callId) => ({ orderId: 0, supplierId: 0, mode: 'auto', result, callId: callId ?? null, note: TAG, dryRun: false, at: at.toISOString() })
  const ids = []
  for (let i = 0; i < COUNT_DONE; i++) {
    const row = await prisma.auditLog.create({
      data: { operatorId: 0n, action: 'SUPPLIER_NOTIFY_CALL', entity: 'supplier_notify', entityId: 0, after: mkAfter('connected', null), createdAt: at },
    })
    ids.push(row.id)
  }
  for (let i = 0; i < COUNT_INI; i++) {
    const row = await prisma.auditLog.create({
      data: { operatorId: 0n, action: 'SUPPLIER_NOTIFY_CALL', entity: 'supplier_notify', entityId: 0, after: mkAfter('initiated', `BO-TEST-${TS}-${i}`), createdAt: at },
    })
    ids.push(row.id)
  }
  check(`台账就位：${COUNT_DONE + COUNT_INI} 条（200 connected + 5 initiated），id 前 200 < 后 5`, ids.length === COUNT_DONE + COUNT_INI)

  // 跑前快照（逐条 after JSON）
  const snap = async () => {
    const rows = await prisma.auditLog.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, after: true } })
    return rows.map((r) => JSON.stringify(r.after))
  }
  const beforeSnap = await snap()

  // ════ 2. 修复前语义复现（黑洞证据）════
  const cutoff = new Date(Date.now() - 90 * 1000)
  const windowStart = new Date(Date.now() - 48 * 3600 * 1000)
  const oldRows = await prisma.auditLog.findMany({
    where: { action: 'SUPPLIER_NOTIFY_CALL', createdAt: { lt: cutoff, gte: windowStart } },
    orderBy: { id: 'asc' },
    take: 200,
    select: { after: true },
  })
  const oldSeen = oldRows.filter((r) => r.after?.result === 'initiated' && r.after?.callId).length
  check('修复前语义复现：旧查询取 200 条全是老行，initiated=0（黑洞成立）', oldRows.length === 200 && oldSeen === 0, { fetched: oldRows.length, initiatedSeen: oldSeen })

  // ════ 3. 手动触发 scan-once（修复后）════
  const login = await api('POST', '/auth/wx-login', { code: 'admin' })
  const token = login.data?.token
  check('admin 登录成功', !!token)
  const r = await api('POST', '/admin/supplier-notify/scan-once', {}, token)
  check('scan-once code=0', r.code === 0, r.msg)
  const d = r.data || {}
  const rc = d.receipts || {}
  console.log('  scan-once receipts = ' + JSON.stringify(rc))

  // 断言 4：原有字段键齐全
  check('原有字段键齐全（candidates/called/dryRun/real/skipped）', ['candidates', 'called', 'dryRun', 'real', 'skipped'].every((k) => k in d), Object.keys(d))
  // 断言 2：修复判据
  check('receipts.initiatedSeen === 5（★修复判据，修复前为 0）', rc.initiatedSeen === 5, rc)
  check('receipts.windowRows === 5（查询层 JSON 过滤生效：老行不再挤占窗口）', rc.windowRows === 5, rc)
  check('receipts.queried === 5（dry-run 下适配器返回空对象，尝试查询计入）', rc.queried === 5, rc)
  // 断言 3：零写入
  check('receipts.updated === 0（dry-run 零写入）', rc.updated === 0, rc)
  check('totalOff=true（默认配置刹车在位，全程零拨打）', d.totalOff === true, d.totalOff)

  // 跑后快照逐位比对
  const afterSnap = await snap()
  const unchanged = beforeSnap.length === afterSnap.length && beforeSnap.every((s, i) => s === afterSnap[i])
  check(`${COUNT_DONE + COUNT_INI} 条台账 after 跑前跑后逐位不变（零写入实证）`, unchanged)

  // ════ 4. 清理 + 残留回读 ════
  const del = await prisma.auditLog.deleteMany({ where: { id: { in: ids } } })
  check(`清理：删除 ${COUNT_DONE + COUNT_INI} 条自造台账`, del.count === COUNT_DONE + COUNT_INI, del.count)
  const residual = await prisma.auditLog.count({ where: { id: { in: ids } } })
  check('按 id 回读残留 = 0', residual === 0, residual)
  const residualTag = await prisma.auditLog.count({ where: { action: 'SUPPLIER_NOTIFY_CALL', after: { path: '$.note', equals: TAG } } })
  check('按 note 标记回读残留 = 0', residualTag === 0, residualTag)

  // ════ 5. platform_config 快照比对（本卡全程零写入）════
  const cfgTableAfter = await prisma.platformConfig.findMany({ select: { key: true, value: true } })
  check('platform_config 全表快照逐位不变', JSON.stringify(cfgTableBefore) === JSON.stringify(cfgTableAfter))
  const cfgKeyAfter = await prisma.platformConfig.findUnique({ where: { key: CFG_KEY } })
  check('supplier_ack_reminder 键状态不变（不存在仍不存在，无需还原）', !!cfgBefore === !!cfgKeyAfter)

  // ════ 汇总 ════
  console.log('='.repeat(64))
  console.log(`结果：${pass} 通过 / ${fail} 失败${fail ? '  → 失败项：' + failures.join('；') : ''}`)
  console.log('='.repeat(64))
  process.exitCode = fail ? 1 : 0
}

main()
  .catch((e) => { console.error('自测异常：', e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
