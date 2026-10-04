/**
 * 卡BP-1（2026-10-04）· 未接单催办改走「手机专线网关」自测
 *
 * 打印验收卡的 10 条实测值（HTTP 码 / 字段值 / 数组长度）：
 *   1. 不带 x-gateway-token 打 pending-dial → 被拒（有令牌服务上实测 401）
 *   2. 令牌错误 → 被拒（401）
 *   3. SUPPLIER_NOTIFY_GATEWAY_TOKEN 为空 → 三接口一律被拒（403）
 *   4. 令牌正确 + enabled=true + channel='phone' → 返回数组（自造候选，回显明文号码/铃时/挂断秒数）
 *      + 台账只记 maskPhone 脱敏号码
 *   5. 同一候选连续拉两次 → 第二次不再出现（派发即计数、不重复派）
 *   6. 打一次 heartbeat → GET /admin/supplier-notify/config 里 gateway.online === true
 *   7. channel='off' → pending-dial 返回空数组
 *   8. ringSeconds=0 / =99 → 400；=1 / =30 → 通过
 *   9. channel='aliyun' → 回到 dialTts 路径（dry-run 记 result='dry_run'），旧通道没被改坏
 *  10. 仓库基线 node 验收测试.js（打 3001，需 3001 已用新构建启动）：失败集合不得比改前多出新项
 *
 * 服务实例说明：3001 的令牌是「安全默认空值」，没法同时满足第 3 条（空=全拒）和第 4-9 条（有令牌），
 * 所以本脚本自己拉起临时实例（PORT=3011，dist 构建）分两阶段实测：
 *   阶段A：token=''      → 测第 1/2/3 条（空令牌全拒）
 *   阶段B：token=测试值   → 测第 1/2/4~9 条
 * 第 10 条按卡原意直打本地 3001（可用 GW_ACCEPT_BASE 覆盖）。
 *
 * 用法（backend 目录，先 npm run build）：node scripts/supplier-notify-gateway-test.js
 * 数据安全：夹具自造（TAG 可辨认），跑完逐表清理并断言残留 = 0；配置快照跑完还原。
 */
const BASE_PORT = process.env.GW_TEST_PORT || '3011'
const ACCEPT_BASE = process.env.GW_ACCEPT_BASE || 'http://localhost:3001/api/v1'
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

// ── 读 backend/.env（PrismaClient 需要 DATABASE_URL；不覆盖已有环境变量） ──
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

const BACKEND_ROOT = path.join(__dirname, '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 拉起临时后端实例（dist 构建），返回 child；日志落 os.tmpdir() */
function spawnServer(token) {
  const logPath = path.join(os.tmpdir(), `supplier-notify-gw-test-${BASE_PORT}.log`)
  const out = fs.openSync(logPath, 'a')
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      PORT: BASE_PORT,
      SUPPLIER_NOTIFY_GATEWAY_TOKEN: token, // 空字符串 = 停用（安全默认）
      SUPPLIER_NOTIFY_CRON: '0 0 3 1 1 *', // 自测期间关掉每分钟扫描，避免干扰判定
    },
    stdio: ['ignore', out, out],
  })
  return { child, logPath }
}

async function waitReady(base, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(base + '/auth/wx-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      return true // 有 HTTP 响应即视为就绪（业务 4xx 无所谓）
    } catch (e) { /* 未就绪 */ }
    await sleep(500)
  }
  return false
}

async function stopServer({ child }) {
  if (!child || child.exitCode !== null) return
  child.kill()
  const deadline = Date.now() + 5000
  while (child.exitCode === null && Date.now() < deadline) await sleep(200)
  if (child.exitCode === null) {
    try { spawnSync('taskkill', ['/PID', String(child.pid), '/F', '/T']) } catch (e) { /* 兜底失败就算了 */ }
  }
}

async function api(base, method, p, body, headers) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  let j = null
  try { j = await res.json() } catch (e) { /* 非 JSON */ }
  return { status: res.status, json: j, data: j?.data, code: j?.code, msg: j?.msg }
}
const gwHeaders = (token) => ({ 'x-gateway-token': token })

