/**
 * 卡AC（2026-09-30）· 采购方自助注销账号 —— 端到端自测
 *
 * 覆盖（任务书第五节 2）：
 *   ① 有进行中订单 → canCancel=false + blocker 类型/条数正确；POST cancel 被拒且**库未变**
 *   ② 未结清账款（COD 已送达未收）→ bill blocker 出现，金额正确
 *   ③ 推到「已送达且已付」（pay-status 四档判定为 paid_wechat / paid_proof）→ canCancel=true
 *      → 注销 → 逐项断言：user.name/phone=null、purchaser PII 全空、accountStatus=6、
 *        cart_item 清零、旧 purchaser.userId 指向新建的回收站用户、
 *        audit 恰好 1 行 BUYER_ACCOUNT_CANCEL 且**内容不含姓名/电话/执照号/地址**
 *   ④ 重新注册：同一微信走注册接口 → 新 purchaser 行；旧订单 purchaserId 未变；新采购方看不到旧订单
 *   ⑤ confirm 缺失 / false / 非布尔 → 参数错
 *   ⑥ 非采购方身份 / 未登录 → 按既有约定被拒
 *   ⑦ 跑完清理自造数据，并给出「清理后残留 = 0」的证据
 *
 * 用法（backend 目录）：
 *   node scripts/account-cancel-test.js
 *   AC_TEST_BASE=http://127.0.0.1:3011/api/v1 node scripts/account-cancel-test.js
 *
 * ⚠️ 前置：后端已起（3001）且 WX_MOCK_LOGIN=1（mock 登录下 code → openid 规则为 dev_<code>）
 */
