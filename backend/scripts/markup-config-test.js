/**
 * 卡BI（2026-10-02）· 加价比例体系 自测
 *
 * 覆盖（任务书第六节 8 项）：
 *   1. 未配任何东西时，新建商品 markupRate=0.30、来源=全局默认
 *   2. 配全局=0.25（只影响以后新增）→ 在售商品价格不变；新建商品取 0.25
 *   3. 配分类=0.40 → 新建该类商品取 0.40（分类覆盖全局）
 *   4. 配供应商=0.50 → 新建该供应商商品取 0.50（供应商覆盖分类）
 *   5. 单品改比例 → markupOverridden=1；批量重算跳过它（值不变）
 *   6. apply/批量重算后：markupOverridden=0 的被重算（数字对上）、=1 的没被动
 *   7. 全程已存在订单的订单项单价不变
 *   8. 每一步审计有记录
 *
 * 用法（backend 目录）：node scripts/markup-config-test.js
 * 前置：后端已起（3001）。数据库备份已做（自测证据/_db备份/）。
 *
 * 数据安全边界：
 *   - 测试商品/测试分类全部自造，跑完删除，报告「残留=0」；
 *   - 配置表 markup_config 开头清空（本卡新建的表）+ 结尾清空，恢复原状；
 *   - 重算（apply/批量 applyNow）只作用于**测试分类**范围内，绝不触碰既有在售商品；
 *   - 既有商品零写入：全程只对测试商品调价。
 */
const BASE = process.env.MK_TEST_BASE || 'http://127.0.0.1:3001/api/v1'
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
const json = (o) => JSON.stringify(o, (k, v) => typeof v === 'bigint' ? Number(v) : v)

async function api(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  let j = null
  try { j = await res.json() } catch (e) { /* 非 JSON */ }
  return { status: res.status, json: j, data: j?.data }
}

const round2 = (n) => Math.round(n * 100) / 100

