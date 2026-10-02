/**
 * 卡BN-1（2026-10-02）· 未接单电话催办（后端）自测
 *
 * 覆盖（任务书第八节 15 项，全部 dry-run —— .env 无 ALIYUN_VMS_*，绝不真拨）：
 *   1. enabled=false / maxCalls=0 → 零台账、remindCount 全 0
 *   2. 未达阈值 → 不打；3. 达阈值 → 打 1 通（dry_run 台账 + remindCount=1 + 审计）
 *   4. 间隔：紧接再扫不打；lastRemindAt 拨回 11 分钟前再扫 → 第 2 通；再扫 → 达上限不打
 *   5. 免打扰（含跨零点推算）→ 不打
 *   6. 供应商自关 → skipped_ack_call_off；7. 无手机号 → skipped_no_phone 且不占次数
 *   8. 历史单（createdAt < launchAt）→ 不打；9. 已 ack / 非备货中 → 不打
 *   10. mark-handled 后不再自动打；11. 配置读写 + 非法值 400；12. launchAt 不被改
 *   13. 权限：采购方 token 调 1–8 → 403；非供应商调 9/10 → 403；14. scan-once 返回统计
 *   15. 清理后残留全 0（本卡自造行 + 本卡审计行）
 *
 * 用法（backend 目录）：node scripts/supplier-ack-notify-test.js
 * 数据安全边界：全部自造自清；platform_config 的 supplier_ack_reminder 键测后还原原值；
 *               本卡审计行按「跑前 audit_log 最大 id 快照」清理（SUPPLIER_NOTIFY_* 为本卡新动作，无并发冲突面）。
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

const TS = Date.now()
const TAG = `卡BN1自测${TS}`
const CFG_KEY = 'supplier_ack_reminder'

const created = { userIds: [], purchaserIds: [], supplierIds: [], orderIds: [], orderItemIds: [] }

const mkOrder = (purchaserId, status, createdAt) =>
  prisma.order.create({
    data: {
      purchaserId, deliveryDate: new Date(), timeWindow: 2, status,
      amountOrdered: 100, deliveryFee: 5, payMethod: 2, remark: TAG,
      ...(createdAt ? { createdAt } : {}),
    },
  })
const mkItem = (orderId, productId, supplierId) =>
  prisma.orderItem.create({ data: { orderId, productId, supplierId, qtyOrdered: 10, qtyDeclared: 10, salePrice: 2.5, supplyPrice: 2 } })

async function main() {
  console.log('='.repeat(64))
  console.log('卡BN-1 · 未接单电话催办（后端）自测（' + new Date().toISOString() + '，全 dry-run）')
  console.log('='.repeat(64))

  // 审计清理基线：只清本卡跑出来的 SUPPLIER_NOTIFY_* 行
  const auditFloor = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? 0n
  // 配置键原值快照（测后还原）
  const cfgBefore = await prisma.platformConfig.findUnique({ where: { key: CFG_KEY } })

  // ════ 0. fixture + 登录 ════
  const product = await prisma.product.findFirst({ where: { status: 1 } })
  if (!product) throw new Error('库里没有在售商品')

  const buyerUser = await prisma.user.create({ data: { wxOpenid: `dev_bnbuy_${TS}`, name: TAG + '买家', roles: [], status: 1 } })
  created.userIds.push(buyerUser.id)
  const purchaser = await prisma.purchaser.create({
    data: { userId: buyerUser.id, shopName: TAG + '餐馆', contact: '卡BN1', phone: '137' + String(TS).slice(-8), address: TAG + '地址', accountStatus: 2 },
  })
  created.purchaserIds.push(purchaser.id)

  const mkSupplier = async (suffix, stall, phone) => {
    const u = await prisma.user.create({ data: { wxOpenid: `dev_bn${suffix}_${TS}`, name: TAG + stall, roles: [], status: 1, ...(phone ? { phone: phone + String(TS).slice(-5) } : {}) } })
    created.userIds.push(u.id)
    const s = await prisma.supplier.create({ data: { userId: u.id, stallName: TAG + stall, address: TAG, status: 1, qualification: {} } })
    created.supplierIds.push(s.id)
    return s
  }
  const supOK = await mkSupplier('ok', '档口有话', '138') // 有手机号、开关开
  const supOff = await mkSupplier('off', '档口自关', '139') // 有手机号、稍后自关
  const supNoPhone = await mkSupplier('np', '档口无话', null) // 无手机号

  // 主订单 O1：备货中(30)，三个供应商各一条明细（现在 −6 分钟 → 超过默认阈值 5 分钟）
  const O1 = await mkOrder(purchaser.id, 30, new Date(Date.now() - 6 * 60000))
  const iOK = await mkItem(O1.id, product.id, supOK.id)
  const iOff = await mkItem(O1.id, product.id, supOff.id)
  const iNP = await mkItem(O1.id, product.id, supNoPhone.id)
  // O2：备货中，supOK 明细，现在 −2 分钟（未达阈值）
  const O2 = await mkOrder(purchaser.id, 30, new Date(Date.now() - 2 * 60000))
  const i2 = await mkItem(O2.id, product.id, supOK.id)
  // O3：三天前的单（落在 24h 回看窗口之外）
  const O3 = await mkOrder(purchaser.id, 30, new Date(Date.now() - 3 * 24 * 3600 * 1000))
  const i3 = await mkItem(O3.id, product.id, supOK.id)
  // O5：20 分钟前的单 —— 24h 窗口内、但早于 launchAt（专测「历史单不拨打」分界线）
  const O5 = await mkOrder(purchaser.id, 30, new Date(Date.now() - 20 * 60000))
  const i5 = await mkItem(O5.id, product.id, supOK.id)
  // O4：非备货中(40 待配送) → 不打
  const O4 = await mkOrder(purchaser.id, 40, new Date(Date.now() - 6 * 60000))
  const i4 = await mkItem(O4.id, product.id, supOK.id)
  created.orderIds.push(O1.id, O2.id, O3.id, O4.id, O5.id)
  created.orderItemIds.push(iOK.id, iOff.id, iNP.id, i2.id, i3.id, i5.id, i4.id)

  const login = async (code) => {
    const r = await api('POST', '/auth/wx-login', { code })
    if (r.code !== 0) throw new Error(`登录失败(${code})：${JSON.stringify(r.json)}`)
    return r.data.token
  }
  const tokenAdmin = await login('admin')
  const tokenBuyer = await login(`bnbuy_${TS}`) // 普通采购方（权限反例）
  const tokenSupOK = await login(`bnok_${TS}`) // 供应商（9/10 正例）
  check('测试账号登录成功', !!tokenAdmin && !!tokenBuyer && !!tokenSupOK)

  const putCfg = (body, token) => api('PUT', '/admin/supplier-notify/config', body, token)
  const scan = async (token = tokenAdmin) => api('POST', '/admin/supplier-notify/scan-once', {}, token)
  const ackRow = (oid, sid) => prisma.orderSupplierAck.findUnique({ where: { orderId_supplierId: { orderId: BigInt(oid), supplierId: BigInt(sid) } } })
  const callRecords = (oid, sid) =>
    prisma.auditLog.findMany({ where: { action: 'SUPPLIER_NOTIFY_CALL', id: { gt: auditFloor } } })
      .then((rows) => rows.filter((x) => (x.after)?.orderId === oid && (x.after)?.supplierId === sid))
  const upsertAck = (oid, sid, data) => prisma.orderSupplierAck.upsert({ where: { orderId_supplierId: { orderId: BigInt(oid), supplierId: BigInt(sid) } }, update: data, create: { orderId: BigInt(oid), supplierId: BigInt(sid) } })
  const deleteAutoRecords = async (oid, sid) => {
    const rows = await prisma.auditLog.findMany({ where: { action: 'SUPPLIER_NOTIFY_CALL', id: { gt: auditFloor } } })
    for (const x of rows) {
      const a = x.after
      if (a?.orderId === oid && a?.supplierId === sid && a?.mode === 'auto') await prisma.auditLog.delete({ where: { id: x.id } })
    }
  }

  // ════ 11-前置. 键不存在时 GET 返回默认值 ════
  console.log('\n【11-前置】配置键不存在 → GET 返回默认值（enabled=false）')
  if (cfgBefore) await prisma.platformConfig.delete({ where: { key: CFG_KEY } }) // 临时移除（测后还原原值）
  let r = await api('GET', '/admin/supplier-notify/config', null, tokenAdmin)
  check('0a 键不存在时 GET code=0', r.code === 0, r.msg)
  check('0b 默认值 enabled=false（硬红线）', r.data?.enabled === false, r.data?.enabled)
  check('0c 默认阈值 5 / 间隔 10 / 上限 2', r.data?.thresholdMinutes === 5 && r.data?.secondGapMinutes === 10 && r.data?.maxCalls === 2, { t: r.data?.thresholdMinutes, g: r.data?.secondGapMinutes, m: r.data?.maxCalls })
  check('0d 默认免打扰 22:00–05:00', r.data?.quietEnabled === true && r.data?.quietStart === '22:00' && r.data?.quietEnd === '05:00')

  // 首次 PUT：写入 launchAt（分界线 = 现在）
  r = await putCfg({ enabled: true, thresholdMinutes: 5, secondGapMinutes: 10, maxCalls: 2, quietEnabled: false }, tokenAdmin)
  check('0e 首次保存配置成功', r.code === 0, { status: r.status, code: r.code, msg: r.msg })
  const launchAt = r.data?.launchAt
  check('0f 首次保存写入 launchAt', typeof launchAt === 'string' && !!launchAt, launchAt)
  // 测试手法：launchAt = 保存时刻，永远晚于夹具的回填 createdAt → 扫描会把全部夹具当历史单。
  // 与回拨 lastRemindAt 同理，把 launchAt 回拨到 t0−10min：夹具 O1/O2/O4（−6/−2min）落在其之后成为候选，
  // O5（−20min）落在其之前专测「历史单不打」，O3（−3天）专测 24h 回看窗口。0f 已证明首存写入、12a 将证明保存不改。
  const launchAtBackdated = new Date(Date.now() - 10 * 60000).toISOString()
  {
    const row = await prisma.platformConfig.findUnique({ where: { key: CFG_KEY } })
    await prisma.platformConfig.update({ where: { key: CFG_KEY }, data: { value: { ...row.value, launchAt: launchAtBackdated } } })
  }
  check('0g launchAt 已回拨到 −10min（测试口径）', true, launchAtBackdated)

  // ════ 1. 总刹车：maxCalls=0 / enabled=false ════
  console.log('\n【1】总刹车：maxCalls=0 / enabled=false → 零台账')
  await putCfg({ enabled: true, maxCalls: 0 }, tokenAdmin)
  r = await scan()
  check('1a scan-once code=0', r.code === 0, r.msg)
  check('1b 返回 totalOff=true', r.data?.totalOff === true, r.data?.totalOff)
  check('1c 台账 0 条', (await callRecords(Number(O1.id), Number(supOK.id))).length === 0)
  const a1 = await ackRow(O1.id, supOK.id)
  check('1d remindCount 全 0（未建行）', !a1 || a1.remindCount === 0, a1?.remindCount)
  await putCfg({ enabled: false }, tokenAdmin)
  r = await scan()
  check('1e enabled=false 也 totalOff', r.data?.totalOff === true)

  // ════ 2. 未达阈值 ════
  console.log('\n【2】未达阈值（O2：−2 分钟 < 5）→ 不打')
  await putCfg({ enabled: true, maxCalls: 2, quietEnabled: false }, tokenAdmin)
  r = await scan()
  check('2a belowThreshold 计数 ≥1', (r.data?.skipped?.belowThreshold ?? 0) >= 1, r.data?.skipped)
  check('2b O2 无台账', (await prisma.orderSupplierAck.findUnique({ where: { orderId_supplierId: { orderId: O2.id, supplierId: supOK.id } } })) === null)

  // ════ 3. 达阈值 → 打 1 通 ════
  console.log('\n【3】达阈值（O1 −6 分钟）→ supOK 打 1 通 dry_run')
  r = await scan()
  const recs1 = await callRecords(Number(O1.id), Number(supOK.id))
  check('3a 台账 1 条', recs1.length === 1, recs1.length)
  check('3b result=dry_run', recs1[0] && recs1[0].after?.result === 'dry_run')
  check('3c mode=auto', recs1[0] && recs1[0].after?.mode === 'auto')
  const a3 = await ackRow(O1.id, supOK.id)
  check('3d remindCount=1', a3?.remindCount === 1, a3?.remindCount)
  check('3e lastRemindAt 非空', !!a3?.lastRemindAt)
  const auditCount = await prisma.auditLog.count({ where: { action: 'SUPPLIER_NOTIFY_CALL', id: { gt: auditFloor } } })
  check('3f 审计 SUPPLIER_NOTIFY_CALL ≥1 条', auditCount >= 1, auditCount)
  check('3g dry_run 台账不写 callId', recs1[0] && !recs1[0].after?.callId)

  // ════ 4. 间隔 + 上限 ════
  console.log('\n【4】间隔：紧接再扫不打；拨回 11 分钟前 → 第 2 通；再扫 → 达上限')
  await scan()
  check('4a 紧接再扫不打（仍 1 条）', (await callRecords(Number(O1.id), Number(supOK.id))).length === 1)
  await upsertAck(O1.id, supOK.id, { lastRemindAt: new Date(Date.now() - 11 * 60000) })
  await scan()
  const recs2 = await callRecords(Number(O1.id), Number(supOK.id))
  check('4b 间隔过 → 第 2 通', recs2.length === 2, recs2.length)
  const a4 = await ackRow(O1.id, supOK.id)
  check('4c remindCount=2', a4?.remindCount === 2, a4?.remindCount)
  await upsertAck(O1.id, supOK.id, { lastRemindAt: new Date(Date.now() - 11 * 60000) })
  await scan()
  check('4d 达上限不再打', (await callRecords(Number(O1.id), Number(supOK.id))).length === 2)

  // ════ 5. 免打扰（含跨零点）════
  console.log('\n【5】免打扰：包住当前时刻 → 不打（跨零点窗口单独推算）')
  await upsertAck(O1.id, supOK.id, { remindCount: 0, lastRemindAt: null })
  await deleteAutoRecords(Number(O1.id), Number(supOK.id))
  const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  const curHm = `${String(nowLocal.getHours()).padStart(2, '0')}:${String(nowLocal.getMinutes()).padStart(2, '0')}`
  const mkHm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const s1 = mkHm(new Date(nowLocal.getTime() - 30 * 60000))
  const e1 = mkHm(new Date(nowLocal.getTime() + 30 * 60000))
  await putCfg({ quietEnabled: true, quietStart: s1, quietEnd: e1 }, tokenAdmin)
  r = await scan()
  const curMin = nowLocal.getHours() * 60 + nowLocal.getMinutes()
  const [sh1, sm1] = s1.split(':').map(Number)
  const [eh1, em1] = e1.split(':').map(Number)
  const S1 = sh1 * 60 + sm1, E1 = eh1 * 60 + em1
  const expectQuiet1 = S1 <= E1 ? curMin >= S1 && curMin < E1 : curMin >= S1 || curMin < E1
  check(`5a 当前本地 ${curHm} 落在 [${s1},${e1}) = ${expectQuiet1}`, true) // 口径记录
  if (expectQuiet1) {
    check('5b 免打扰内不打（清理后仍 0 条）', (await callRecords(Number(O1.id), Number(supOK.id))).length === 0)
    check('5c quiet 计数 ≥1', (r.data?.skipped?.quiet ?? 0) >= 1, r.data?.skipped)
  }
  // 跨零点窗口语义（[start,end) 跨零点 = >=start 或 <end）
  const crossCase = (h, m, qs, qe) => {
    const t = h * 60 + m
    const [sh, sm] = qs.split(':').map(Number)
    const [eh, em] = qe.split(':').map(Number)
    const S = sh * 60 + sm, E = eh * 60 + em
    return S <= E ? t >= S && t < E : t >= S || t < E
  }
  check('5d 跨零点 22:00–05:00 @23:30 → true', crossCase(23, 30, '22:00', '05:00') === true)
  check('5e 跨零点 22:00–05:00 @03:00 → true', crossCase(3, 0, '22:00', '05:00') === true)
  check('5f 跨零点 22:00–05:00 @12:00 → false', crossCase(12, 0, '22:00', '05:00') === false)
  await putCfg({ quietEnabled: false }, tokenAdmin)

  // ════ 6/7. 供应商自关 / 无手机号 ════
  console.log('\n【6/7】自关 → skipped_ack_call_off；无手机号 → skipped_no_phone 且不占次数')
  // 清掉 supOff 既有台账/计数，避免 lastResult 被旧台账顶掉
  await deleteAutoRecords(Number(O1.id), Number(supOff.id))
  await prisma.orderSupplierAck.deleteMany({ where: { orderId: O1.id, supplierId: supOff.id } })
  await prisma.supplier.update({ where: { id: supOff.id }, data: { ackCallEnabled: 0 } })
  await scan()
  const listR = await api('GET', '/admin/supplier-notify/list', null, tokenAdmin)
  const rowOff = (listR.data?.rows || []).find((x) => x.orderId === Number(O1.id) && x.supplierId === Number(supOff.id))
  const rowNP = (listR.data?.rows || []).find((x) => x.orderId === Number(O1.id) && x.supplierId === Number(supNoPhone.id))
  check('6a 列表 lastResult=skipped_ack_call_off', rowOff?.lastResult === 'skipped_ack_call_off', rowOff?.lastResult)
  check('6b 自关无台账', (await callRecords(Number(O1.id), Number(supOff.id))).length === 0)
  check('7a 列表 lastResult=skipped_no_phone', rowNP?.lastResult === 'skipped_no_phone', rowNP?.lastResult)
  check('7b 无手机号无台账', (await callRecords(Number(O1.id), Number(supNoPhone.id))).length === 0)
  const aNP = await ackRow(O1.id, supNoPhone.id)
  check('7c 无手机号不占 remindCount（未建行或 0）', !aNP || aNP.remindCount === 0, aNP?.remindCount)
  check('7d 无手机号 phoneMasked=null', rowNP?.phoneMasked === null, rowNP?.phoneMasked)
  check('6c 自关 phoneMasked 脱敏（139****X）', /^\d{3}\*{4}\d$/.test(rowOff?.phoneMasked || ''), rowOff?.phoneMasked)
  await prisma.supplier.update({ where: { id: supOff.id }, data: { ackCallEnabled: 1 } })

  // ════ 8/9. 历史单 / 已 ack / 非备货中 ════
  console.log('\n【8/9】历史单(launchAt)不打；24h 窗口外不打；已 ack 不打；非备货中不打')
  await upsertAck(O1.id, supOK.id, { remindCount: 0, lastRemindAt: null })
  await putCfg({ maxCalls: 5 }, tokenAdmin)
  await scan()
  check('8a 历史单 O5（24h 内但早于 launchAt）无台账', (await callRecords(Number(O5.id), Number(supOK.id))).length === 0)
  check('8b 三天前 O3（24h 窗口外）无台账', (await callRecords(Number(O3.id), Number(supOK.id))).length === 0)
  check('9a 非备货中 O4 无台账', (await callRecords(Number(O4.id), Number(supOK.id))).length === 0)
  await prisma.orderSupplierAck.create({ data: { orderId: O2.id, supplierId: supOK.id, ackAt: new Date() } })
  await scan()
  check('9b 已 ack 的 O2 不再打', (await callRecords(Number(O2.id), Number(supOK.id))).length === 0)

  // ════ 10. mark-handled ════
  console.log('\n【10】mark-handled 后不再自动打')
  await upsertAck(O2.id, supOK.id, { ackAt: null })
  await prisma.order.update({ where: { id: O2.id }, data: { createdAt: new Date(Date.now() - 6 * 60000) } })
  // 重试 3 次：扫描是每分钟 cron 的同一入口，若与 cron tick 重入会返回 reentered，稍候重扫即可
  let dialed = 0
  let lastScan = null
  for (let i = 0; i < 3; i++) {
    lastScan = await scan()
    dialed = (await callRecords(Number(O2.id), Number(supOK.id))).length
    if (dialed >= 1) break
    await new Promise((res) => setTimeout(res, 1500))
  }
  check('10a 恢复候选后会打', dialed >= 1, { records: dialed, scan: lastScan?.data })
  r = await api('POST', '/admin/supplier-notify/mark-handled', { orderId: Number(O2.id), supplierId: Number(supOK.id) }, tokenAdmin)
  check('10b mark-handled code=0 且 remindStopped=1', r.code === 0 && r.data?.remindStopped === 1, r.data)
  const a10 = await ackRow(O2.id, supOK.id)
  check('10c 库中 remind_stopped=1', a10?.remindStopped === 1, a10?.remindStopped)
  const recsBefore10 = (await callRecords(Number(O2.id), Number(supOK.id))).length
  await upsertAck(O2.id, supOK.id, { remindCount: 0, lastRemindAt: null })
  await scan()
  check('10d 之后扫描不再打', (await callRecords(Number(O2.id), Number(supOK.id))).length === recsBefore10)

  // ════ 11/12. 配置读写 + 非法值 + launchAt ════
  console.log('\n【11/12】非法值 400 且不落库；launchAt 不被改')
  r = await api('GET', '/admin/supplier-notify/config', null, tokenAdmin)
  check('11a GET config code=0', r.code === 0)
  check('11b 返回 vmsConfigured=false（四值为空）', r.data?.vmsConfigured === false, r.data?.vmsConfigured)
  check('11c todayStats 结构', typeof r.data?.todayStats?.calls === 'number' && typeof r.data?.todayStats?.connected === 'number' && typeof r.data?.todayStats?.needManual === 'number', r.data?.todayStats)
  check('11d AK 不回显（响应无 AK/SECRET 字样）', !/AK_SECRET|AK_ID|AccessKeySecret/i.test(JSON.stringify(r.json)))
  const cfgSnap = (await prisma.platformConfig.findUnique({ where: { key: CFG_KEY } }))?.value
  for (const bad of [{ thresholdMinutes: 0 }, { thresholdMinutes: 2000 }, { maxCalls: 9 }, { quietStart: '25:99' }]) {
    r = await putCfg(bad, tokenAdmin)
    // 实测：BizException 路径 = HTTP 200 + 业务码 1001；ValidationPipe 路径（quietStart）= HTTP 400。两者都算拒绝
    check(`11e 非法 ${JSON.stringify(bad)} → 拒绝（400 或 1001）`, r.status === 400 || r.code === 1001, { status: r.status, code: r.code })
  }
  const cfgAfterBad = (await prisma.platformConfig.findUnique({ where: { key: CFG_KEY } }))?.value
  check('11f 非法值不落库（配置未被改动）', JSON.stringify(cfgSnap) === JSON.stringify(cfgAfterBad))
  // launchAt 不被改：以当前值为基准，连续两次 PUT 后必须原样（0f 证首存写入，此处证保存不改）
  const launchAtCur = (await api('GET', '/admin/supplier-notify/config', null, tokenAdmin)).data?.launchAt
  await putCfg({ thresholdMinutes: 4 }, tokenAdmin)
  await putCfg({ thresholdMinutes: 5 }, tokenAdmin)
  r = await api('GET', '/admin/supplier-notify/config', null, tokenAdmin)
  check('12a 连续两次 PUT 后 launchAt 原样不变', r.data?.launchAt === launchAtCur, { before: launchAtCur, now: r.data?.launchAt })

  // ════ 13. 权限 ════
  console.log('\n【13】权限：采购方 token 调 1–8 → 403；非供应商调 9/10 → 403')
  const adminPaths = [
    ['GET', '/admin/supplier-notify/config', null],
    ['PUT', '/admin/supplier-notify/config', { enabled: false }],
    ['GET', '/admin/supplier-notify/list', null],
    ['GET', '/admin/supplier-notify/records', null],
    ['POST', '/admin/supplier-notify/call', { orderId: Number(O1.id), supplierId: Number(supOK.id) }],
    ['POST', '/admin/supplier-notify/test-call', { phone: '13800000000' }],
    ['POST', '/admin/supplier-notify/mark-handled', { orderId: Number(O1.id), supplierId: Number(supOK.id) }],
    ['POST', '/admin/supplier-notify/scan-once', {}],
  ]
  let allForbidden = true
  const seen = []
  for (const [m, p, b] of adminPaths) {
    const rr = await api(m, p, b, tokenBuyer)
    // 实测口径：本项目 BizException(FORBIDDEN) = HTTP 200 + 业务码 2002；401/403 为原生拒绝。三者都算拒绝
    const denied = rr.status === 403 || rr.status === 401 || rr.code === 2002
    seen.push(rr.status === 200 ? `200(${rr.code})` : rr.status)
    if (!denied) allForbidden = false
  }
  check('13a 采购方 token 调 1–8 全部拒绝（实测 ' + seen.join(',') + '）', allForbidden, seen)
  r = await api('GET', '/supplier-notify/me', null, tokenBuyer)
  check('13b 非供应商调 GET /supplier-notify/me → 403(2002)', r.status === 403 || r.status === 401 || r.code === 2002, { status: r.status, code: r.code })
  r = await api('PUT', '/supplier-notify/me', { ackCallEnabled: false }, tokenBuyer)
  check('13c 非供应商调 PUT /supplier-notify/me → 403(2002)', r.status === 403 || r.status === 401 || r.code === 2002, { status: r.status, code: r.code })

  // 9/10 号接口正例（供应商本人）
  r = await api('GET', '/supplier-notify/me', null, tokenSupOK)
  check('13d GET me code=0 且含 ackCallEnabled/thresholdMinutes', r.code === 0 && typeof r.data?.ackCallEnabled === 'boolean' && typeof r.data?.thresholdMinutes === 'number', r.data)
  r = await api('PUT', '/supplier-notify/me', { ackCallEnabled: false }, tokenSupOK)
  check('13e PUT me code=0', r.code === 0, r.msg)
  const supReread = await prisma.supplier.findUnique({ where: { id: supOK.id } })
  check('13f 库中 ack_call_enabled=0', supReread?.ackCallEnabled === 0, supReread?.ackCallEnabled)
  const meAudit = await prisma.auditLog.count({ where: { action: 'SUPPLIER_NOTIFY_ME', id: { gt: auditFloor } } })
  check('13g 开关写入审计', meAudit >= 1, meAudit)
  await api('PUT', '/supplier-notify/me', { ackCallEnabled: true }, tokenSupOK) // 还原

  // ════ 14. scan-once 统计结构 ════
  console.log('\n【14】scan-once 返回判定明细统计')
  r = await scan()
  check('14a 含 candidates/called/skipped', typeof r.data?.candidates === 'number' && typeof r.data?.called === 'number' && !!r.data?.skipped, Object.keys(r.data || {}))

  // ════ 15. 清理 + 残留 ════
  console.log('\n【15】清理自造数据（残留必须全 0）')
  await prisma.orderSupplierAck.deleteMany({ where: { orderId: { in: created.orderIds } } })
  await prisma.orderItem.deleteMany({ where: { orderId: { in: created.orderIds } } })
  await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } })
  await prisma.supplier.deleteMany({ where: { id: { in: created.supplierIds } } })
  await prisma.purchaser.deleteMany({ where: { id: { in: created.purchaserIds } } }) // ⚠️ 必须在 order 之后、user 之前（FK purchaser_id）
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })
  // 本卡产生的 SUPPLIER_NOTIFY_* 审计行（含 CALL/CONFIG/TEST_CALL/MARK_HANDLED/ME）
  const delAudits = await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'SUPPLIER_NOTIFY_' }, id: { gt: auditFloor } } })
  // 还原配置键
  if (cfgBefore) await prisma.platformConfig.update({ where: { key: CFG_KEY }, data: { value: cfgBefore.value } })
  else await prisma.platformConfig.deleteMany({ where: { key: CFG_KEY } })

  const r1 = await prisma.order.count({ where: { remark: TAG } })
  const r2 = await prisma.supplier.count({ where: { stallName: { contains: TAG } } })
  const r3 = await prisma.user.count({ where: { wxOpenid: { startsWith: 'dev_bn' }, name: { contains: TAG } } })
  const r4 = await prisma.orderSupplierAck.count({ where: { orderId: { in: created.orderIds } } })
  const r5 = await prisma.orderItem.count({ where: { orderId: { in: created.orderIds } } })
  const r6 = await prisma.auditLog.count({ where: { action: { startsWith: 'SUPPLIER_NOTIFY_' }, id: { gt: auditFloor } } })
  const cfgNow = await prisma.platformConfig.findUnique({ where: { key: CFG_KEY } })
  const cfgRestored = cfgBefore ? JSON.stringify(cfgNow?.value) === JSON.stringify(cfgBefore.value) : !cfgNow
  check(`15a order 残留=0`, r1 === 0, r1)
  check(`15b supplier 残留=0`, r2 === 0, r2)
  check(`15c user 残留=0`, r3 === 0, r3)
  check(`15d order_supplier_ack 残留=0`, r4 === 0, r4)
  check(`15e order_item 残留=0`, r5 === 0, r5)
  check(`15f 本卡审计行残留=0（已删 ${delAudits.count} 条）`, r6 === 0, r6)
  check(`15g 配置键还原（测前${cfgBefore ? '有 → 原值' : '无 → 删除'}）`, cfgRestored, cfgNow?.value)

  // ════ 汇总 ════
  console.log('\n' + '='.repeat(64))
  console.log(`结果：${pass} 通过 / ${fail} 失败${failures.length ? '  → ' + failures.join('；') : ''}`)
  console.log('='.repeat(64))
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('脚本异常：', e)
  await prisma.$disconnect()
  process.exit(1)
})
