/**
 * 卡C 取证：`service_fee_config` 写入路径的 UTC 一致性
 *
 * 背景：`admin-finance.service.ts` 用原生 SQL upsert 写 `updated_at = NOW(3)`。
 *   MySQL 会话时区是 SYSTEM(+08)，而 Prisma 读写 DATETIME 按 **UTC** 解释
 *   → 用 NOW(3) 写进去的值被当 UTC 读，**整列偏 8 小时**。
 *
 * 本脚本做两件事：
 *   ① 关键数字不变：`GET /admin/finance/service-fee` 的费率 + 用**同一个费率** PUT 后的返回，
 *      改动前后必须一模一样（证明只动了时间戳写法，没动业务口径）
 *   ② 时间戳一致性：`updated_at` 与 `UTC_TIMESTAMP(3)` 的分钟差
 *      改动前应约 **+480 分钟（+8 小时）**，改动后应约 **0**
 *
 * 跑法：cd backend && node scripts/service-fee-utc-check.js before|after
 */
const fs = require('fs')
const path = require('path')

const BACKEND = path.join(__dirname, '..')
try {
  const envTxt = fs.readFileSync(path.join(BACKEND, '.env'), 'utf8')
  for (const line of envTxt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
} catch (e) {
  /* ignore */
}
const { PrismaClient } = require(path.join(BACKEND, 'node_modules', '@prisma', 'client'))
const prisma = new PrismaClient()

const BASE = 'http://127.0.0.1:3001/api/v1'
const label = process.argv[2] || 'unknown'

async function call(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

;(async () => {
  console.log('='.repeat(64))
  console.log(`卡C 取证 · ${label}`)
  console.log('='.repeat(64))

  const admin = await call('POST', '/auth/wx-login', { code: 'admin' })
  const at = admin.data.token

  const before = await call('GET', '/admin/finance/service-fee', null, at)
  const rowsBefore = before.data && (before.data.list || before.data)
  const globalRow = (Array.isArray(rowsBefore) ? rowsBefore : []).find((r) => r.categoryId == null) || (Array.isArray(rowsBefore) ? rowsBefore[0] : null)
  const rate = globalRow ? globalRow.rate : 0.05
  console.log('\n① GET /admin/finance/service-fee')
  console.log('   ' + JSON.stringify(rowsBefore))

  // 用**同一个费率**再写一次（关键数字不变的前提：只改时间戳写法）
  const put = await call('PUT', '/admin/finance/service-fee', { rate }, at)
  console.log(`\n② PUT /admin/finance/service-fee {rate: ${rate}}`)
  console.log('   ' + JSON.stringify(put.data))

  const after = await call('GET', '/admin/finance/service-fee', null, at)
  const rowsAfter = after.data && (after.data.list || after.data)
  console.log('\n③ 再 GET 一次')
  console.log('   ' + JSON.stringify(rowsAfter))
  console.log('\n   ⇒ 费率是否完全一致: ' + (JSON.stringify(rowsBefore) === JSON.stringify(rowsAfter) ? '✅ 一致' : '❌ 不一致'))

  const sql = await prisma.$queryRawUnsafe(
    'SELECT id, category_id, CAST(rate AS CHAR) AS rate, updated_by, ' +
      'DATE_FORMAT(updated_at, "%Y-%m-%d %H:%i:%s") AS updated_at, ' +
      'DATE_FORMAT(UTC_TIMESTAMP(3), "%Y-%m-%d %H:%i:%s") AS utc_now, ' +
      'TIMESTAMPDIFF(MINUTE, updated_at, UTC_TIMESTAMP(3)) AS diff_min ' +
      'FROM service_fee_config ORDER BY id',
  )
  console.log('\n④ 库里 service_fee_config 落库时间与时区一致性')
  sql.forEach((r) =>
    console.log(
      `   id=${r.id} category_id=${r.category_id} rate=${r.rate} updated_at=${r.updated_at} utc_now=${r.utc_now} → 差 ${r.diff_min} 分钟`,
    ),
  )
  const maxAbs = Math.max(...sql.map((r) => Math.abs(Number(r.diff_min))))
  console.log(`\n   最大绝对偏差 = ${maxAbs} 分钟（改动前应≈480 = 8 小时；改动后应≈0）`)

  await prisma.$disconnect()
})().catch(async (e) => {
  console.error('脚本异常：', e)
  try {
    await prisma.$disconnect()
  } catch (x) {
    /* ignore */
  }
  process.exit(1)
})