const TS = Date.now()
const TAG = `卡BP1自测${TS}`
const phone = '139' + String(TS).slice(-8) // 11 位测试手机号
const created = { userIds: [], supplierId: null, purchaserId: null, orderId: null, orderItemIds: [], productId: null }
let cfgSnapshot = null // { existed, value }
let gwStateSnapshot = null // { existed, value }

async function setupFixture(adminToken) {
  // 配置快照 + 测试配置（launchAt=1h 前：只我们的夹具单在回看窗口内）
  const row = await prisma.platformConfig.findUnique({ where: { key: 'supplier_ack_reminder' } })
  cfgSnapshot = { existed: !!row, value: row ? row.value : null }
  const testCfg = {
    enabled: true, thresholdMinutes: 5, secondGapMinutes: 10, maxCalls: 2,
    quietEnabled: false, quietStart: '22:00', quietEnd: '05:00',
    launchAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    channel: 'phone', ringSeconds: 5, hangupAfterAnswerSeconds: 2, gatewayPhoneNo: null,
  }
  await prisma.platformConfig.upsert({ where: { key: 'supplier_ack_reminder' }, update: { value: testCfg }, create: { key: 'supplier_ack_reminder', value: testCfg } })
  const gs = await prisma.platformConfig.findUnique({ where: { key: 'supplier_notify_gateway_state' } })
  gwStateSnapshot = { existed: !!gs, value: gs ? gs.value : null }

  // 供应商（有手机号 + 催办开关默认开）
  const supUser = await prisma.user.create({ data: { wxOpenid: `dev_bp1sup_${TS}`, name: TAG + '供应商', phone, roles: [], status: 1 } })
  created.userIds.push(supUser.id)
  const sup = await prisma.supplier.create({ data: { userId: supUser.id, stallName: TAG + '档口', address: TAG, status: 1, qualification: {} } })
  created.supplierId = sup.id
  // 采购方 + 档口
  const buyerUser = await prisma.user.create({ data: { wxOpenid: `dev_bp1buy_${TS}`, name: TAG + '买家', roles: [], status: 1 } })
  created.userIds.push(buyerUser.id)
  const purchaser = await prisma.purchaser.create({ data: { userId: buyerUser.id, shopName: TAG + '餐馆', contact: '卡BP1', phone: '137' + String(TS).slice(-8), address: TAG + '地址', accountStatus: 2 } })
  created.purchaserId = purchaser.id
  // 夹具订单：status=30、30 分钟前创建（≥launchAt、≥阈值、24h 窗口内）
  const product = await prisma.product.findFirst({ orderBy: { id: 'asc' } })
  if (!product) throw new Error('本地库无任何 product，无法造夹具')
  created.productId = product.id
  const order = await prisma.order.create({
    data: {
      purchaserId: purchaser.id,
      deliveryDate: new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })),
      timeWindow: 1,
      status: 30,
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
    },
  })
  created.orderId = order.id
  const item = await prisma.orderItem.create({
    data: { orderId: order.id, productId: product.id, supplierId: sup.id, qtyOrdered: 1, salePrice: 1 },
  })
  created.orderItemIds.push(item.id)
  return { adminToken }
}

