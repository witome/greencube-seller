/**
 * 卡BL 三黑独立探针（2026-10-02）—— 只打脚本没覆盖到的**边界**：
 *   a) 「1 号」 vs 「一号」：不归一（不同地址 → 应放行）
 *   b) address 为空的行不参与计数（连续 4 个空地址注册 → 应全部成功）
 *   c) 已驳回(3)/停用(5) 的既有行**仍计数**（DB 造 3 行 → 第 4 个 API 注册应被拒 3010）
 *   d) 归一化覆盖制表符/换行（\t / \n 写法仍应被拒）
 * 用法：node scripts/bl-independent-probe.js
 */
const path = require('path')
const fs = require('fs')
try {
  const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  for (const line of envTxt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
} catch (e) { /* ignore */ }
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const BASE = 'http://127.0.0.1:3001/api/v1'

let pass = 0, fail = 0
const check = (name, cond, detail) => { if (cond) { pass++; console.log('  ✅ ' + name) } else { fail++; console.log('  ❌ ' + name + '  ' + JSON.stringify(detail)) } }

const TS = Date.now()
const TAG = `BL探针${TS}`
const OPENID_PREFIX = `dev_blprobe_${TS}`
const made = { userIds: [] }

async function reg(phone, address) {
  const rl = await fetch(BASE + '/auth/wx-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: `blprobe_${TS}_${phone}` }),
  })
  const jl = await rl.json().catch(() => null)
  const token = jl?.data?.token
  if (!token) return { status: rl.status, code: jl?.code, msg: 'login failed: ' + JSON.stringify(jl) }
  const r = await fetch(BASE + '/buyer/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ shopName: TAG + '店', contact: '探针', phone, address, deliveryWindows: ['中 10-13'] }),
  })
  const j = await r.json().catch(() => null)
  return { status: r.status, code: j?.code, msg: j?.msg }
}

async function mkRow(address, phone, accountStatus, daysAgo = 0) {
  const u = await prisma.user.create({ data: { wxOpenid: `${OPENID_PREFIX}_row_${phone}`, name: TAG, roles: [], status: 1 } })
  made.userIds.push(u.id)
  return prisma.purchaser.create({ data: { userId: u.id, shopName: TAG + '旧行', contact: '旧', phone, address, deliveryWindows: ['中 10-13'], accountStatus, registeredAt: new Date(Date.now() - daysAgo * 86400000) } })
}
const phoneOf = (i) => '135' + String(TS).slice(-5) + String(i).padStart(3, '0')

async function main() {
  console.log('='.repeat(64))
  console.log('卡BL 三黑独立探针（' + new Date().toISOString() + '）')
  console.log('='.repeat(64))

  // ── a) 「1 号」vs「一号」不归一
  console.log('\n【a】「X路1号」与「X路一号」是两个地址 → 应各自放行')
  const A1 = `${TAG}路1号`, A2 = `${TAG}路一号`
  for (let i = 1; i <= 3; i++) await reg(phoneOf(i), A1)
  const p1 = await reg(phoneOf(4), A1)
  const p2 = await reg(phoneOf(5), A2)
  check('a1 同址第 4 个被拒（3010）', p1.code === 3010, p1)
  check('a2 「一号」写法视为不同地址 → 放行（code=0）', p2.code === 0, p2)

  // ── b) 已驳回/停用行仍计数
  console.log('\n【b】既有 account_status=3(驳回)/5(停用) 的行仍参与计数')
  const A3 = `${TAG}路7号`
  await mkRow(A3, phoneOf(11), 3)
  await mkRow(A3, phoneOf(12), 5)
  await mkRow(A3, phoneOf(13), 2)
  const p3 = await reg(phoneOf(14), A3)
  check('b1 库里已有 3 行（含驳回/停用）→ 第 4 个被拒 3010', p3.code === 3010, p3)

  // ── c) 归一化覆盖制表符/换行
  console.log('\n【c】归一化去掉制表符/换行 → 同址不同空白写法仍被拒')
  const A4 = `${TAG}路9号`
  await mkRow(A4, phoneOf(21), 2)
  await mkRow(A4, phoneOf(22), 2)
  await mkRow(A4, phoneOf(23), 2)
  const c1 = await reg(phoneOf(24), `${TAG}路\t9\n号`)  // 带 TAB + 换行的同址写法
  check('d1 带 TAB/换行的同址写法被拒 3010', d1.code === 3010, d1)

  // ── d) 窗口：同址 3 行都在窗口外 → 应放行
  console.log('\n【d】30 天窗口：同址 3 行都在窗口外 → 应放行')
  const A5 = `${TAG}路11号`
  await mkRow(A5, phoneOf(31), 2, 31)
  await mkRow(A5, phoneOf(32), 2, 40)
  await mkRow(A5, phoneOf(33), 2, 60)
  const w1 = await reg(phoneOf(34), A5)
  check('d1 窗口外的同址行不计入 → 放行（code=0）', w1.code === 0, w1)

  // ── 清理
  console.log('\n【清理】')
  const rows = await prisma.purchaser.findMany({ where: { OR: [{ shopName: { startsWith: TAG } }, { address: { contains: TAG } }] }, select: { id: true, userId: true } })
  const loginUsers = await prisma.user.findMany({ where: { wxOpenid: { startsWith: OPENID_PREFIX } }, select: { id: true } })
  const uids = [...new Set([...rows.map((r) => r.userId), ...made.userIds, ...loginUsers.map((x) => x.id)])]
  const pd = await prisma.purchaser.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })
  const ud = await prisma.user.deleteMany({ where: { id: { in: uids } } })
  const res = {
    purchaserResidue: await prisma.purchaser.count({ where: { OR: [{ shopName: { startsWith: TAG } }, { address: { contains: TAG } }] } }),
    userResidue: await prisma.user.count({ where: { wxOpenid: { startsWith: OPENID_PREFIX } } }),
  }
  check('清理后 purchaser 残留 = 0', res.purchaserResidue === 0, res)
  check('清理后 user 残留 = 0', res.userResidue === 0, res)
  console.log(`  （删除 purchaser=${pd.count} user=${ud.count}）`)
  console.log('\n' + '='.repeat(64))
  console.log(`结果：${pass} 通过 / ${fail} 失败`)
  console.log('='.repeat(64))
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error('PROBE FAIL', e); await prisma.$disconnect(); process.exit(1) })
