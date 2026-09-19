// 卡F 取证（后端两条链 + 超限反例 + SQL 直查）
// 运行：cd backend && node ../自测证据/photo-20260919/_photo-evidence.js
// 需后端已启动在 3001（WX_MOCK_LOGIN=1 的本地环境）。
//
// 用 node fetch（不用 curl）：curl 在 Git Bash 下会把 argv 里的中文按系统码页转换 → 落库乱码，
// 本仓验收测试本身也走 fetch，故此处与之一致。
const fs = require('fs')
const path = require('path')

// @prisma/client 在 backend/node_modules 下；本脚本放在 自测证据/ 里，
// 默认解析链找不到它 → 补上「从 cwd 找」的兜底（运行时 cwd = backend）
function loadPrisma() {
  const tries = ['@prisma/client', path.join(process.cwd(), 'node_modules', '@prisma/client')]
  for (const t of tries) {
    try { return require(t) } catch (e) { /* 继续试下一个 */ }
  }
  throw new Error('无法加载 @prisma/client，请在 backend 目录下运行本脚本')
}
const { PrismaClient } = loadPrisma()

const BASE = 'http://localhost:3001/api/v1'
const DIR = __dirname
const prisma = new PrismaClient()

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2705 ' + name) }
  else { fail++; console.log('  \u274c ' + name + (extra ? ' \u2192 ' + JSON.stringify(extra) : '')) }
}

async function call(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch (e) { json = { parseError: String(e), status: res.status } }
  return { status: res.status, ...json }
}

const sql = async (q) => JSON.parse(JSON.stringify(await prisma.$queryRawUnsafe(q), (k, v) => (typeof v === 'bigint' ? Number(v) : v)))
const b64 = (f) => fs.readFileSync(path.join(DIR, f)).toString('base64')
const sizeOf = (f) => fs.statSync(path.join(DIR, f)).size
const hr = (t) => { console.log(''); console.log('────────── ' + t + ' ──────────') }

