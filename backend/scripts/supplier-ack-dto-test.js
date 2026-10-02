/**
 * 卡BM（2026-10-02）· 接单接口入参校验 自测
 *
 * 背景：此前 POST /supplier-fulfill/ack 的 @Body 是裸类型 { orderId: number }，
 *       非法入参在 BigInt(dto.orderId) 处抛 500。补 AckDto（IsInt）后交全局
 *       ValidationPipe（whitelist + transform，未开 enableImplicitConversion）拦截。
 *
 * 覆盖（卡BM 任务书第四节 1~3 + 报告要求「4 条非法入参」）：
 *   1. {"orderId":"abc"}   → 期望 HTTP 400（实测为准，记录 code/msg）
 *   2. {}                  → 期望 HTTP 400（缺 orderId）
 *   3. {"orderId":1.5}     → 期望 HTTP 400（IsInt 该拦）
 *   4. {"orderId":"123"}   → 期望 HTTP 400（字符串数字，Pipe 未开隐式转换）
 *   5. 合法路径回归：卡BJ 自测脚本 node scripts/supplier-ack-test.js → 须 24/0（单独跑）
 *   6. 服务端无 500 堆栈（后端日志另行取证）
 *
 * 数据安全：只造 1 个供应商（user + supplier）用于过 @Roles(Role.SUPPLIER) 守卫，
 *           非法入参不会触达业务逻辑；跑完删除，报告「残留=0」。
 * 用法（backend 目录）：node scripts/supplier-ack-dto-test.js
 */
const BASE = process.env.BM_TEST_BASE || 'http://127.0.0.1:3001/api/v1'
const fs = require('fs')
const path = require('path')
// 与仓库其它脚本一致：自己加载 backend/.env（Prisma 不自动读）
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

const TS = Date.now()
const TAG = `卡BM自测${TS}`
const created = { userIds: [], supplierIds: [] }

async function main() {
  console.log('='.repeat(64))
  console.log('卡BM · 接单接口入参校验 自测（' + new Date().toISOString() + '）')
  console.log('='.repeat(64))

  // ════ 0. fixture：自造 1 个供应商（只为了过角色守卫，非法入参不触达业务逻辑）════
  const u = await prisma.user.create({ data: { wxOpenid: `dev_bmsup_${TS}`, name: TAG + '档口', roles: [], status: 1 } })
  created.userIds.push(u.id)
  const s = await prisma.supplier.create({ data: { userId: u.id, stallName: TAG + '档口', address: TAG, status: 1, qualification: {} } })
  created.supplierIds.push(s.id)
  const login = await api('POST', '/auth/wx-login', { code: `bmsup_${TS}` })
  check('供应商测试账号登录成功', login.code === 0 && !!login.data?.token, { code: login.code })
  const token = login.data?.token

  // ════ 1~4. 四条非法入参 ════
  // 期望：HTTP 400（ValidationPipe → BadRequestException）；业务码/msg 由 HttpExceptionFilter 决定，实测记录。
  const cases = [
    { name: '1 orderId 为字符串 "abc"', body: { orderId: 'abc' } },
    { name: '2 缺 orderId（空对象）', body: {} },
    { name: '3 orderId 为小数 1.5', body: { orderId: 1.5 } },
    { name: '4 orderId 为字符串数字 "123"', body: { orderId: '123' } },
  ]
  for (const c of cases) {
    console.log(`\n【${c.name}】POST /supplier-fulfill/ack body=${JSON.stringify(c.body)}`)
    const r = await api('POST', '/supplier-fulfill/ack', c.body, token)
    console.log(`  实测：HTTP ${r.status} | code=${r.code} | msg=${JSON.stringify(r.msg)} | data=${JSON.stringify(r.data)}`)
    check(`${c.name} → HTTP 400（不再 500）`, r.status === 400, r.status)
    check(`${c.name} → 业务 code 非 0 且非 5001（不是「服务异常」兜底）`, typeof r.code === 'number' && r.code !== 0 && r.code !== 5001, r.code)
  }

  // ════ 5. 库零副作用：非法入参不产生任何 ack 行 / 订单 ════
  console.log('\n【5】库零副作用')
  const ackCnt = await prisma.orderSupplierAck.count({ where: { supplierId: s.id } })
  check('该供应商名下无任何接单行', ackCnt === 0, ackCnt)

  // ════ 清理 ════
  console.log('\n【清理】删除自造供应商/用户，断言残留=0')
  await prisma.supplier.deleteMany({ where: { id: { in: created.supplierIds } } })
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })
  const residualSuppliers = await prisma.supplier.count({ where: { stallName: { contains: TAG } } })
  const residualUsers = await prisma.user.count({ where: { wxOpenid: { contains: `dev_bmsup_${TS}` } } })
  check('清理后 供应商残留 = 0', residualSuppliers === 0, residualSuppliers)
  check('清理后 用户残留 = 0', residualUsers === 0, residualUsers)

  console.log('\n' + '='.repeat(64))
  console.log(`结果：${pass} 通过 / ${fail} 失败`)
  if (failures.length) {
    console.log('失败项：')
    for (const f of failures) console.log('  - ' + f)
  }
  console.log('='.repeat(64))
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('脚本异常：', e)
  try { await prisma.$disconnect() } catch (_) {}
  process.exit(1)
})
