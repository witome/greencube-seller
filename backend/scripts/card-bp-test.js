/**
 * 卡BP（2026-10-02）· 拍照快速上架（AI 识别）+ 供应商备注 自测
 *
 * 覆盖（验收对照表可自动化的部分）：
 *   A. sanitizeRecognize 纯函数（require dist）：越权分类丢弃 / weighType 1/2 白名单 / name 截断 / 垃圾输入
 *   B. POST /ai/supplier/recognize-goods：
 *      · 非 /uploads/ 地址 → 全空建议（parser none）
 *      · 真实视觉模型调用（DASHSCOPE key 在 .env、AI_PARSE_MODE=auto）→ 有建议或空建议、绝不 5xx
 *      · 采购方 token 调用 → 拒绝
 *   C. 备注全链路：
 *      · 新品申请带 remark（30 字）→ admin pending 可见 → 审核通过 → link.remark 写入
 *      · 新品 remark 31 字 → 校验拒绝
 *      · 变更申请改 remark → diffs 含「商品备注」→ 通过 → link.remark 更新
 *      · 采购商商品列表：主供货商（priority 最小）的备注优先；无备注 null
 *      · 供应商我的商品列表带 remark
 *   D. 回归：/ai/parse 只读接口行为不变（code 0、含 parser 字段）
 *
 * 用法（backend 目录）：node scripts/card-bp-test.js
 * 数据安全：夹具全部自造（TAG 可辨认），跑完逐表清理并断言残留 = 0。
 */
const BASE = process.env.BP_TEST_BASE || 'http://127.0.0.1:3001/api/v1'
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
const TAG = `卡BP自测${TS}`
const created = { userIds: [], supplierIds: [], productIds: [], categoryIds: [], supplierCategoryIds: [], applyIds: [], changeIds: [] }