const BASE = process.env.AC_TEST_BASE || 'http://127.0.0.1:3001/api/v1'
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail !== undefined ? `  → 实际：${JSON.stringify(detail)}` : ''}`) }
}
const round2 = (n) => Math.round(Number(n) * 100) / 100

const call = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

/// mock 登录：openid = dev_<code>（见 auth.service.code2session）
const login = async (code) => {
  const r = await call('/auth/wx-login', { method: 'POST', body: { code } })
  if (r.body.code !== 0) throw new Error(`登录失败(${code})：${JSON.stringify(r.body)}`)
  return r.body.data
}

const TS = Date.now()
const SUFFIX = String(TS).slice(-8)
/// 自造数据的自识别标记，清理与「残留=0」复核都靠它
const USER_OPENID = `dev_ac_${TS}`          // 主账号（要被注销的采购方）
const USER2_OPENID = `dev_ac2_${TS}`        // 对照组（有档案、无订单，用来验 confirm 参数校验）
const LICENSE = `ACLIC${SUFFIX}`            // 执照号（审计里绝不能出现）
const SHOP = '卡AC测试餐馆'
const CONTACT = '张三丰'                     // 姓名（审计里绝不能出现）
const PHONE = '139' + String(TS).slice(-8)   // 手机号（审计里绝不能出现）
const ADDRESS = '卡AC测试地址88号'           // 地址（审计里绝不能出现）
const PHONE2 = '138' + String(TS).slice(-8)

/// 自造主键，清理与残留复核用
const created = {
  userIds: [], purchaserIds: [], orderIds: [], payNos: [], cartIds: [], auditIds: [], productId: null,
}

const main = async () => {
  console.log(`\n═══ 卡AC 采购方自助注销自测 · BASE=${BASE} ═══\n`)

  // ────────────────────────────────────────
  // 0. 准备 fixture（全部自造、带标记，便于彻底清理）
  // ────────────────────────────────────────
  console.log('【0】准备自造数据')
  const user = await prisma.user.create({
    data: { wxOpenid: USER_OPENID, name: CONTACT, phone: PHONE, roles: [], status: 1 },
  })
  created.userIds.push(user.id)

  const purchaser = await prisma.purchaser.create({
    data: {
      userId: user.id, shopName: SHOP, contact: CONTACT, phone: PHONE, address: ADDRESS,
      deliveryWindows: ['中 10-13'], qualification: { note: '临时资质' },
      businessLicenseNo: LICENSE, businessLicenseImg: '/uploads/tmp_lic.jpg', foodPermitImg: '/uploads/tmp_permit.jpg',
      accountStatus: 2,
    },
  })
  created.purchaserIds.push(purchaser.id)

  // 对照组：有档案、无任何订单（用于 confirm 参数校验 + 非采购方对照）
  const user2 = await prisma.user.create({ data: { wxOpenid: USER2_OPENID, name: '对照用户', phone: PHONE2, roles: [], status: 1 } })
  created.userIds.push(user2.id)
  const purchaser2 = await prisma.purchaser.create({
    data: { userId: user2.id, shopName: '对照组餐馆', contact: '李四', phone: PHONE2, address: '对照地址', accountStatus: 2 },
  })
  created.purchaserIds.push(purchaser2.id)

  // 购物车：挂一个已存在的在售商品（不新建商品，避免污染商品表）
  const product = await prisma.product.findFirst({ where: { status: 1 } })
  if (product) {
    const cart = await prisma.cartItem.create({ data: { userId: user.id, productId: product.id, qty: 2 } })
    created.cartIds.push(cart.id)
    created.productId = product.id
  }

  // 订单：两个「进行中」（30 备货中 / 10 待确认）—— 注销的第一道门槛
  const mkOrder = async (status, amountOrdered, deliveryFee = 0, payMethod = 0) =>
    prisma.order.create({
      data: {
        purchaserId: purchaser.id, deliveryDate: new Date(), timeWindow: 2,
        status, amountOrdered, deliveryFee, payMethod,
      },
    })
  const o1 = await mkOrder(30, 100, 10)   // 备货中
  const o2 = await mkOrder(10, 50, 0)     // 待确认
  created.orderIds.push(o1.id, o2.id)
  console.log(`  自造：user=${Number(user.id)} purchaser=${Number(purchaser.id)} 订单=[${Number(o1.id)},${Number(o2.id)}] 购物车=${created.cartIds.length}`)

  const token = (await login(`ac_${TS}`)).token
  console.log(`  登录成功（openid=${USER_OPENID}）\n`)

  // ────────────────────────────────────────
  // 1. 有进行中订单 → 不可注销
  // ────────────────────────────────────────
  console.log('【1】有进行中订单 → canCancel=false，blocker 类型/条数正确')
  let r = await call('/buyer/account/cancel-eligibility', { token })
  console.log('  ' + JSON.stringify(r.body))
  check('1.1 eligibility 返回 code=0', r.body.code === 0, r.body)
  check('1.2 canCancel=false', r.body.data?.canCancel === false, r.body.data)
  const bOrders = (r.body.data?.blockers || []).find((b) => b.type === 'orders')
  check('1.3 存在 orders 型 blocker 且 count=2', !!bOrders && bOrders.count === 2, r.body.data?.blockers)
  check('1.4 orders blocker 文案含「2 个」', !!bOrders && /2 个/.test(bOrders.label || ''), bOrders?.label)
  check('1.5 进行中订单不算「未结清账款」（无 bill blocker）',
    !(r.body.data?.blockers || []).some((b) => b.type === 'bill'), r.body.data?.blockers)

  console.log('\n【2】不满足条件时 POST cancel → 业务错且**库未变**')
  const beforeUser = await prisma.user.findUnique({ where: { id: user.id } })
  const beforeAudit = await prisma.auditLog.count({ where: { entity: 'purchaser', entityId: purchaser.id } })
  r = await call('/buyer/account/cancel', { method: 'POST', token, body: { confirm: true } })
  console.log('  ' + JSON.stringify(r.body))
  check('2.1 被拒（code≠0）', r.body.code !== 0, r.body)
  check('2.2 拒因文案点出「进行中」', /进行中|订单/.test(r.body.msg || ''), r.body.msg)
  const afterP = await prisma.purchaser.findUnique({ where: { id: purchaser.id } })
  const afterU = await prisma.user.findUnique({ where: { id: user.id } })
  check('2.3 purchaser.accountStatus 未变(=2)', afterP.accountStatus === 2, afterP.accountStatus)
  check('2.4 purchaser.shopName 未变', afterP.shopName === SHOP, afterP.shopName)
  check('2.5 user.name 未变', afterU.name === CONTACT, afterU.name)
  check('2.6 user.phone 未变', afterU.phone === PHONE, afterU.phone)
  check('2.7 审计无新增', (await prisma.auditLog.count({ where: { entity: 'purchaser', entityId: purchaser.id } })) === beforeAudit)
  check('2.8 购物车未被清', (await prisma.cartItem.count({ where: { userId: user.id } })) === created.cartIds.length)

  // ────────────────────────────────────────
  // 3. 推到「已送达」但 COD 未收 → bill blocker
  // ────────────────────────────────────────
  console.log('\n【3】订单已送达(60)但货到付款未收（cod_pending）→ bill blocker 出现且金额正确')
  await prisma.order.update({ where: { id: o1.id }, data: { status: 60, payMethod: 2, amountFinal: 108.5 } })
  await prisma.order.update({ where: { id: o2.id }, data: { status: 70, payMethod: 2, amountFinal: 50 } })
  r = await call('/buyer/account/cancel-eligibility', { token })
  console.log('  ' + JSON.stringify(r.body))
  check('3.1 canCancel=false', r.body.data?.canCancel === false, r.body.data)
  const bBill = (r.body.data?.blockers || []).find((b) => b.type === 'bill')
  check('3.2 存在 bill 型 blocker 且 count=2', !!bBill && bBill.count === 2, r.body.data?.blockers)
  check('3.3 bill 金额 = 108.50+50.00 = 158.50', !!bBill && round2(bBill.amount) === 158.5, bBill?.amount)
  check('3.4 bill 文案含「¥158.50」', !!bBill && /¥158\.50/.test(bBill.label || ''), bBill?.label)
  check('3.5 已送达后不再有 orders blocker', !(r.body.data?.blockers || []).some((b) => b.type === 'orders'), r.body.data?.blockers)

  // ────────────────────────────────────────
  // 4. 推到「已付」（复用既有 pay-status 四档判定）→ 可注销
  // ────────────────────────────────────────
  console.log('\n【4】推到已付：o1 线上已到账(paid_wechat) / o2 配送员凭证(paid_proof) → canCancel=true')
  const payNo = 'ac' + require('crypto').randomBytes(14).toString('hex')
  created.payNos.push(payNo)
  await prisma.paymentRecord.create({
    data: { orderId: o1.id, payNo, channel: 'wechat', amount: 108.5, status: 1, paidAt: new Date() },
  })
  await prisma.order.update({ where: { id: o2.id }, data: { payProof: { photos: ['/uploads/tmp_proof.jpg'], courierId: 1 } } })
  r = await call('/buyer/account/cancel-eligibility', { token })
  console.log('  ' + JSON.stringify(r.body))
  check('4.1 canCancel=true', r.body.data?.canCancel === true, r.body.data)
  check('4.2 blockers 为空', (r.body.data?.blockers || []).length === 0, r.body.data?.blockers)

  // ────────────────────────────────────────
  // 5. 注销 → 逐项断言
  // ────────────────────────────────────────
  console.log('\n【5】执行注销 → 逐项断言')
  r = await call('/buyer/account/cancel', { method: 'POST', token, body: { confirm: true } })
  console.log('  ' + JSON.stringify(r.body))
  check('5.1 返回 code=0', r.body.code === 0, r.body)
  check('5.2 cancelled=true', r.body.data?.cancelled === true, r.body.data)

  const uAfter = await prisma.user.findUnique({ where: { id: user.id } })
  check('5.3 user.name 置 null', uAfter.name === null, uAfter.name)
  check('5.4 user.phone 置 null', uAfter.phone === null, uAfter.phone)

  const pAfter = await prisma.purchaser.findUnique({ where: { id: purchaser.id } })
  check('5.5 purchaser.shopName=已注销账号', pAfter.shopName === '已注销账号', pAfter.shopName)
  check('5.6 contact/phone/address 清空', pAfter.contact === '' && pAfter.phone === '' && pAfter.address === '',
    { contact: pAfter.contact, phone: pAfter.phone, address: pAfter.address })
  check('5.7 qualification / 执照号 / 执照图 / 食品证图 清空',
    pAfter.qualification === null && pAfter.businessLicenseNo === null && pAfter.businessLicenseImg === null && pAfter.foodPermitImg === null,
    { q: pAfter.qualification, lic: pAfter.businessLicenseNo })
  check('5.8 deliveryWindows 清空', pAfter.deliveryWindows === null, pAfter.deliveryWindows)
  check('5.9 accountStatus=6（已注销）', pAfter.accountStatus === 6, pAfter.accountStatus)
  check('5.10 购物车已清零', (await prisma.cartItem.count({ where: { userId: user.id } })) === 0)
  check('5.11 旧 purchaser.userId 已改指（≠原 userId）', pAfter.userId !== user.id, { old: Number(user.id), now: Number(pAfter.userId) })

  const trash = await prisma.user.findUnique({ where: { id: pAfter.userId } })
  created.userIds.push(trash.id)
  check('5.12 指向的是新建的回收站用户（wx_openid 以 cancelled_ 开头）', /^cancelled_/.test(trash.wxOpenid || ''), trash.wxOpenid)
  check('5.13 回收站用户 name=已注销 / status=0 / roles=[]',
    trash.name === '已注销' && trash.status === 0 && JSON.stringify(trash.roles) === '[]',
    { name: trash.name, status: trash.status, roles: trash.roles })
  check('5.14 回收站用户 wx_openid 不可猜（长度≥20 的随机串）', (trash.wxOpenid || '').length >= 20, trash.wxOpenid)

  // 审计：恰好 1 行，且不含任何 PII
  const audits = await prisma.auditLog.findMany({
    where: { entity: 'purchaser', entityId: purchaser.id, action: 'BUYER_ACCOUNT_CANCEL' },
  })
  created.auditIds.push(...audits.map((a) => a.id))
  check('5.15 审计恰好 1 行 BUYER_ACCOUNT_CANCEL', audits.length === 1, audits.length)
  const auditTxt = audits.length ? JSON.stringify(audits[0].before) + JSON.stringify(audits[0].after) : ''
  console.log('  审计内容：' + auditTxt)
  check('5.16 审计不含姓名', !auditTxt.includes(CONTACT), auditTxt)
  check('5.17 审计不含手机号', !auditTxt.includes(PHONE), auditTxt)
  check('5.18 审计不含执照号', !auditTxt.includes(LICENSE), auditTxt)
  check('5.19 审计不含地址', !auditTxt.includes(ADDRESS), auditTxt)
  check('5.20 审计记了状态跃迁 2→6', audits.length === 1 && audits[0].before?.accountStatus === 2 && audits[0].after?.accountStatus === 6,
    audits[0] ? { before: audits[0].before, after: audits[0].after } : null)

  // ────────────────────────────────────────
  // 6. 重新注册（同一微信）
  // ────────────────────────────────────────
  console.log('\n【6】同一微信重新注册 → 新 purchaser 行；旧订单归属不变；新采购方看不到旧订单')
  const reToken = (await login(`ac_${TS}`)).token
  const reProfile = await call('/auth/profile', { token: reToken })
  check('6.1 注销后 profile.purchaser 为 null（无采购方档案）', reProfile.body.data?.purchaser === null, reProfile.body.data?.purchaser)

  const NEW_PHONE = '137' + String(Date.now()).slice(-8)
  r = await call('/buyer/register', {
    method: 'POST', token: reToken,
    body: { shopName: '重开餐馆', contact: '王五', phone: NEW_PHONE, address: '新地址1号', businessLicenseNo: `ACRELIC${SUFFIX}` },
  })
  console.log('  ' + JSON.stringify(r.body))
  check('6.2 重新注册成功（code=0）', r.body.code === 0, r.body)
  const newPurchaserId = r.body.data?.purchaserId
  check('6.3 新 purchaserId ≠ 旧 purchaserId', !!newPurchaserId && BigInt(newPurchaserId) !== purchaser.id, newPurchaserId)
  created.purchaserIds.push(BigInt(newPurchaserId))

  const o1After = await prisma.order.findUnique({ where: { id: o1.id } })
  const o2After = await prisma.order.findUnique({ where: { id: o2.id } })
  check('6.4 旧订单 purchaserId 未变（仍挂旧档案）',
    o1After.purchaserId === purchaser.id && o2After.purchaserId === purchaser.id,
    { o1: Number(o1After.purchaserId), o2: Number(o2After.purchaserId), 旧: Number(purchaser.id) })

  r = await call('/order?page=1&pageSize=50', { token: reToken })
  const list = r.body.data?.list || r.body.data?.orders || []
  const ids = (Array.isArray(list) ? list : []).map((o) => Number(o.orderId ?? o.id))
  console.log('  新采购方订单列表：' + JSON.stringify(ids))
  check('6.5 新采购方看不到旧订单', !ids.includes(Number(o1.id)) && !ids.includes(Number(o2.id)), ids)

  // ────────────────────────────────────────
  // 7. confirm 校验（对照组：有档案、无订单）
  // ────────────────────────────────────────
  console.log('\n【7】confirm 缺失 / false / 非布尔 → 参数错')
  const token2 = (await login(`ac2_${TS}`)).token
  for (const [name, body] of [
    ['7.1 缺省 confirm', {}],
    ['7.2 confirm=false', { confirm: false }],
    ['7.3 confirm="true"（字符串）', { confirm: 'true' }],
  ]) {
    const rr = await call('/buyer/account/cancel', { method: 'POST', token: token2, body })
    console.log(`  ${name} → ` + JSON.stringify(rr.body))
    check(name + ' → 参数错(1001)', rr.body.code === 1001, rr.body)
  }
  const p2 = await prisma.purchaser.findUnique({ where: { id: purchaser2.id } })
  check('7.4 对照组档案未被注销（accountStatus 仍 2）', p2.accountStatus === 2, p2.accountStatus)

  // ────────────────────────────────────────
  // 8. 权限：非采购方身份 / 未登录
  // ────────────────────────────────────────
  console.log('\n【8】非采购方身份 / 未登录 → 按既有约定被拒')
  const su = await login('demo_supplier')
  r = await call('/buyer/account/cancel-eligibility', { token: su.token })
  console.log('  供应商身份 GET → ' + JSON.stringify(r.body))
  check('8.1 供应商调 eligibility → 2002 无权限', r.body.code === 2002, r.body)
  r = await call('/buyer/account/cancel', { method: 'POST', token: su.token, body: { confirm: true } })
  console.log('  供应商身份 POST → ' + JSON.stringify(r.body))
  check('8.2 供应商调 cancel → 2002 无权限', r.body.code === 2002, r.body)
  r = await call('/buyer/account/cancel-eligibility', {})
  console.log('  未登录 GET → ' + JSON.stringify(r.body))
  check('8.3 未登录 → 2001', r.body.code === 2001, r.body)

  // ────────────────────────────────────────
  // 9. 清理 + 残留复核
  // ────────────────────────────────────────
  console.log('\n【9】清理自造数据 → 复核残留=0')
  await prisma.paymentRecord.deleteMany({ where: { payNo: { in: created.payNos } } })
  await prisma.cartItem.deleteMany({ where: { id: { in: created.cartIds } } })
  await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } })
  await prisma.auditLog.deleteMany({ where: { id: { in: created.auditIds } } })
  await prisma.purchaser.deleteMany({ where: { id: { in: created.purchaserIds } } })
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })

  const residue = {
    user: await prisma.user.count({ where: { OR: [{ id: { in: created.userIds } }, { wxOpenid: { in: [USER_OPENID, USER2_OPENID] } }, { wxOpenid: { startsWith: 'cancelled_' } }] } }),
    purchaser: await prisma.purchaser.count({ where: { id: { in: created.purchaserIds } } }),
    order: await prisma.order.count({ where: { id: { in: created.orderIds } } }),
    pay: await prisma.paymentRecord.count({ where: { payNo: { in: created.payNos } } }),
    cart: await prisma.cartItem.count({ where: { id: { in: created.cartIds } } }),
    audit: await prisma.auditLog.count({ where: { id: { in: created.auditIds } } }),
  }
  console.log('  清理后残留：' + JSON.stringify(residue))
  check('9.1 残留 user = 0', residue.user === 0, residue.user)
  check('9.2 残留 purchaser = 0', residue.purchaser === 0, residue.purchaser)
  check('9.3 残留 order = 0', residue.order === 0, residue.order)
  check('9.4 残留 payment_record = 0', residue.pay === 0, residue.pay)
  check('9.5 残留 cart_item = 0', residue.cart === 0, residue.cart)
  check('9.6 残留 audit_log = 0', residue.audit === 0, residue.audit)

  console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '))
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('\n💥 脚本异常：', e)
  console.error('⚠️ 自造数据可能未清理，请手工核对：', JSON.stringify({
    userIds: created.userIds.map(Number), purchaserIds: created.purchaserIds.map(Number),
    orderIds: created.orderIds.map(Number), payNos: created.payNos,
  }))
  await prisma.$disconnect()
  process.exit(2)
})