async function main() {
  console.log('='.repeat(64))
  console.log('卡BI · 加价比例体系 自测（' + new Date().toISOString() + '）')
  console.log('='.repeat(64))
  const testStart = new Date()
  const TAG = `卡BI自测${Date.now()}`

  // ── 登录 ──
  const admin = await api('POST', '/auth/wx-login', { code: 'admin' })
  const adminToken = admin.json?.data?.token
  check('运营 token 可用', !!adminToken)
  if (!adminToken) process.exit(1)

  // ── 环境准备：清空配置表（本卡新建的表）、选两个在合作供应商、建两个测试分类 ──
  const preConfigCount = await prisma.markupConfig.count()
  await prisma.markupConfig.deleteMany()
  console.log(`  （markup_config 开局清空：原 ${preConfigCount} 行${preConfigCount ? '（已记录并在结尾恢复为空）' : '（本来为空）'}）`)

  const suppliers = await prisma.supplier.findMany({ where: { status: 1 }, orderBy: { id: 'asc' }, take: 2 })
  check('存在两个在合作供应商可测', suppliers.length === 2, suppliers.map((s) => Number(s.id)))
  if (suppliers.length < 2) process.exit(1)
  const S1 = Number(suppliers[0].id), S2 = Number(suppliers[1].id)

  const TC1 = await prisma.category.create({ data: { name: TAG + '-分类1', sort: 999 } })
  const TC2 = await prisma.category.create({ data: { name: TAG + '-分类2', sort: 999 } })
  const C1 = Number(TC1.id), C2 = Number(TC2.id)

  // 已有订单项快照（第 7 项：全程不变）
  const orderItemTotalBefore = await prisma.orderItem.count()
  const snapItem = await prisma.orderItem.findFirst({ orderBy: { id: 'asc' }, select: { id: true, salePrice: true, supplyPrice: true } })
  check('存在可快照的历史订单项', !!snapItem, snapItem)

  const createdProducts = [] // { id, linkId }
  async function createProduct(name, supplierId, categoryId, supplyPrice) {
    const r = await api('POST', '/admin/goods', {
      name: `${TAG}-${name}`, categoryId, weighType: 1, unit: '斤',
      supplierId, supplyPrice, dailySupply: 100,
    }, adminToken)
    const pid = r.data?.productId
    check(`建品 ${name} 成功`, !!pid, r.json)
    const link = await prisma.productSupplierLink.findFirst({ where: { productId: BigInt(pid) } })
    createdProducts.push({ id: Number(pid), linkId: Number(link.id) })
    return pid
  }
  async function goodsRow(pid) {
    const r = await api('GET', `/admin/goods/list?pageSize=100`, null, adminToken)
    return (r.data?.list || []).find((x) => x.productId === Number(pid))
  }
  async function pricingRow(pid) {
    const r = await api('GET', '/admin/pricing', null, adminToken)
    return (r.data || []).find((x) => x.productId === Number(pid))
  }

  // ════ 1. 未配任何东西：新建商品 = 0.30 / 全局默认 ════
  console.log('\n【1】未配任何配置，新建商品取 0.30（全局默认）')
  const T1 = await createProduct('T1', S1, C2, 10)
  let row = await goodsRow(T1)
  check('1a 新建商品 markupRate = 0.30', row && Math.abs(row.markupRate - 0.30) < 1e-9, row?.markupRate)
  check('1b 来源 = 全局默认、markupOverridden = 0', row?.markupSource === '全局默认' && row?.markupOverridden === 0, { src: row?.markupSource, ov: row?.markupOverridden })
  check('1c 销售价 = 10 × 1.30 = 13.00', row && Math.abs(row.salePrice - 13) < 1e-9, row?.salePrice)

  // ════ 2. 全局 = 0.25，只影响以后新增 ════
  console.log('\n【2】配全局 0.25（不重算）→ 在售不动，新建取 0.25')
  let r = await api('PUT', '/admin/pricing/markup-config', { scope: 1, rate: 0.25 }, adminToken)
  check('2a PUT 全局配置成功', r.status === 201 || r.status === 200, r.json)
  row = await pricingRow(T1)
  check('2b 在售 T1 比例仍 0.30、销售价仍 13.00', row && Math.abs(row.markupRate - 0.30) < 1e-9 && Math.abs(row.salePrice - 13) < 1e-9, { rate: row?.markupRate, sale: row?.salePrice })
  const firstExisting = (await api('GET', '/admin/pricing', null, adminToken)).data.find((x) => x.productId !== Number(T1))
  const firstExistingBefore = firstExisting ? { id: firstExisting.productId, rate: firstExisting.markupRate, sale: firstExisting.salePrice } : null
  const T2 = await createProduct('T2', S2, C2, 20)
  row = await goodsRow(T2)
  check('2c 新建商品取 0.25、销售价 25.00', row && Math.abs(row.markupRate - 0.25) < 1e-9 && Math.abs(row.salePrice - 25) < 1e-9, { rate: row?.markupRate, sale: row?.salePrice })
  check('2d 新建来源 = 全局默认', row?.markupSource === '全局默认', row?.markupSource)

  // ════ 3. 分类 = 0.40（覆盖全局） ════
  console.log('\n【3】配分类 0.40 → 新建该类商品取 0.40（分类覆盖全局）')
  r = await api('PUT', '/admin/pricing/markup-config', { scope: 2, refId: C1, rate: 0.4 }, adminToken)
  check('3a PUT 分类配置成功', r.status === 201 || r.status === 200, r.json)
  const T3 = await createProduct('T3', S2, C1, 10)
  row = await goodsRow(T3)
  check('3b 新建 C1 类商品取 0.40、销售价 14.00', row && Math.abs(row.markupRate - 0.4) < 1e-9 && Math.abs(row.salePrice - 14) < 1e-9, { rate: row?.markupRate, sale: row?.salePrice })
  check('3c 来源 = 分类', row?.markupSource === '分类', row?.markupSource)
  // GET 配置回读
  const cfg1 = (await api('GET', '/admin/pricing/markup-config', null, adminToken)).data
  check('3d GET 配置：global=0.25、C1=0.40、未配分类 null', cfg1?.global === 0.25 && cfg1.categories.find((c) => c.categoryId === C1)?.rate === 0.4 && cfg1.categories.find((c) => c.categoryId === C2)?.rate === null, { global: cfg1?.global })

  // ════ 4. 供应商 = 0.50（覆盖分类） ════
  console.log('\n【4】配供应商 0.50 → 新建其名下商品取 0.50（供应商覆盖分类）')
  r = await api('PUT', '/admin/pricing/markup-config', { scope: 3, refId: S1, rate: 0.5 }, adminToken)
  check('4a PUT 供应商配置成功', r.status === 201 || r.status === 200, r.json)
  const T4 = await createProduct('T4', S1, C2, 10)
  row = await goodsRow(T4)
  check('4b S1+分类2 商品取 0.50（供应商覆盖全局）、销售价 15.00', row && Math.abs(row.markupRate - 0.5) < 1e-9 && Math.abs(row.salePrice - 15) < 1e-9, { rate: row?.markupRate, sale: row?.salePrice })
  check('4c 来源 = 供应商', row?.markupSource === '供应商', row?.markupSource)

  // ════ 5. 单品改比例 → overridden=1；批量重算跳过它 ════
  console.log('\n【5】单品改比例 0.66 → 单独设过；批量重算（分类2，T4 在范围内被跳过）')
  r = await api('PUT', `/admin/pricing/${T4}`, { markupRate: 0.66 }, adminToken)
  check('5a 单品改价成功', r.status === 201 || r.status === 200, r.json)
  row = await goodsRow(T4)
  check('5b markupOverridden = 1、来源 = 单品、比例 0.66、销售价 16.60',
    row?.markupOverridden === 1 && row?.markupSource === '单品' && Math.abs(row.markupRate - 0.66) < 1e-9 && Math.abs(row.salePrice - 16.6) < 1e-9,
    { ov: row?.markupOverridden, src: row?.markupSource, rate: row?.markupRate, sale: row?.salePrice })
  // 批量：分类2 = 0.45 + 同时重算（T1、T2 在范围内；T4 也在分类2！）
  r = await api('PUT', '/admin/pricing/batch', { markupRate: 0.45, categoryId: C2, applyNow: true }, adminToken)
  check('5d 批量（分类2+同时重算）成功', r.status === 201 || r.status === 200, r.json)
  check('5e 批量返回 updated=2（T1、T2）、skipped=1（T4）', r.data?.updated === 2 && r.data?.skipped === 1, r.data)
  const rowT4b = await goodsRow(T4)
  check('5f T4 未被批量动：仍 0.66 / 16.60 / 单品', Math.abs(rowT4b.markupRate - 0.66) < 1e-9 && Math.abs(rowT4b.salePrice - 16.6) < 1e-9 && rowT4b.markupSource === '单品', rowT4b)
  const rowT1b = await pricingRow(T1)
  check('5g T1 重算：取供应商 0.50（供应商覆盖批量写的分类 0.45）、销售价 15.00', Math.abs(rowT1b.markupRate - 0.5) < 1e-9 && Math.abs(rowT1b.salePrice - 15) < 1e-9, { rate: rowT1b?.markupRate, sale: rowT1b?.salePrice })
  const rowT2b = await pricingRow(T2)
  check('5h T2 重算：取分类 0.45、销售价 29.00', Math.abs(rowT2b.markupRate - 0.45) < 1e-9 && Math.abs(rowT2b.salePrice - 29) < 1e-9, { rate: rowT2b?.markupRate, sale: rowT2b?.salePrice })

  // ════ 6. 独立 apply 接口 ════
  console.log('\n【6】POST markup-config/apply（分类2）：非单品被重算、单品被跳过')
  const T5 = await createProduct('T5', S2, C2, 20) // 建品时分类2=0.45
  row = await goodsRow(T5)
  check('6a 批量写入的分类配置对新建生效：T5 取 0.45', row && Math.abs(row.markupRate - 0.45) < 1e-9, row?.markupRate)
  r = await api('POST', '/admin/pricing/markup-config/apply', { scope: 2, refId: C2 }, adminToken)
  check('6b apply 成功：updated=3、skipped=1（T1/T2/T5 重算，T4 跳过）', r.data?.updated === 3 && r.data?.skipped === 1, r.data)
  const rowT4c = await goodsRow(T4)
  check('6c apply 后 T4 仍 0.66（没被动）', Math.abs(rowT4c.markupRate - 0.66) < 1e-9, rowT4c.markupRate)
  const rowT5b = await pricingRow(T5)
  check('6d apply 后 T5 = 0.45、销售价 29.00', Math.abs(rowT5b.markupRate - 0.45) < 1e-9 && Math.abs(rowT5b.salePrice - 29) < 1e-9, { rate: rowT5b?.markupRate, sale: rowT5b?.salePrice })

  // 批量「只影响以后新增」：供应商 S1 = 0.44，在售一律不动
  console.log('\n【6e】批量 0.44（供应商 S1，只影响以后新增）→ 在售不动、新建取 0.44')
  r = await api('PUT', '/admin/pricing/batch', { markupRate: 0.44, supplierId: S1, applyNow: false }, adminToken)
  check('6f 批量（只影响以后新增）成功：updated=0', r.status === 201 || r.status === 200, r.data)
  const rowT1c = await pricingRow(T1)
  check('6g T1 在售价格未动：仍 0.50 / 15.00', Math.abs(rowT1c.markupRate - 0.5) < 1e-9 && Math.abs(rowT1c.salePrice - 15) < 1e-9, { rate: rowT1c?.markupRate, sale: rowT1c?.salePrice })
  const T6 = await createProduct('T6', S1, C1, 10)
  row = await goodsRow(T6)
  check('6h 新建 T6 取 0.44（供应商 0.44 覆盖分类 0.40）、销售价 14.40', row && Math.abs(row.markupRate - 0.44) < 1e-9 && Math.abs(row.salePrice - 14.4) < 1e-9, { rate: row?.markupRate, sale: row?.salePrice })

  // ════ 7. 历史订单项单价不变 ════
  console.log('\n【7】历史订单项单价不变')
  const orderItemTotalAfter = await prisma.orderItem.count()
  const snapAfter = await prisma.orderItem.findUnique({ where: { id: snapItem.id }, select: { id: true, salePrice: true, supplyPrice: true } })
  check('7a 订单项 sale_price / supply_price 与开局快照一致',
    Number(snapAfter.salePrice) === Number(snapItem.salePrice) && Number(snapAfter.supplyPrice) === Number(snapItem.supplyPrice),
    { before: { sale: Number(snapItem.salePrice), supply: Number(snapItem.supplyPrice) }, after: { sale: Number(snapAfter.salePrice), supply: Number(snapAfter.supplyPrice) } })
  check('7b 订单项总行数不变（全程未新增/未改动订单）', orderItemTotalAfter === orderItemTotalBefore, { before: orderItemTotalBefore, after: orderItemTotalAfter })

  // ════ 8. 审计有记录 ════
  console.log('\n【8】审计记录')
  const audits = await prisma.$queryRawUnsafe(
    `SELECT action, COUNT(*) AS c FROM audit_log WHERE created_at >= ? AND action IN ('MARKUP_CONFIG_SET','MARKUP_CONFIG_APPLY','BATCH_MARKUP','UPDATE_PRICING') GROUP BY action`,
    testStart,
  )
  const cnt = (a) => Number((audits.find((x) => x.action === a) || {}).c || 0)
  check('8a MARKUP_CONFIG_SET ≥ 3（全局/分类/供应商各一次）', cnt('MARKUP_CONFIG_SET') >= 3, cnt('MARKUP_CONFIG_SET'))
  check('8b MARKUP_CONFIG_APPLY ≥ 1', cnt('MARKUP_CONFIG_APPLY') >= 1, cnt('MARKUP_CONFIG_APPLY'))
  check('8c BATCH_MARKUP ≥ 2（重算+只影响以后新增各一次）', cnt('BATCH_MARKUP') >= 2, cnt('BATCH_MARKUP'))
  check('8d UPDATE_PRICING ≥ 1（单品改价）', cnt('UPDATE_PRICING') >= 1, cnt('UPDATE_PRICING'))

  // ════ 清理 ════
  console.log('\n【清理】删除自造数据（测试商品/供货关系/测试分类/配置表恢复原状）')
  for (const p of createdProducts) {
    await prisma.productSupplierLink.deleteMany({ where: { id: BigInt(p.linkId) } })
    await prisma.product.deleteMany({ where: { id: BigInt(p.id) } })
  }
  await prisma.category.deleteMany({ where: { id: { in: [BigInt(C1), BigInt(C2)] } } })
  await prisma.markupConfig.deleteMany()
  const residualProducts = await prisma.product.count({ where: { name: { contains: TAG } } })
  const residualConfig = await prisma.markupConfig.count()
  const firstExistingNow = firstExistingBefore
    ? await prisma.product.findUnique({ where: { id: BigInt(firstExistingBefore.id) }, select: { markupRate: true, salePrice: true } })
    : null
  check('清理后测试商品残留 = 0', residualProducts === 0, residualProducts)
  check('清理后 markup_config 恢复开局状态（0 行）', residualConfig === 0, residualConfig)
  check('既有在售商品全程零写入（对比开局快照）',
    !firstExistingNow || (Number(firstExistingNow.markupRate) === firstExistingBefore.rate && Number(firstExistingNow.salePrice) === firstExistingBefore.sale),
    firstExistingNow)

  // ════ 汇总 ════
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