async function cleanup() {
  // 台账/审计：我们订单的拨打台账 + 本轮 PUT config 的配置审计
  if (created.orderId) await prisma.auditLog.deleteMany({ where: { action: 'SUPPLIER_NOTIFY_CALL', entityId: created.orderId } })
  await prisma.auditLog.deleteMany({ where: { action: 'SUPPLIER_NOTIFY_CONFIG', createdAt: { gte: new Date(TS - 60 * 1000) } } })
  await prisma.auditLog.deleteMany({ where: { action: { in: ['SUPPLIER_NOTIFY_TEST_CALL'] }, operatorId: 0n } })
  // 业务夹具（FK 顺序：ack → orderItem → order → purchaser → supplier → user）
  if (created.orderId && created.supplierId) {
    await prisma.orderSupplierAck.deleteMany({ where: { orderId: created.orderId, supplierId: created.supplierId } }).catch(() => {})
  }
  if (created.orderId) await prisma.orderItem.deleteMany({ where: { orderId: created.orderId } })
  if (created.orderId) await prisma.order.delete({ where: { id: created.orderId } }).catch(() => {})
  if (created.purchaserId) await prisma.purchaser.delete({ where: { id: created.purchaserId } }).catch(() => {})
  if (created.supplierId) await prisma.supplier.delete({ where: { id: created.supplierId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })
  // 配置快照还原（含网关心跳状态键）
  if (cfgSnapshot) {
    if (cfgSnapshot.existed) await prisma.platformConfig.update({ where: { key: 'supplier_ack_reminder' }, data: { value: cfgSnapshot.value } })
    else await prisma.platformConfig.delete({ where: { key: 'supplier_ack_reminder' } }).catch(() => {})
  }
  if (gwStateSnapshot) {
    if (gwStateSnapshot.existed) await prisma.platformConfig.update({ where: { key: 'supplier_notify_gateway_state' }, data: { value: gwStateSnapshot.value } })
    else await prisma.platformConfig.delete({ where: { key: 'supplier_notify_gateway_state' } }).catch(() => {})
  }
}

async function main() {
  console.log('='.repeat(64))
  console.log('卡BP-1 · 手机专线网关（派发/回报/心跳）自测（' + new Date().toISOString() + '）')
  console.log(`临时实例端口 ${BASE_PORT}（阶段A 空令牌 / 阶段B 测试令牌）；第 10 条基线打 ${ACCEPT_BASE}`)
  console.log('='.repeat(64))

  // ════ 阶段A：SUPPLIER_NOTIFY_GATEWAY_TOKEN=''（安全默认，全部拒绝） ════
  console.log(`\n【阶段A】token=''（env 为空）→ 三个接口一律拒绝`)
  let serverA = spawnServer('')
  try {
    if (!(await waitReady(`http://127.0.0.1:${BASE_PORT}/api/v1`))) throw new Error('阶段A 临时实例 60s 未就绪，日志：' + serverA.logPath)
    const baseA = `http://127.0.0.1:${BASE_PORT}/api/v1`
    const a1 = await api(baseA, 'GET', '/supplier-notify-gateway/pending-dial?limit=5')
    check('A-第3条 pending-dial（env空）→ 403', a1.status === 403 && a1.code === 2002, { status: a1.status, code: a1.code })
    const a2 = await api(baseA, 'GET', '/supplier-notify-gateway/pending-dial?limit=5', null, gwHeaders('whatever'))
    check('A-第3条 pending-dial（env空+带头）→ 403', a2.status === 403 && a2.code === 2002, { status: a2.status, code: a2.code })
    const a3 = await api(baseA, 'POST', '/supplier-notify-gateway/report', { dialId: 'x', result: 'connected' })
    check('A-第3条 report（env空）→ 403', a3.status === 403, { status: a3.status })
    const a4 = await api(baseA, 'POST', '/supplier-notify-gateway/heartbeat')
    check('A-第3条 heartbeat（env空）→ 403', a4.status === 403, { status: a4.status })
  } finally {
    await stopServer(serverA)
  }

  // ════ 阶段B：令牌已配置 ════
  console.log(`\n【阶段B】token=<测试值> → 鉴权 + 业务 8 条`)
  const TOKEN = `gwtest_${TS}`
  let serverB = spawnServer(TOKEN)
  try {
    if (!(await waitReady(`http://127.0.0.1:${BASE_PORT}/api/v1`))) throw new Error('阶段B 临时实例 60s 未就绪，日志：' + serverB.logPath)
    const baseB = `http://127.0.0.1:${BASE_PORT}/api/v1`

    // 第 1 / 2 条：无令牌 / 错令牌（env 已配置时才测得出令牌本身的判定）
    const b1 = await api(baseB, 'GET', '/supplier-notify-gateway/pending-dial?limit=5')
    check('第1条 不带 x-gateway-token → 401', b1.status === 401 && b1.code === 2001, { status: b1.status, code: b1.code, body: b1.json })
    const b2 = await api(baseB, 'GET', '/supplier-notify-gateway/pending-dial?limit=5', null, gwHeaders('wrong-token'))
    check('第2条 令牌错误 → 401', b2.status === 401 && b2.code === 2001, { status: b2.status, code: b2.code })

    // 夹具 + admin 登录
    const adminToken = (await api(baseB, 'POST', '/auth/wx-login', { code: 'admin' })).data?.token
    check('B0 admin 登录', !!adminToken)
    await setupFixture(adminToken)

    // 第 4 条：令牌正确 + enabled=true + channel='phone' → 返回数组（回显字段）
    const b4 = await api(baseB, 'GET', '/supplier-notify-gateway/pending-dial?limit=5', null, gwHeaders(TOKEN))
    const mine = (b4.data || []).find((x) => Number(x.orderId) === Number(created.orderId))
    check('第4条 pending-dial code=0 返回数组', b4.code === 0 && Array.isArray(b4.data), { status: b4.status, code: b4.code, len: Array.isArray(b4.data) ? b4.data.length : null })
    check('第4条 夹具候选在数组里且字段齐全', !!mine && mine.phone === phone && mine.supplierId === Number(created.supplierId)
      && typeof mine.dialId === 'string' && /^\d+_\d+_\d+$/.test(mine.dialId) && mine.dialId.startsWith(`${created.orderId}_${created.supplierId}_`)
      && mine.ringSeconds === 5 && mine.hangupAfterAnswerSeconds === 2 && mine.supplierName === TAG + '档口' && mine.shopName === TAG + '餐馆'
      && mine.minutesUnacked >= 30, mine)
    // 台账脱敏：audit 里只允许 maskPhone
    const ledger = await prisma.auditLog.findFirst({ where: { action: 'SUPPLIER_NOTIFY_CALL', entityId: BigInt(created.orderId) }, orderBy: { id: 'desc' } })
    const la = ledger?.after || {}
    check('第4条 台账 result=dispatched/channel=phone 且号码已脱敏',
      la.result === 'dispatched' && la.channel === 'phone' && la.phone === phone.slice(0, 3) + '****' + phone.slice(7) && !JSON.stringify(la).includes(phone), la)

    // 第 5 条：同一候选连续拉两次 → 第二次不再出现
    const b5 = await api(baseB, 'GET', '/supplier-notify-gateway/pending-dial?limit=5', null, gwHeaders(TOKEN))
    const mineAgain = (b5.data || []).find((x) => Number(x.orderId) === Number(created.orderId))
    check('第5条 第二次拉取夹具候选不再出现（派发即计数不重复派）', b5.code === 0 && !mineAgain, { len: Array.isArray(b5.data) ? b5.data.length : null, mineAgain })
    const ackRow = await prisma.orderSupplierAck.findUnique({ where: { orderId_supplierId: { orderId: BigInt(created.orderId), supplierId: BigInt(created.supplierId) } } })
    check('第5条 remindCount 已 +1、lastRemindAt 已写', !!ackRow && ackRow.remindCount === 1 && !!ackRow.lastRemindAt, ackRow && { remindCount: ackRow.remindCount, lastRemindAt: ackRow.lastRemindAt })

    // 第 6 条：heartbeat → config 里 gateway.online === true
    const hb = await api(baseB, 'POST', '/supplier-notify-gateway/heartbeat', null, gwHeaders(TOKEN))
    check('第6条 heartbeat 接受（200/code0）', hb.code === 0 && !!hb.data?.at, { status: hb.status, code: hb.code })
    const cfg = await api(baseB, 'GET', '/admin/supplier-notify/config', null, { Authorization: `Bearer ${adminToken}` })
    check('第6条 config.gateway.online === true（180 秒窗口内）', cfg.code === 0 && cfg.data?.gateway?.online === true && !!cfg.data?.gateway?.lastHeartbeatAt, cfg.data?.gateway)
    check('第6条 config 暴露 channel / ringSeconds / hangupAfterAnswerSeconds / gatewayPhoneNo',
      cfg.data?.channel === 'phone' && cfg.data?.ringSeconds === 5 && cfg.data?.hangupAfterAnswerSeconds === 2 && cfg.data?.gatewayPhoneNo === null,
      cfg.data && { channel: cfg.data.channel, ringSeconds: cfg.data.ringSeconds, hangup: cfg.data.hangupAfterAnswerSeconds, gw: cfg.data.gatewayPhoneNo })
    const rep = await api(baseB, 'POST', '/supplier-notify-gateway/report', { dialId: mine?.dialId || 'x', result: 'connected', durationSec: 7, cause: 'test' }, gwHeaders(TOKEN))
    check('第6条+ report 回报接受', rep.code === 0 && rep.data?.ok === true, { status: rep.status, code: rep.code })

    // 第 7 条：channel='off' → pending-dial 返回空数组
    const cur = await prisma.platformConfig.findUnique({ where: { key: 'supplier_ack_reminder' } })
    await prisma.platformConfig.update({ where: { key: 'supplier_ack_reminder' }, data: { value: { ...(cur.value), channel: 'off' } } })
    const b7 = await api(baseB, 'GET', '/supplier-notify-gateway/pending-dial?limit=5', null, gwHeaders(TOKEN))
    check('第7条 channel=off → 空数组', b7.code === 0 && Array.isArray(b7.data) && b7.data.length === 0, { code: b7.code, len: Array.isArray(b7.data) ? b7.data.length : b7.data })

    // 第 8 条：ringSeconds 边界
    const bad0 = await api(baseB, 'PUT', '/admin/supplier-notify/config', { ringSeconds: 0 }, { Authorization: `Bearer ${adminToken}` })
    check('第8条 ringSeconds=0 → 400', bad0.status === 400, { status: bad0.status, code: bad0.code })
    const bad99 = await api(baseB, 'PUT', '/admin/supplier-notify/config', { ringSeconds: 99 }, { Authorization: `Bearer ${adminToken}` })
    check('第8条 ringSeconds=99 → 400', bad99.status === 400, { status: bad99.status, code: bad99.code })
    const ok1 = await api(baseB, 'PUT', '/admin/supplier-notify/config', { ringSeconds: 1 }, { Authorization: `Bearer ${adminToken}` })
    const ok30 = await api(baseB, 'PUT', '/admin/supplier-notify/config', { ringSeconds: 30 }, { Authorization: `Bearer ${adminToken}` })
    check('第8条 ringSeconds=1 → 通过', ok1.code === 0 && ok1.data?.ringSeconds === 1, { status: ok1.status, code: ok1.code, v: ok1.data?.ringSeconds })
    check('第8条 ringSeconds=30 → 通过', ok30.code === 0 && ok30.data?.ringSeconds === 30, { status: ok30.status, code: ok30.code, v: ok30.data?.ringSeconds })

    // 第 9 条：channel='aliyun' → 回到 dialTts（本机未配 ALIYUN_VMS_* ⇒ dry-run）
    // 夹具对在第 4 条已被派发计数（remindCount=1 落在 gap 窗口内会被判定拦下），先清掉 ack 行让它重新成为候选
    await prisma.orderSupplierAck.deleteMany({ where: { orderId: BigInt(created.orderId), supplierId: BigInt(created.supplierId) } })
    const cur2 = await prisma.platformConfig.findUnique({ where: { key: 'supplier_ack_reminder' } })
    await prisma.platformConfig.update({ where: { key: 'supplier_ack_reminder' }, data: { value: { ...(cur2.value), channel: 'aliyun' } } })
    const scan = await api(baseB, 'POST', '/admin/supplier-notify/scan-once', null, { Authorization: `Bearer ${adminToken}` })
    check('第9条 scan-once 命中并走 dialTts（dryRun≥1）', scan.code === 0 && scan.data?.called >= 1 && scan.data?.dryRun >= 1, scan.data && { called: scan.data.called, dryRun: scan.data.dryRun, skipped: scan.data.skipped })
    const dryLedger = await prisma.auditLog.findFirst({
      where: { action: 'SUPPLIER_NOTIFY_CALL', after: { path: '$.orderId', equals: Number(created.orderId) } },
      orderBy: { id: 'desc' },
    })
    check('第9条 台账 result=dry_run（旧通道行为不变）', !!dryLedger && (dryLedger.after)?.result === 'dry_run' && (dryLedger.after)?.mode === 'auto', dryLedger && dryLedger.after)
    // 阿里云通道下网关不取件（防双呼）
    const b9gw = await api(baseB, 'GET', '/supplier-notify-gateway/pending-dial?limit=5', null, gwHeaders(TOKEN))
    check('第9条+ channel=aliyun 时网关 pending-dial 也为空（防双呼）', b9gw.code === 0 && Array.isArray(b9gw.data) && b9gw.data.length === 0, { len: Array.isArray(b9gw.data) ? b9gw.data.length : b9gw.data })
  } finally {
    await cleanup()
    await stopServer(serverB)
  }

  // ════ 第 10 条：仓库基线验收测试（打 3001，需已用新构建重启） ════
  console.log('\n【第10条】仓库基线 node 验收测试.js（打 3001）')
  let reachable = false
  try { await fetch(ACCEPT_BASE + '/auth/wx-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); reachable = true } catch (e) { /* 不可达 */ }
  if (!reachable) {
    check(`第10条 ${ACCEPT_BASE} 不可达（需后端已用新构建启动在 3001）`, false, ACCEPT_BASE)
  } else {
    const outPath = path.join(os.tmpdir(), 'supplier-notify-gw-accept.txt')
    // 注：本机沙箱里 spawnSync 会报 EBUSY，故用异步 spawn 收 stdout
    const allOut = await new Promise((resolve) => {
      let buf = ''
      const c = spawn(process.execPath, ['验收测试.js'], { cwd: BACKEND_ROOT })
      c.stdout.on('data', (d) => (buf += d))
      c.stderr.on('data', (d) => (buf += d))
      c.on('error', (e) => resolve(buf + '\n[spawn error] ' + e.message))
      c.on('close', (code) => resolve(`[exit=${code}]\n` + buf))
    })
    fs.writeFileSync(outPath, allOut)
    const m = allOut.match(/验收结果：✅ 通过 (\d+) 项 \/ ❌ 失败 (\d+) 项/)
    check(`第10条 基线验收通过（输出：${outPath}）`, m && Number(m[2]) === 0, { matched: m && m[0], head: allOut.slice(0, 120) })
  }

  // ════ 清理自检 ════
  const leftover = {
    supplier: await prisma.supplier.count({ where: { stallName: { contains: TAG } } }),
    user: await prisma.user.count({ where: { wxOpenid: { contains: `_${TS}` } } }),
    order: created.orderId ? await prisma.order.count({ where: { id: created.orderId } }) : 0,
    ledger: created.orderId ? await prisma.auditLog.count({ where: { action: 'SUPPLIER_NOTIFY_CALL', entityId: created.orderId } }) : 0,
  }
  check('清理：残留全 0', Object.values(leftover).every((v) => v === 0), leftover)

  console.log('\n' + '='.repeat(64))
  console.log(`结果：${pass} 通过 / ${fail} 失败`)
  if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '))
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('脚本异常：', e)
  try { await cleanup() } catch (e2) { console.error('崩溃清理失败：', e2.message) }
  await prisma.$disconnect()
  process.exit(1)
})
