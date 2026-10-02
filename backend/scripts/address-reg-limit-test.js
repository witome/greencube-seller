/**
 * 卡BL（2026-10-02）· 采购方注册「同一收货地址 30 天内最多 3 个联系人」自测
 *
 * 覆盖（任务书第四节 7 项）：
 *   1. 同址第 1、2、3 个不同手机号注册成功（手机号均全新，不触发 3005）
 *   2. 第 4 个被拒：业务码 3010（HTTP 状态实测记录）；库中不产生第 4 条采购方，被拒用户无半成品
 *   3. 归一化生效：去掉空白后同址的写法（「X路 Y 号」vs「X路Y号」）仍被拒
 *   4. 不同地址的第 4 个注册成功
 *   5. 30 天窗口：把第 3 条 registered_at 改成 31 天前 → 同址再注册成功
 *   6. 既有语义未变：同手机号 30 天 2 次 → 3005；手机号被其他 user 占用 → 3009
 *   7. 清理后 purchaser/user 残留 = 0，且**既有采购方行逐位未变**（跑前跑后快照比对）
 *
 * 用法（backend 目录）：node scripts/address-reg-limit-test.js
 * 前置：后端已起（3001，已编译卡BL 代码）且 mock 登录可用（code → dev_<code>）。
 * 数据安全：全部自造（采购方/用户均带本卡时间戳标记），跑完删净；不碰任何既有业务数据。
 */
const BASE = process.env.BL_TEST_BASE || 'http://127.0.0.1:3001/api/v1'
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
const TAG = `卡BL自测${TS}`
// 测试地址（含空格，供归一化断言用）；ADDR_NO_SPACES 是它的去空白变体
const ADDR = `${TAG}路 1 号`
const ADDR_NO_SPACES = `${TAG}路1号`
const ADDR2 = `卡BL异址${TS}号路 2 号`
const PHONE = (prefix) => prefix + String(TS).slice(-8)

const created = { userIds: [], purchaserIds: [] }
/// 注册用的固定字段
const reg = (phone, address) => ({ shopName: TAG + '餐馆', contact: '卡BL', phone, address })

/** 快照：既有采购方逐行序列化（跑前跑后比对，证明一处未变） */
const SNAP_FIELDS = {
  id: true, userId: true, shopName: true, contact: true, phone: true, address: true,
  registeredAt: true, accountStatus: true, businessLicenseNo: true, deliveryWindows: true,
  rejectReasonCode: true, rejectReasonText: true, verifiedAt: true, appealCount30d: true,
}
async function snapshot() {
  const rows = await prisma.purchaser.findMany({ select: SNAP_FIELDS, orderBy: { id: 'asc' } })
  return rows.map((r) => JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? String(v) : v)))
}

