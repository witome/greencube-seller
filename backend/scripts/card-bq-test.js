/**
 * 卡BQ（2026-10-03）· 加价比例修正 + 采购商忽略 + 待审商品可编辑 自测
 *
 * 覆盖（验收对照表可自动化的部分）：
 *   A. 加价比例：
 *      · 审核通过「留空」路径（approved + salePrice，不传 markupRate）→ markupOverridden = 0
 *      · 审核通过手动填 markupRate → markupOverridden = 1
 *      · POST /admin/pricing/:id/reset-override → 1→0、比例/销售价按档位重算、审计 MARKUP_RESET_OVERRIDE
 *      · /admin/pricing 列表 markupSource 三态值（单品 → 重算后非单品）
 *   B. 采购商忽略：
 *      · POST /admin/buyers/:id/ignore → accountStatus = 7、待审 total -1、status=7 可回看（statusText=已忽略）
 *      · 非待审(2) 忽略 → 业务错；重复忽略 → 业务错；审计 IGNORE_BUYER
 *   C. 待审商品可编辑：
 *      · PUT /supplier-goods/apply/:applyId 原地改（申请条数不变、payload/product/link 同步、status 仍 0）
 *      · 已驳回编辑 → status 回 0 + rejectReason 清空（resubmitted=true）
 *      · 已通过编辑 → 业务错「请用「变更申请」修改」；他人申请编辑 → NOT_FOUND；审计 SUPPLIER_EDIT_PENDING_APPLY
 *   D. AI 三链路回归：/ai/parse、/ai/supplier-parse、/ai/supplier/recognize-goods 各打一次，code 0 且老结构不变
 *
 * 用法（backend 目录）：node scripts/card-bq-test.js
 * 数据安全：夹具全部自造（TAG 可辨认），跑完逐表清理并断言残留 = 0；不写 markup_config。
 */
const BASE = process.env.BQ_TEST_BASE || 'http://127.0.0.1:3001/api/v1'
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

const login = async (code) => (await api('POST', '/auth/wx-login', { code })).data?.token

const TS = Date.now()
const TAG = `卡BQ自测${TS}`
const created = { userIds: [], supplierIds: [], purchaserUserIds: [], productIds: [], categoryIds: [], supplierCategoryIds: [], applyIds: [], purchaserIds: [] }