async function main() {
  console.log('='.repeat(62))
  console.log('卡F 取证 · 售后申请 / 配送员上报 拍照上传（真实尺寸照片）')
  console.log('='.repeat(62))

  // ── 0. 四角色登录（mock）──
  hr('0. 登录')
  const login = async (code) => (await call('POST', '/auth/wx-login', { code })).data.token
  const bt = await login('buyer')          // dev_buyer → purchaser 6（老张水产，ACTIVE）
  const at = await login('admin')
  const st = await login('demo_supplier')
  const ct = await login('courier')
  check('四角色 token 拿到', !!(bt && at && st && ct))
  const me = await call('GET', '/buyer/profile', null, bt)
  console.log('  采购方 =', me.data.shopName, '(purchaserId', me.data.purchaserId + ')')

  // ── 1. 真实尺寸照片上传 ──
  hr('1. 上传真实尺寸照片（3024×4032 / 约 1.5MB，非填充假图）')
  const f1 = 'real-photo-1.jpg'
  const f2 = 'real-photo-2.jpg'
  console.log(`  ${f1} = ${sizeOf(f1)} B（${(sizeOf(f1) / 1024 / 1024).toFixed(2)} MB）`)
  console.log(`  ${f2} = ${sizeOf(f2)} B（${(sizeOf(f2) / 1024 / 1024).toFixed(2)} MB）`)
  const up1 = await call('POST', '/upload/image', { base64: b64(f1) }, bt)
  const up2 = await call('POST', '/upload/image', { base64: b64(f2) }, bt)
  check('照片1 上传成功', up1.code === 0 && !!up1.data?.url, up1)
  check('照片2 上传成功', up2.code === 0 && !!up2.data?.url, up2)
  const url1 = up1.data?.url
  const url2 = up2.data?.url
  console.log('  →', url1, '/', url2)
  // 静态可访问
  const host = BASE.replace(/\/api\/v1$/, '')
  const r1 = await fetch(host + url1)
  const buf1 = Buffer.from(await r1.arrayBuffer())
  check('落盘文件可访问且字节完整', r1.status === 200 && buf1.length === sizeOf(f1), { status: r1.status, len: buf1.length })

  // ── 2. 链路一：采购方售后申请（带照片）──
  hr('2. 链路一 · 采购方售后申请（POST /buyer/aftersale 带 attachments）')
  const orderList = await call('GET', '/order?page=1&pageSize=30', null, bt)
  const target = (orderList.data?.list || []).find((o) => [60, 70, 90].includes(o.status))
  check('找到可售后订单（页面同款筛选 60/70/90）', !!target, orderList.data?.list?.map((o) => o.status))
  console.log('  售后目标订单 =', target.orderId, 'status =', target.status)
  const after = await call('POST', '/buyer/aftersale', {
    orderId: target.orderId,
    type: 2,
    reason: '卡F取证：品质问题，已拍现场照片（真实尺寸原图）',
    attachments: [url1, url2],
  }, bt)
  check('售后申请提交成功', after.code === 0 && after.data?.aftersaleId > 0, after)
  const asId = after.data?.aftersaleId
  console.log('  → aftersaleId =', asId)

  hr('2b. SQL 直查 aftersale_order（证明照片 URL 真进了库）')
  const asRow = await sql(`SELECT id, order_id, order_item_id, type, reason, qty_diff, amount_diff, status, attachments, created_at FROM aftersale_order WHERE id = ${asId}`)
  console.log(JSON.stringify(asRow, null, 2))
  check('落库行存在且 attachments 为 2 个 URL',
    asRow.length === 1 && Array.isArray(asRow[0].attachments) && asRow[0].attachments.length === 2,
    asRow[0]?.attachments)

  // ── 3. 链路二：配送员上报（带照片）──
  hr('3. 链路二 · 配送员上报（POST /courier/report 带 photos）')
  const goods = await call('GET', '/product/list', null, bt)
  const pid = goods.data.list[0].id
  const o = await call('POST', '/order', { deliveryDate: '2026-09-23', timeWindow: 1, items: [{ productId: pid, qty: 1 }] }, bt)
  check('取证专用订单已创建', o.code === 0 && !!o.data?.orderId, o)
  const oid = o.data.orderId
  await call('POST', `/order/${oid}/pay`, { payMethod: 2 }, bt)          // → 30 备货中
  const hd = await call('POST', '/supplier-fulfill/handover', { orderId: oid }, st)
  check('备货完成 → 待配送(40/45)', hd.code === 0 && [40, 45].includes(hd.data?.status), hd)
  console.log('  取证订单 =', oid, 'status =', hd.data?.status)

  const rep = await call('POST', '/courier/report', {
    orderId: oid,
    reason: '卡F取证：到货不足，已拍现场照片',
    photos: [url1, url2],
  }, ct)
  check('异常上报成功', rep.code === 0 && rep.data?.exceptionId > 0, rep)
  check('上报确实影响了订单（affectedOrders=1）', rep.data?.affectedOrders === 1, rep)
  const exId = rep.data.exceptionId
  const oAfter = await call('GET', `/order/${oid}`, null, bt)
  check('订单已置 92 无法交付', oAfter.data?.status === 92, oAfter.data)

  hr('3b. SQL 直查 delivery_exception（证明照片 URL 真进了库）')
  const exRow = await sql(`SELECT id, delivery_task_id, courier_id, order_id, reason, status, photos, created_at FROM delivery_exception WHERE id = ${exId}`)
  console.log(JSON.stringify(exRow, null, 2))
  check('落库行存在且 photos 为 2 个 URL',
    exRow.length === 1 && Array.isArray(exRow[0].photos) && exRow[0].photos.length === 2,
    exRow[0]?.photos)

  // ── 4. 超限反例（8MB 真实尺寸图）──
  hr('4. 超限反例 · 8MB 真实尺寸图 → 友好报错（不是裸 500）')
  const f8 = 'real-photo-8mb.jpg'
  console.log(`  ${f8} = ${sizeOf(f8)} B（${(sizeOf(f8) / 1024 / 1024).toFixed(2)} MB，4000×5333）`)
  const up8 = await call('POST', '/upload/image', { base64: b64(f8) }, bt)
  console.log('  → 返回:', JSON.stringify(up8))
  check('返回业务码 1001（不是 500/5001）', up8.code === 1001, up8)
  check('文案友好（含「图片过大」）', typeof up8.msg === 'string' && up8.msg.includes('图片过大'), up8.msg)

  // ── 5. 审计 ──
  hr('5. 审计 · 带照片的售后/上报都写 audit_log，action 全大写')
  const aud = await sql(`SELECT id, operator_id, action, entity, entity_id, after FROM audit_log WHERE action IN ('AFTERSALE_SUBMIT','courier_report') ORDER BY id DESC LIMIT 4`)
  console.log(JSON.stringify(aud, null, 2))
  check('存在 AFTERSALE_SUBMIT（全大写）', aud.some((a) => a.action === 'AFTERSALE_SUBMIT'))
  // ⚠️ 必须做二进制比较：库表是 utf8mb4_unicode_ci（大小写不敏感），
  //    `action <> UPPER(action)` 会被 collation 判为「相等」，永远查不出小写 action（踩过）。
  //    也注意 MySQL 8 的 `REGEXP BINARY` 会报 3995，用 CAST(... AS BINARY) 才稳。
  const lower = await sql(`SELECT action, COUNT(*) c FROM audit_log WHERE CAST(action AS BINARY) <> CAST(UPPER(action) AS BINARY) GROUP BY action`)
  console.log('  非大写 action:', JSON.stringify(lower))
  check('未新增小写 action（仍只有 courier_report）', lower.length === 1 && lower[0].action === 'courier_report', lower)

  hr('结果')
  console.log(`  ✅ 通过 ${pass} 项 / ❌ 失败 ${fail} 项`)
  fs.writeFileSync(path.join(DIR, '_photo-evidence.json'), JSON.stringify({
    pass, fail,
    photo1: { file: f1, bytes: sizeOf(f1), url: url1 },
    photo2: { file: f2, bytes: sizeOf(f2), url: url2 },
    aftersale: { id: asId, orderId: target.orderId, row: asRow },
    report: { exceptionId: exId, orderId: oid, row: exRow },
    oversize: { file: f8, bytes: sizeOf(f8), response: up8 },
    audit: aud,
  }, null, 2))
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