async function main() {
  console.log('='.repeat(64))
  console.log('卡BL · 同址 30 天最多 3 个联系人 自测（' + new Date().toISOString() + '）')
  console.log('='.repeat(64))

  const beforeSnap = await snapshot()
  console.log(`\n【0】既有采购方快照 ${beforeSnap.length} 行（跑后逐位比对）`)

  const login = async (code) => {
    const r = await api('POST', '/auth/wx-login', { code })
    if (r.code !== 0) throw new Error(`登录失败(${code})：${JSON.stringify(r.json)}`)
    created.userIds.push(BigInt(r.data.userId))
    return r.data.token
  }
  const register = async (code, body) => {
    const token = await login(code)
    return api('POST', '/buyer/register', body, token)
  }

  // ════ 1. 同址 3 个不同手机号注册成功 ════
  console.log('\n【1】同址第 1/2/3 个不同手机号注册 → 成功（手机号全新，不触发 3005）')
  const phones = [PHONE('138'), PHONE('137'), PHONE('136')]
  const ids = []
  for (let i = 0; i < 3; i++) {
    const r = await register(`bl_${TS}_${i + 1}`, reg(phones[i], ADDR))
    check(`1.${i + 1} 第 ${i + 1} 个（${phones[i]}）注册 code=0`, r.code === 0, { status: r.status, code: r.code, msg: r.msg })
    if (r.data?.purchaserId) { ids.push(BigInt(r.data.purchaserId)); created.purchaserIds.push(BigInt(r.data.purchaserId)) }
  }

  // ════ 2. 第 4 个被拒（3010）+ 无半成品 ════
  console.log('\n【2】同址第 4 个 → 业务码 3010；库中无第 4 条采购方')
  const r4 = await register(`bl_${TS}_4`, reg(PHONE('135'), ADDR))
  console.log(`  实测：HTTP ${r4.status} | code=${r4.code} | msg=${JSON.stringify(r4.msg)}`)
  check('2a 第 4 个被拒（code=3010 ADDRESS_CONTACT_TOO_MANY）', r4.code === 3010, { status: r4.status, code: r4.code, msg: r4.msg })
  check('2b HTTP 状态码（实测，BizException → 200 信封）', r4.status === 200, r4.status)
  const addrCnt = await prisma.purchaser.count({ where: { address: ADDR } })
  check('2c 库中该地址采购方仍 = 3（无第 4 条/半成品）', addrCnt === 3, addrCnt)
  const u4 = await prisma.user.findUnique({ where: { wxOpenid: `dev_bl_${TS}_4` } })
  check('2d 被拒用户未写入手机号、未关联采购方', u4 && u4.phone === null, { phone: u4?.phone })

  // ════ 3. 归一化生效 ════
  console.log('\n【3】归一化：去空白后同址（含全角空格写法）仍被拒')
  const r5 = await register(`bl_${TS}_5`, reg(PHONE('134'), ADDR_NO_SPACES))
  check('3a 「X路Y号」（无空格）仍被拒 code=3010', r5.code === 3010, { code: r5.code, msg: r5.msg })
  const r5b = await register(`bl_${TS}_5b`, reg(PHONE('132'), `${TAG}路\u30001\u3000号`))
  check('3b 全角空格写法仍被拒 code=3010', r5b.code === 3010, { code: r5b.code, msg: r5b.msg })
  // 3 用掉的两个登录用户（132/134）计入清理
  const addrCnt2 = await prisma.purchaser.count({ where: { address: ADDR } })
  check('3c 库中该地址采购方仍 = 3', addrCnt2 === 3, addrCnt2)

  // ════ 4. 不同地址不受影响 ════
  console.log('\n【4】换地址的第 4 个注册 → 成功')
  const r6 = await register(`bl_${TS}_6`, reg(PHONE('133'), ADDR2))
  check('4a 不同地址注册 code=0', r6.code === 0, { code: r6.code, msg: r6.msg })
  if (r6.data?.purchaserId) created.purchaserIds.push(BigInt(r6.data.purchaserId))
  const phone133User = created.userIds[created.userIds.length - 1] // 供 6b 用

  // ════ 5. 30 天窗口 ════
  console.log('\n【5】把第 3 条 registered_at 改成 31 天前 → 同址再注册成功')
  await prisma.purchaser.update({ where: { id: ids[2] }, data: { registeredAt: new Date(Date.now() - 31 * 86400000) } })
  const r7 = await register(`bl_${TS}_7`, reg(PHONE('131'), ADDR))
  check('5a 出窗后同址再注册 code=0（窗口真的在起作用）', r7.code === 0, { code: r7.code, msg: r7.msg })
  if (r7.data?.purchaserId) created.purchaserIds.push(BigInt(r7.data.purchaserId))

  // ════ 6. 既有语义未变 ════
  console.log('\n【6】既有校验语义未变（3005 / 3009）')
  // 6a 手机号 30 天 2 次：直接落 2 条同手机号采购方（不经过注册接口，绕开 user.phone 唯一），再走接口 → 3005
  const dupPhone = PHONE('130')
  for (const suffix of ['a', 'b']) {
    const u = await prisma.user.create({ data: { wxOpenid: `dev_blfix_${TS}_${suffix}`, name: TAG + '夹具', roles: [], status: 1 } })
    created.userIds.push(u.id)
    const p = await prisma.purchaser.create({
      data: { userId: u.id, shopName: TAG + '夹具', contact: '卡BL', phone: dupPhone, address: TAG + '夹具地址', deliveryWindows: ['中 10-13'], accountStatus: 2 },
    })
    created.purchaserIds.push(p.id)
  }
  const r3005 = await register(`bl_${TS}_8`, reg(dupPhone, TAG + '另一地址'))
  check('6a 同手机号窗口内第 3 次 → code=3005（PHONE_REGIST_TOO_OFTEN）', r3005.code === 3005, { status: r3005.status, code: r3005.code, msg: r3005.msg })
  // 6b 手机号被其他 user 占用 → 3009（133 是 4a 注册用户的手机号）
  const r3009 = await register(`bl_${TS}_9`, reg(PHONE('133'), TAG + '再一地址'))
  check('6b 手机号已被其他账号使用 → code=3009（PHONE_ALREADY_USED）', r3009.code === 3009, { status: r3009.status, code: r3009.code, msg: r3009.msg })

  // ════ 清理 + 快照比对 ════
  console.log('\n【清理】删除自造数据，断言残留=0；既有采购方快照逐位比对')
  await prisma.purchaser.deleteMany({ where: { id: { in: created.purchaserIds } } })
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })
  const rP = await prisma.purchaser.count({ where: { shopName: { contains: TAG } } })
  const rU = await prisma.user.count({ where: { wxOpenid: { contains: `_${TS}` } } })
  check('清理后 采购方残留 = 0', rP === 0, rP)
  check('清理后 用户残留 = 0', rU === 0, rU)

  const afterSnap = await snapshot()
  // 既有行 = 快照总行数一致 + 内容逐位一致（本卡自造行已删，行数应回到 before）
  check(`既有采购方快照逐位一致（${beforeSnap.length} 行）`,
    beforeSnap.length === afterSnap.length && beforeSnap.every((s, i) => s === afterSnap[i]),
    { before: beforeSnap.length, after: afterSnap.length })

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