async function main() {
  console.log('='.repeat(64))
  console.log('卡BP · 拍照上架 AI 识别 + 供应商备注 自测（' + new Date().toISOString() + '）')
  console.log('='.repeat(64))

  // ════ A. sanitizeRecognize 纯函数（服务端硬校验，不依赖提示词自觉）════
  console.log('\n【A】sanitizeRecognize 纯函数硬校验（require dist 真实现）')
  const dist = path.join(__dirname, '..', 'dist')
  const { sanitizeRecognize } = require(path.join(dist, 'modules', 'ai', 'vision-recognize.service.js'))
  const auth = new Map([['3', '根茎类'], ['7', '葱蒜类']])
  const s1 = sanitizeRecognize({ name: '山东大姜（老姜）', categoryId: 3, weighType: 1 }, auth)
  check('A1 授权内分类正常通过', s1.categoryId === 3 && s1.categoryName === '根茎类' && s1.name === '山东大姜（老姜）' && s1.weighType === 1, s1)
  const s2 = sanitizeRecognize({ name: '大葱', categoryId: 99, weighType: 1 }, auth)
  check('A2 越权分类被服务端丢弃（categoryId=null）', s2.categoryId === null && s2.categoryName === null && s2.name === '大葱', s2)
  const s3 = sanitizeRecognize({ name: '土豆', categoryId: 3, weighType: 3 }, auth)
  check('A3 weighType=3 被丢弃（只认 1/2）', s3.weighType === null && s3.categoryId === 3, s3)
  const longName = '超'.repeat(120)
  const s4 = sanitizeRecognize({ name: longName, categoryId: 3, weighType: 2 }, auth)
  check('A4 name 截断到 100 字', typeof s4.name === 'string' && s4.name.length === 100, s4.name?.length)
  const s5 = sanitizeRecognize('垃圾输入', auth)
  const s6 = sanitizeRecognize({ name: 123, categoryId: 'x', weighType: 'y' }, auth)
  check('A5 垃圾输入 → 全空建议', s5.name === null && s5.categoryId === null && s5.weighType === null, s5)
  check('A6 类型不对的字段 → 全空建议', s6.name === null && s6.categoryId === null && s6.weighType === null, s6)

  // ════ B. 识别接口 ════
  console.log('\n【B】POST /ai/supplier/recognize-goods')
  const cat = await prisma.category.findFirst({ orderBy: { id: 'asc' } })
  const mkSupplier = async (suffix, stall) => {
    const u = await prisma.user.create({ data: { wxOpenid: `dev_bp${suffix}_${TS}`, name: TAG + stall, roles: [], status: 1 } })
    created.userIds.push(u.id)
    const s = await prisma.supplier.create({ data: { userId: u.id, stallName: TAG + stall, address: TAG, status: 1, qualification: {} } })
    created.supplierIds.push(s.id)
    const sc = await prisma.supplierCategory.create({ data: { supplierId: s.id, categoryId: cat.id } })
    created.supplierCategoryIds.push(sc.id)
    return s
  }
  const supA = await mkSupplier('supa', '档口A')
  const supB = await mkSupplier('supb', '档口B')
  const tokenA = await login(`bpsupa_${TS}`)
  const tokenB = await login(`bpsupb_${TS}`)
  const adminToken = await login('admin')
  check('B0 夹具：两个供应商 + admin 登录', !!tokenA && !!tokenB && !!adminToken)

  const r1 = await api('POST', '/ai/supplier/recognize-goods', { image: 'http://evil.com/x.jpg' }, tokenA)
  check('B1 非本站 /uploads/ 地址 → code 0 且全空建议（不报错不阻断）', r1.code === 0 && r1.data.name === null && r1.data.categoryId === null && r1.data.weighType === null && r1.data.parser === 'none', r1)

  const r2 = await api('POST', '/ai/supplier/recognize-goods', { image: '/uploads/not_exist_9999.jpg' }, tokenA)
  check('B2 图片文件不存在 → 全空建议', r2.code === 0 && r2.data.parser === 'none', r2)

  const buyerProbe = await api('POST', '/ai/supplier/recognize-goods', { image: '/uploads/x.jpg' }, (await api('POST', '/auth/wx-login', { code: `bpbuy_${TS}` })).data?.token)
  check('B3 采购方（无 supplier 档案）调用 → 拒绝（403/401/2002 之一）', [403, 401].includes(buyerProbe.status) || buyerProbe.code === 2002, { status: buyerProbe.status, code: buyerProbe.code })

  // B4 真实视觉模型（可选通过）：造一张 1x1 PNG + 用 ImageGen 真图更佳；这里先用纯色 PNG 验证链路不炸
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const up = await api('POST', '/upload/image', { base64: `data:image/png;base64,${pngB64}` }, tokenA)
  if (up.code === 0 && up.data?.url) {
    const rr = await api('POST', '/ai/supplier/recognize-goods', { image: up.data.url }, tokenA)
    check('B4 真实视觉链路（1x1 占位图）→ code 0、结构合法（name/categoryId/weighType/parser）',
      rr.code === 0 && 'name' in rr.data && 'categoryId' in rr.data && 'weighType' in rr.data && ['vl', 'none'].includes(rr.data.parser), rr)
    check('B5 识别响应不含价格/可供量字段（AI 不碰价）',
      !('supplyPrice' in rr.data) && !('dailySupply' in rr.data) && !('salePrice' in rr.data), Object.keys(rr.data))
  } else {
    check('B4 上传接口可用（跳过真实视觉调用）', false, up)
  }

  // ════ C. 备注全链路 ════
  console.log('\n【C】备注：新品审核 → 变更审核 → 买家列表主供备注')
  const remark30 = '今天刚到的老姜，辣味足，带泥新鲜啊' // 恰 15 字 *2 = 30? 用固定 30 字
  const remark30Chars = '备'.repeat(30)
  const remark31Chars = '备'.repeat(31)

  const badApply = await api('POST', '/supplier-goods/apply', { name: TAG + '姜', categoryId: Number(cat.id), weighType: 1, supplyPrice: 2.2, dailySupply: 100, remark: remark31Chars }, tokenA)
  check('C1 remark 31 字 → 校验拒绝（400/1001）', badApply.status === 400 || badApply.code === 1001, { status: badApply.status, code: badApply.code, msg: badApply.msg })

  const apply = await api('POST', '/supplier-goods/apply', { name: TAG + '老姜', categoryId: Number(cat.id), weighType: 1, supplyPrice: 2.2, dailySupply: 100, remark: remark30Chars }, tokenA)
  check('C2 新品申请带 30 字备注 → 成功', apply.code === 0 && !!apply.data?.applyId, apply)
  created.applyIds.push(apply.data?.applyId)
  const productId = apply.data ? await (async () => {
    const a = await prisma.productApplication.findUnique({ where: { id: BigInt(apply.data.applyId) } })
    return Number(a.productId)
  })() : null
  created.productIds.push(productId)

  const pending = await api('GET', '/admin/goods/pending', null, adminToken)
  const pendingRow = (pending.data || []).find((x) => x.applyId === apply.data.applyId)
  check('C3 运营待审新品列表可见备注', !!pendingRow && pendingRow.remark === remark30Chars, pendingRow?.remark)

  const approve = await api('POST', `/admin/goods/pending/${apply.data.applyId}/review`, { approved: true, markupRate: 0.3 }, adminToken)
  check('C4 审核通过', approve.code === 0, approve)
  const linkA = await prisma.productSupplierLink.findUnique({ where: { productId_supplierId: { productId: BigInt(productId), supplierId: supA.id } } })
  check('C5 审核通过后备注写入 link 记录', linkA && linkA.remark === remark30Chars, linkA?.remark)
  check('C6 link.priority=9（次供），为「多供取主供」测试做准备', Number(linkA.priority) === 9, linkA.priority)

  // 多供货商：supB 用变更接口不行（商品不属于他）→ 直接造 supB 的 link（priority 1 主供 + 另一条备注）
  const linkB = await prisma.productSupplierLink.create({
    data: { productId: BigInt(productId), supplierId: supB.id, supplyPrice: 2.0, dailySupply: 80, priority: 1, status: 1, remark: 'B档口主供备注' },
  })
  check('C7 夹具：supB 主供 link（priority 1）已建', !!linkB)

  // 买家列表：主供（supB）备注优先（买家夹具带 purchaser 档案 + 激活态，过角色守卫与价格可见口径）
  const buyerUser = await prisma.user.create({ data: { wxOpenid: `dev_bpbuyer2_${TS}`, name: TAG + '买家', roles: [], status: 1 } })
  created.userIds.push(buyerUser.id)
  await prisma.purchaser.create({ data: { userId: buyerUser.id, shopName: TAG + '餐馆', contact: '卡BP', phone: '138' + String(TS).slice(-8), address: TAG + '地址', deliveryWindows: ['中 10-13'], accountStatus: 2 } })
  const buyerToken = await login(`bpbuyer2_${TS}`)
  const list = await api('GET', '/product/list?page=1&pageSize=50', null, buyerToken)
  const row = (list.data?.list || []).find((x) => x.id === productId)
  check('C8 买家列表灰字位取主供货商（priority 最小）备注', !!row && row.remark === 'B档口主供备注', row?.remark)

  // 无备注商品 → remark null（前端回退称重/规格）
  const noRemarkProduct = await prisma.product.findFirst({ where: { status: 1, id: { not: BigInt(productId) }, links: { none: { remark: { not: null } } } } })
  if (noRemarkProduct) {
    const row2 = (list.data?.list || []).find((x) => x.id === Number(noRemarkProduct.id))
    check('C9 无备注商品列表 remark=null（前端回退原逻辑）', row2 && row2.remark === null, row2?.remark)
  } else {
    check('C9 无备注商品列表 remark=null（无该类商品可对照，跳过）', true)
  }

  // 供应商我的商品列表带 remark
  const myListA = await api('GET', '/supplier-goods', null, tokenA)
  const myRowA = (myListA.data?.list || []).find((x) => x.id === productId)
  check('C10 供应商我的商品列表带本方 remark', !!myRowA && myRowA.remark === remark30Chars, myRowA?.remark)

  // 变更申请改备注 → diffs 含「商品备注」→ 通过 → link 更新
  const change = await api('POST', `/supplier-goods/${productId}/change`, { changes: { remark: '改后的备注' } }, tokenA)
  check('C11 变更申请可改备注', change.code === 0 && !!change.data?.changeId, change)
  created.changeIds.push(change.data?.changeId)
  const changePending = await api('GET', '/admin/goods/change-pending', null, adminToken)
  const cRow = (changePending.data || []).find((x) => x.changeId === change.data.changeId)
  const remarkDiff = (cRow?.diffs || []).find((d) => d.field === 'remark')
  check('C12 变更对照含「商品备注」行（旧值 → 新值）', !!remarkDiff && remarkDiff.fieldText === '商品备注' && remarkDiff.oldValue === remark30Chars && remarkDiff.newValue === '改后的备注', remarkDiff)
  const approveChange = await api('POST', `/admin/goods/change/${change.data.changeId}/review`, { approved: true }, adminToken)
  check('C13 变更审核通过', approveChange.code === 0, approveChange)
  const linkA2 = await prisma.productSupplierLink.findUnique({ where: { productId_supplierId: { productId: BigInt(productId), supplierId: supA.id } } })
  check('C14 变更通过后 link.remark 已更新（supA 的不影响 supB 的）', linkA2.remark === '改后的备注', linkA2.remark)
  const linkB2 = await prisma.productSupplierLink.findUnique({ where: { productId_supplierId: { productId: BigInt(productId), supplierId: supB.id } } })
  check('C15 supB 的备注未被 supA 变更覆盖（挂 link 而非全局）', linkB2.remark === 'B档口主供备注', linkB2.remark)

  // ════ D. 回归：/ai/parse 只读接口行为不变 ════
  console.log('\n【D】回归 /ai/parse（只读，行为不变）')
  const parse = await api('POST', '/ai/parse', { text: '白菜' }, buyerToken)
  check('D1 /ai/parse code 0 且结构含 parser/items（老字段没少）', parse.code === 0 && 'parser' in parse.data && Array.isArray(parse.data.items), { code: parse.code, keys: parse.data ? Object.keys(parse.data) : null })

  // ════ 清理 ════
  console.log('\n【清理】自造夹具逐表删除')
  const appIdList = created.applyIds.filter(Boolean)
  const changeIdList = created.changeIds.filter(Boolean)
  // 先删申请/变更/优先级测试造的 link，再删商品、授权、供应商、用户
  // （FK 顺序：audit → purchaser → supplierCategory → supplier → ... → user，purchaser 必须在 user 之前）
  await prisma.auditLog.deleteMany({ where: { OR: [
    { entity: 'product_application', entityId: { in: [...appIdList, ...changeIdList].map((x) => BigInt(x)) } },
    { action: 'REVIEW_GOODS_APPLY', entityId: { in: created.productIds.map((x) => BigInt(x)) } },
  ] } })
  await prisma.purchaser.deleteMany({ where: { userId: { in: created.userIds } } })
  await prisma.productApplication.deleteMany({ where: { OR: [{ id: { in: appIdList.map((x) => BigInt(x)) } }, { id: { in: changeIdList.map((x) => BigInt(x)) } }, { supplierId: { in: created.supplierIds } }] } })
  await prisma.productSupplierLink.deleteMany({ where: { OR: [{ productId: { in: created.productIds.map((x) => BigInt(x)) } }, { supplierId: { in: created.supplierIds } }] } })
  await prisma.product.deleteMany({ where: { id: { in: created.productIds.map((x) => BigInt(x)) } } })
  await prisma.supplierCategory.deleteMany({ where: { id: { in: created.supplierCategoryIds.map((x) => BigInt(x)) } } })
  await prisma.supplier.deleteMany({ where: { id: { in: created.supplierIds } } })
  // B3 探针是 mock 登录自动注册的用户（不在 created.userIds），按本次 TS 标记兜删
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: created.userIds } }, { wxOpenid: { contains: String(TS) } }] } })

  const leftover = {
    supplier: await prisma.supplier.count({ where: { stallName: { contains: TAG } } }),
    product: await prisma.product.count({ where: { name: { contains: TAG } } }),
    application: await prisma.productApplication.count({ where: { supplierId: { in: created.supplierIds } } }),
    link: await prisma.productSupplierLink.count({ where: { supplierId: { in: created.supplierIds } } }),
    user: await prisma.user.count({ where: { wxOpenid: { contains: `_${TS}` } } }),
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
  // 崩溃也要尽量清理
  try {
    await prisma.auditLog.deleteMany({ where: { OR: [
      { entity: 'product_application', entityId: { in: [...appIdList, ...changeIdList].map((x) => BigInt(x)) } },
      { action: 'REVIEW_GOODS_APPLY', entityId: { in: created.productIds.map((x) => BigInt(x)) } },
    ] } })
    await prisma.purchaser.deleteMany({ where: { userId: { in: created.userIds } } })
    await prisma.productApplication.deleteMany({ where: { OR: [{ id: { in: appIdList.map((x) => BigInt(x)) } }, { id: { in: changeIdList.map((x) => BigInt(x)) } }, { supplierId: { in: created.supplierIds } }] } })
    await prisma.productSupplierLink.deleteMany({ where: { OR: [{ productId: { in: created.productIds.map((x) => BigInt(x)) } }, { supplierId: { in: created.supplierIds } }] } })
    await prisma.product.deleteMany({ where: { id: { in: created.productIds.map((x) => BigInt(x)) } } })
    await prisma.supplierCategory.deleteMany({ where: { id: { in: created.supplierCategoryIds.map((x) => BigInt(x)) } } })
    await prisma.supplier.deleteMany({ where: { id: { in: created.supplierIds } } })
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })
  } catch (e2) { console.error('崩溃清理也失败：', e2.message) }
  await prisma.$disconnect()
  process.exit(1)
})