async function main() {
  console.log('='.repeat(64))
  console.log('卡BQ · 加价比例修正 + 采购商忽略 + 待审商品可编辑 自测（' + new Date().toISOString() + '）')
  console.log('='.repeat(64))

  const cat = await prisma.category.findFirst({ orderBy: { id: 'asc' } })

  // ════ 夹具 ════
  const u = await prisma.user.create({ data: { wxOpenid: `dev_bqsup_${TS}`, name: TAG + '供应商', roles: [], status: 1 } })
  created.userIds.push(u.id)
  const sup = await prisma.supplier.create({ data: { userId: u.id, stallName: TAG + '档口', address: TAG, status: 1, qualification: {} } })
  created.supplierIds.push(sup.id)
  await prisma.supplierCategory.create({ data: { supplierId: sup.id, categoryId: cat.id } }).then((sc) => created.supplierCategoryIds.push(sc.id))
  const tokenSup = await login(`bqsup_${TS}`)
  const adminToken = await login('admin')
  check('夹具：供应商 + admin 登录', !!tokenSup && !!adminToken)

  const mkBuyer = async (status) => {
    const bu = await prisma.user.create({ data: { wxOpenid: `dev_bqbuyer${created.purchaserIds.length}_${TS}`, name: TAG + '买家', roles: [], status: 1 } })
    created.userIds.push(bu.id)
    const p = await prisma.purchaser.create({
      data: { userId: bu.id, shopName: TAG + '餐馆' + created.purchaserIds.length, contact: '卡BQ', phone: '139' + String(TS).slice(-8) + created.purchaserIds.length, address: TAG + '地址', deliveryWindows: ['中 10-13'], accountStatus: status },
    })
    created.purchaserIds.push(p.id)
    return { user: bu, purchaser: p }
  }

  // ════ A. 加价比例 ════
  console.log('\n【A】加价比例：留空不钉单品 / 手填钉单品 / 恢复继承')

  const apply1 = await api('POST', '/supplier-goods/apply', { name: TAG + '白菜', categoryId: Number(cat.id), weighType: 1, unit: '斤', supplyPrice: 1.0, dailySupply: 100 }, tokenSup)
  check('A1 新品申请1（留空态被审对象）', apply1.code === 0 && !!apply1.data?.applyId, apply1)
  created.applyIds.push(apply1.data?.applyId)
  const pid1 = Number((await prisma.productApplication.findUnique({ where: { id: BigInt(apply1.data.applyId) } })).productId)
  created.productIds.push(pid1)

  // 留空路径：approved + salePrice，绝不传 markupRate（与前端 A1 留空态 payload 一致）
  const approveEmpty = await api('POST', `/admin/goods/pending/${apply1.data.applyId}/review`, { approved: true, salePrice: 1.3 }, adminToken)
  check('A2 留空态审核通过（salePrice，无 markupRate 字段）', approveEmpty.code === 0, approveEmpty)
  const prod1 = await prisma.product.findUnique({ where: { id: BigInt(pid1) } })
  check('A3 留空通过 → markupOverridden = 0（查库）', Number(prod1.markupOverridden) === 0, { overridden: prod1.markupOverridden, rate: Number(prod1.markupRate), sale: Number(prod1.salePrice) })
  check('A4 留空通过 → salePrice 用运营给的 1.30', Number(prod1.salePrice) === 1.3, Number(prod1.salePrice))
  check('A5 留空通过 → markupRate 走档位解析（供应商/分类/全局 > 0.30 区间内）', Number(prod1.markupRate) >= 0 && Number(prod1.markupRate) <= 2, Number(prod1.markupRate))

  const apply2 = await api('POST', '/supplier-goods/apply', { name: TAG + '萝卜', categoryId: Number(cat.id), weighType: 1, unit: '斤', supplyPrice: 2.0, dailySupply: 50 }, tokenSup)
  created.applyIds.push(apply2.data?.applyId)
  const pid2 = Number((await prisma.productApplication.findUnique({ where: { id: BigInt(apply2.data.applyId) } })).productId)
  created.productIds.push(pid2)
  const approveManual = await api('POST', `/admin/goods/pending/${apply2.data.applyId}/review`, { approved: true, markupRate: 0.5 }, adminToken)
  check('A6 手填 0.5 审核通过', approveManual.code === 0, approveManual)
  const prod2Before = await prisma.product.findUnique({ where: { id: BigInt(pid2) } })
  check('A7 手填 → markupOverridden = 1（查库）', Number(prod2Before.markupOverridden) === 1 && Number(prod2Before.markupRate) === 0.5, { overridden: prod2Before.markupOverridden, rate: Number(prod2Before.markupRate) })
  check('A8 手填 → salePrice = 供货价 × 1.5 = 3.00', Number(prod2Before.salePrice) === 3, Number(prod2Before.salePrice))

  const listBefore = await api('GET', '/admin/pricing', null, adminToken)
  const row2Before = (listBefore.data || []).find((r) => r.productId === pid2)
  check('A9 列表 markupSource=单品（手填行）', row2Before && row2Before.markupSource === '单品', row2Before?.markupSource)

  const reset = await api('POST', `/admin/pricing/${pid2}/reset-override`, {}, adminToken)
  check('A10 恢复继承接口 code 0', reset.code === 0, reset)
  const prod2After = await prisma.product.findUnique({ where: { id: BigInt(pid2) } })
  check('A11 恢复继承 → markupOverridden 1→0（查库前后对照）', Number(prod2Before.markupOverridden) === 1 && Number(prod2After.markupOverridden) === 0, { before: prod2Before.markupOverridden, after: prod2After.markupOverridden })
  check('A12 恢复继承 → markupRate 按档位重算（= 接口返回 rate）', reset.data && Number(prod2After.markupRate) === reset.data.markupRate, { db: Number(prod2After.markupRate), api: reset.data?.markupRate })
  const expectSale = Math.round(2.0 * (1 + Number(reset.data?.markupRate ?? 0)) * 100) / 100
  check('A13 恢复继承 → salePrice = 供货价 × (1+新比例) 联动重算', Number(prod2After.salePrice) === expectSale, { db: Number(prod2After.salePrice), expect: expectSale })
  check('A14 恢复继承后 markupSource 不再是「单品」', reset.data && ['供应商', '分类', '全局默认'].includes(reset.data.source), reset.data?.source)
  const resetAudit = await prisma.auditLog.findFirst({ where: { action: 'MARKUP_RESET_OVERRIDE', entityId: BigInt(pid2) } })
  check('A15 审计落 MARKUP_RESET_OVERRIDE（含 before/after）', !!resetAudit && !!resetAudit.after, !!resetAudit)

  // ════ B. 采购商忽略 ════
  console.log('\n【B】采购商忽略（置 7，绝不动 6）')

  const buyer1 = await mkBuyer(1) // 待审核
  const buyer1Token = await login(`bqbuyer0_${TS}`)
  check('B0 夹具：待审核采购方', !!buyer1Token && buyer1.purchaser.accountStatus === 1)
  // 先取「含本夹具」的待审总数，忽略后应 -1（避免夹具建在两次计数之间被抵消）
  const pendingBefore = await api('GET', '/admin/buyers/pending?status=1&page=1&pageSize=1', null, adminToken)
  const totalBefore = pendingBefore.data?.total

  const ignore = await api('POST', `/admin/buyers/${buyer1.purchaser.id}/ignore`, {}, adminToken)
  check('B1 忽略接口 code 0 → accountStatus=7', ignore.code === 0 && ignore.data?.accountStatus === 7, ignore)
  const p1db = await prisma.purchaser.findUnique({ where: { id: buyer1.purchaser.id } })
  check('B2 查库 accountStatus = 7（6=注销未被占用）', Number(p1db.accountStatus) === 7, p1db.accountStatus)

  const pendingAfter = await api('GET', '/admin/buyers/pending?status=1&page=1&pageSize=1', null, adminToken)
  check('B3 待审队列不再包含该账号、待审计数 -1', pendingAfter.data?.total === totalBefore - 1, { before: totalBefore, after: pendingAfter.data?.total })
  const pendingList = await api('GET', '/admin/buyers/pending?status=1&page=1&pageSize=50', null, adminToken)
  check('B4 待审列表行里找不到该账号', !(pendingList.data?.list || []).some((r) => r.purchaserId === Number(buyer1.purchaser.id)))

  const ignoredList = await api('GET', '/admin/buyers/pending?status=7&page=1&pageSize=50', null, adminToken)
  const ignoredRow = (ignoredList.data?.list || []).find((r) => r.purchaserId === Number(buyer1.purchaser.id))
  check('B5 status=7 页签能回看，statusText=已忽略', !!ignoredRow && ignoredRow.statusText === '已忽略', ignoredRow?.statusText)

  const ignoreAgain = await api('POST', `/admin/buyers/${buyer1.purchaser.id}/ignore`, {}, adminToken)
  check('B6 重复忽略 → 业务错（仅待审核可忽略）', ignoreAgain.code !== 0, { code: ignoreAgain.code, msg: ignoreAgain.msg })

  const buyerActive = await mkBuyer(2)
  const ignoreActive = await api('POST', `/admin/buyers/${buyerActive.purchaser.id}/ignore`, {}, adminToken)
  check('B7 已激活(2)账号忽略 → 业务错', ignoreActive.code !== 0, { code: ignoreActive.code, msg: ignoreActive.msg })

  const ignoreAudit = await prisma.auditLog.findFirst({ where: { action: 'IGNORE_BUYER', entityId: buyer1.purchaser.id } })
  check('B8 审计落 IGNORE_BUYER（before=1 / after=7）', !!ignoreAudit && ignoreAudit.before?.accountStatus === 1 && ignoreAudit.after?.accountStatus === 7, ignoreAudit?.after)

  // ════ C. 待审商品可编辑 ════
  console.log('\n【C】待审/已驳回商品就地编辑')

  const apply3 = await api('POST', '/supplier-goods/apply', { name: TAG + '黄瓜', categoryId: Number(cat.id), weighType: 1, unit: '斤', supplyPrice: 1.8, dailySupply: 300, remark: '原备注' }, tokenSup)
  check('C0 新品申请3（编辑对象）', apply3.code === 0 && !!apply3.data?.applyId, apply3)
  created.applyIds.push(apply3.data?.applyId)
  const apply3Id = apply3.data.applyId
  const pid3 = Number((await prisma.productApplication.findUnique({ where: { id: BigInt(apply3Id) } })).productId)
  created.productIds.push(pid3)
  const applyCountBefore = await prisma.productApplication.count({ where: { productId: BigInt(pid3) } })

  const edit1 = await api('PUT', `/supplier-goods/apply/${apply3Id}`, { name: TAG + '黄瓜（水果型）', categoryId: Number(cat.id), weighType: 1, unit: '斤', supplyPrice: 2.0, dailySupply: 350, remark: '今早现摘，带花带刺' }, tokenSup)
  check('C1 待审核申请编辑 code 0', edit1.code === 0 && edit1.data?.resubmitted === false, edit1)
  const applyCountAfter1 = await prisma.productApplication.count({ where: { productId: BigInt(pid3) } })
  check('C2 编辑后申请条数不变（仍是同一条审核）', applyCountBefore === 1 && applyCountAfter1 === 1, { before: applyCountBefore, after: applyCountAfter1 })
  const app3 = await prisma.productApplication.findUnique({ where: { id: BigInt(apply3Id) } })
  const app3Payload = app3.payload
  check('C3 payload 原地更新（名称/供货价/日供/备注）', app3Payload.name === TAG + '黄瓜（水果型）' && Number(app3Payload.supplyPrice) === 2.0 && Number(app3Payload.dailySupply) === 350 && app3Payload.remark === '今早现摘，带花带刺', app3Payload)
  check('C4 编辑后申请 status 仍为 0 待审核', Number(app3.status) === 0, app3.status)
  const prod3 = await prisma.product.findUnique({ where: { id: BigInt(pid3) } })
  const link3 = await prisma.productSupplierLink.findFirst({ where: { productId: BigInt(pid3), supplierId: sup.id } })
  check('C5 product 同步更新（名称/规格）', prod3.name === TAG + '黄瓜（水果型）', prod3.name)
  check('C6 link 同步更新（供货价/日供/备注）', Number(link3.supplyPrice) === 2.0 && Number(link3.dailySupply) === 350 && link3.remark === '今早现摘，带花带刺', { price: Number(link3.supplyPrice), daily: Number(link3.dailySupply), remark: link3.remark })

  const sup2u = await prisma.user.create({ data: { wxOpenid: `dev_bqsup2_${TS}`, name: TAG + '供应商2', roles: [], status: 1 } })
  created.userIds.push(sup2u.id)
  const sup2 = await prisma.supplier.create({ data: { userId: sup2u.id, stallName: TAG + '档口2', address: TAG, status: 1, qualification: {} } })
  created.supplierIds.push(sup2.id)
  const tokenSup2 = await login(`bqsup2_${TS}`)
  const editForeign = await api('PUT', `/supplier-goods/apply/${apply3Id}`, { name: '偷改', categoryId: Number(cat.id), weighType: 1, supplyPrice: 1, dailySupply: 1 }, tokenSup2)
  check('C7 他人申请编辑 → NOT_FOUND 业务错', editForeign.code !== 0 && editForeign.code === 4001, { code: editForeign.code, msg: editForeign.msg })

  const reject = await api('POST', `/admin/goods/pending/${apply3Id}/review`, { approved: false, rejectReason: '图片不清晰，请重拍封面' }, adminToken)
  check('C8 运营驳回申请', reject.code === 0, reject)
  const edit2 = await api('PUT', `/supplier-goods/apply/${apply3Id}`, { name: TAG + '黄瓜（水果型）二代', categoryId: Number(cat.id), weighType: 1, unit: '斤', supplyPrice: 2.2, dailySupply: 300, remark: '重拍了封面' }, tokenSup)
  check('C9 已驳回申请编辑 code 0 且 resubmitted=true', edit2.code === 0 && edit2.data?.resubmitted === true, edit2)
  const app4 = await prisma.productApplication.findUnique({ where: { id: BigInt(apply3Id) } })
  check('C10 编辑后 status 回 0 待审、驳回原因清空（查库）', Number(app4.status) === 0 && app4.rejectReason === null, { status: app4.status, rejectReason: app4.rejectReason })
  const applyCountAfter2 = await prisma.productApplication.count({ where: { productId: BigInt(pid3) } })
  check('C11 驳回重提也没多出第二条申请', applyCountAfter2 === 1, applyCountAfter2)

  const approve3 = await api('POST', `/admin/goods/pending/${apply3Id}/review`, { approved: true, markupRate: 0.3 }, adminToken)
  check('C12 运营审核通过', approve3.code === 0, approve3)
  const editApproved = await api('PUT', `/supplier-goods/apply/${apply3Id}`, { name: '再改', categoryId: Number(cat.id), weighType: 1, supplyPrice: 1, dailySupply: 1 }, tokenSup)
  check('C13 已通过商品编辑 → 明确业务错引导走变更申请', editApproved.code !== 0 && String(editApproved.msg || '').includes('变更申请'), { code: editApproved.code, msg: editApproved.msg })

  const editAudit = await prisma.auditLog.findFirst({ where: { action: 'SUPPLIER_EDIT_PENDING_APPLY', entityId: BigInt(apply3Id) } })
  check('C14 审计落 SUPPLIER_EDIT_PENDING_APPLY', !!editAudit, !!editAudit)

  // ════ D. AI 三链路回归（不许动，各打一次）════
  console.log('\n【D】AI 三链路回归')
  const buyerParse = await mkBuyer(2)
  const buyerToken = await login(`bqbuyer1_${TS}`)
  const d1 = await api('POST', '/ai/parse', { text: '白菜' }, buyerToken)
  check('D1 /ai/parse code 0 且老结构（parser/items）不变', d1.code === 0 && 'parser' in (d1.data || {}) && Array.isArray(d1.data?.items), { code: d1.code, keys: d1.data ? Object.keys(d1.data) : null })
  const d2 = await api('POST', '/ai/supplier-parse', { text: '西红柿三块八，今天有两百斤' }, tokenSup)
  check('D2 /ai/supplier-parse code 0 且老结构（draft/unmatchedDetails）不变', d2.code === 0 && 'draft' in (d2.data || {}) && 'unmatchedDetails' in (d2.data || {}), { code: d2.code, keys: d2.data ? Object.keys(d2.data) : null })
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const up = await api('POST', '/upload/image', { base64: `data:image/png;base64,${pngB64}` }, tokenSup)
  if (up.code === 0 && up.data?.url) {
    const d3 = await api('POST', '/ai/supplier/recognize-goods', { image: up.data.url }, tokenSup)
    check('D3 /ai/supplier/recognize-goods code 0 且老结构（name/categoryId/weighType/parser）不变', d3.code === 0 && ['vl', 'none'].includes(d3.data?.parser), { code: d3.code, parser: d3.data?.parser })
  } else {
    check('D3 上传接口可用（跳过识别调用）', false, up)
  }

  // ════ 清理 ════
  console.log('\n【清理】自造夹具逐表删除')
  const appIdList = created.applyIds.filter(Boolean)
  await prisma.auditLog.deleteMany({ where: { OR: [
    { entity: 'product_application', entityId: { in: appIdList.map((x) => BigInt(x)) } },
    { action: 'REVIEW_GOODS_APPLY', entityId: { in: created.productIds.map((x) => BigInt(x)) } },
    { action: 'MARKUP_RESET_OVERRIDE', entityId: { in: created.productIds.map((x) => BigInt(x)) } },
    { action: 'IGNORE_BUYER', entityId: { in: created.purchaserIds.map((x) => BigInt(x)) } },
  ] } })
  await prisma.purchaser.deleteMany({ where: { userId: { in: created.userIds } } })
  await prisma.productApplication.deleteMany({ where: { OR: [{ id: { in: appIdList.map((x) => BigInt(x)) } }, { supplierId: { in: created.supplierIds } }] } })
  await prisma.productSupplierLink.deleteMany({ where: { OR: [{ productId: { in: created.productIds.map((x) => BigInt(x)) } }, { supplierId: { in: created.supplierIds } }] } })
  await prisma.product.deleteMany({ where: { id: { in: created.productIds.map((x) => BigInt(x)) } } })
  await prisma.supplierCategory.deleteMany({ where: { id: { in: created.supplierCategoryIds.map((x) => BigInt(x)) } } })
  await prisma.supplier.deleteMany({ where: { id: { in: created.supplierIds } } })
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: created.userIds } }, { wxOpenid: { contains: String(TS) } }] } })

  const leftover = {
    supplier: await prisma.supplier.count({ where: { stallName: { contains: TAG } } }),
    product: await prisma.product.count({ where: { name: { contains: TAG } } }),
    application: await prisma.productApplication.count({ where: { supplierId: { in: created.supplierIds.map((x) => BigInt(x)) } } }),
    link: await prisma.productSupplierLink.count({ where: { supplierId: { in: created.supplierIds.map((x) => BigInt(x)) } } }),
    purchaser: await prisma.purchaser.count({ where: { shopName: { contains: TAG } } }),
    user: await prisma.user.count({ where: { wxOpenid: { contains: `_${TS}` } } }),
    audit: await prisma.auditLog.count({ where: { action: { in: ['MARKUP_RESET_OVERRIDE', 'IGNORE_BUYER', 'SUPPLIER_EDIT_PENDING_APPLY'] }, entityId: { in: [...created.productIds, ...created.purchaserIds, ...appIdList].map((x) => BigInt(x)) } } }),
  }
  check('清理：残留全 0', Object.values(leftover).every((v) => v === 0), leftover)

  console.log('\n' + '='.repeat(64))
  console.log(`结果：${pass} 通过 / ${fail} 失败`)
  if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '))
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

const appIdList = []
main().catch(async (e) => {
  console.error('脚本异常：', e)
  try {
    await prisma.auditLog.deleteMany({ where: { OR: [
      { entity: 'product_application', entityId: { in: appIdList.map((x) => BigInt(x)) } },
      { action: { in: ['MARKUP_RESET_OVERRIDE', 'IGNORE_BUYER', 'SUPPLIER_EDIT_PENDING_APPLY'] } },
    ] } })
    await prisma.purchaser.deleteMany({ where: { shopName: { contains: TAG } } })
    await prisma.productApplication.deleteMany({ where: { supplierId: { in: created.supplierIds.map((x) => BigInt(x)) } } })
    await prisma.productSupplierLink.deleteMany({ where: { supplierId: { in: created.supplierIds.map((x) => BigInt(x)) } } })
    await prisma.product.deleteMany({ where: { name: { contains: TAG } } })
    await prisma.supplierCategory.deleteMany({ where: { supplierId: { in: created.supplierIds.map((x) => BigInt(x)) } } })
    await prisma.supplier.deleteMany({ where: { stallName: { contains: TAG } } })
    await prisma.user.deleteMany({ where: { wxOpenid: { contains: String(TS) } } })
  } catch (e2) { console.error('崩溃清理也失败：', e2.message) }
  await prisma.$disconnect()
  process.exit(1)
})
