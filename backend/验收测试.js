// 绿立方后端 · 全链路验收测试
// 运行：node 验收测试.js   （需后端已启动在 3001 端口）
const BASE = 'http://localhost:3001/api/v1'
const ts = Date.now()
let passed = 0, failed = 0

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name) }
  else { failed++; console.log('  ❌ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')) }
}

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

async function main() {
  console.log('='.repeat(50))
  console.log('绿立方后端 · 全链路验收测试')
  console.log('='.repeat(50) + '\n')

  // ── 1. 四角色登录 ──
  console.log('【1. 四角色登录】')
  const buyer = await call('POST', '/auth/wx-login', { code: 'buyer_' + ts })
  const admin = await call('POST', '/auth/wx-login', { code: 'admin' })
  const supplier = await call('POST', '/auth/wx-login', { code: 'demo_supplier' })
  const courier = await call('POST', '/auth/wx-login', { code: 'courier' })
  check('采购方登录', buyer.code === 0 && buyer.data.needRegister === true)
  check('运营登录', admin.code === 0 && admin.data.currentRole === 'admin')
  check('供应商登录', supplier.code === 0 && supplier.data.currentRole === 'supplier')
  check('配送员登录', courier.code === 0 && courier.data.currentRole === 'courier')
  const bt = buyer.data.token, at = admin.data.token, st = supplier.data.token, ct = courier.data.token

  // ── 2. 采购方注册 + 未激活拦截 ──
  console.log('\n【2. 注册与账号激活】')
  const reg = await call('POST', '/buyer/register', {
    shopName: '验收测试餐馆', contact: '测试员', phone: '139' + String(ts).slice(-8),
    address: '验收路 ' + (ts % 100) + ' 号',
  }, bt)
  check('采购方注册成功', reg.code === 0 && reg.data.accountStatus === 1)
  const deny = await call('POST', '/order', { deliveryDate: '2026-09-20', timeWindow: 1, items: [{ productId: 1, qty: 5 }] }, bt)
  check('未激活下单被拦截(3001)', deny.code === 3001)

  // 运营审核通过
  const pendingList = await call('GET', '/admin/buyers/pending?pageSize=50', null, at)
  const target = pendingList.data?.list?.find(p => p.shopName === '验收测试餐馆')
  check('运营看到待审核队列', !!target)
  const verify = await call('POST', `/admin/buyers/${target.purchaserId}/verify`, { methods: [1], result: 1 }, at)
  check('运营审核通过→激活', verify.data.accountStatus === 2)
  const relogin = await call('POST', '/auth/wx-login', { code: 'buyer_' + ts })
  const bt2 = relogin.data.token
  check('重新登录后账号已激活', relogin.data.accountStatus === 2)

  // ── 3. 浏览 + 加购 + 下单 ──
  console.log('\n【3. 逛 → 买】')
  const goods = await call('GET', '/product/list?pageSize=5', null, bt2)
  check('浏览商品(仅销售价)', goods.code === 0 && goods.data.list.length > 0 && goods.data.list[0].salePrice > 0 && !('supplyPrice' in goods.data.list[0]))
  const pid = goods.data.list[0].id
  const addCart = await call('POST', '/cart', { productId: pid, qty: 10 }, bt2)
  check('加购成功', addCart.code === 0)
  const order = await call('POST', '/order', { deliveryDate: '2026-09-20', timeWindow: 1, items: [{ productId: pid, qty: 10 }] }, bt2)
  check('下单成功(status=10)', order.code === 0 && order.data.status === 10)
  const orderId = order.data.orderId

  // ── 4. 拆单 ──
  console.log('\n【4. 核单拆单】')
  const preview = await call('GET', `/admin/order/${orderId}/split-preview`, null, at)
  check('拆单建议生成', preview.code === 0 && preview.data.length > 0)
  const split = await call('POST', `/admin/order/${orderId}/split`, {
    items: preview.data.map(p => ({ orderItemId: p.orderItemId, allocations: p.allocations.map(a => ({ supplierId: a.supplierId, qty: a.qty })) })),
  }, at)
  check('拆单(status=20)', split.data?.status === 20)

  // ── 5. 供应商备货申报（20→30）──
  console.log('\n【5. 供应商备货申报】')
  const stockList = await call('GET', '/supplier-fulfill/stock-list', null, st)
  const myItems = stockList.data?.find(o => o.orderId === orderId)?.items || []
  check('供应商看到备货单', myItems.length > 0)
  const declare = await call('POST', '/supplier-fulfill/declare', {
    orderId, items: myItems.map(i => ({ orderItemId: i.orderItemId, qtyDeclared: i.qtyOrdered })),
  }, st)
  check('申报成功(订单→30备货中)', declare.code === 0)

  // ── 6. 验收称重（30→40）──
  console.log('\n【6. 验收称重】')
  const orderDetail = await call('GET', `/order/${orderId}`, null, bt2)
  const itemId = orderDetail.data.items[0].orderItemId
  const weigh = await call('POST', `/admin/order/${orderId}/weighing`, { items: [{ orderItemId: itemId, qtyAccepted: 9.5 }] }, at)
  check('称重(status=40, 金额重算)', weigh.data?.status === 40 && weigh.data?.amountFinal < order.data.amountOrdered)

  // ── 7. 派送 + 交付 ──
  console.log('\n【7. 派送调度 + 配送交付】')
  // 称重已把订单推到 40，现在派单
  const dispatch = await call('POST', '/admin/dispatch', { courierId: 1, orderIds: [orderId] }, at)
  check('派单创建任务', dispatch.code === 0 && dispatch.data.taskId)
  const taskId = dispatch.data.taskId
  const tasks = await call('GET', '/courier/today-tasks', null, ct)
  check('配送员看到今日任务', tasks.data?.some(t => t.taskId === taskId))
  const pickup = await call('POST', `/courier/task/${taskId}/pickup`, {}, ct)
  check('扫码取货(订单→50)', pickup.code === 0)
  const deliver = await call('POST', `/courier/task/${taskId}/deliver`, { photos: ['a.jpg'], signature: 's.png' }, ct)
  check('交付确认(订单→60已送达)', deliver.code === 0)
  const markPaid = await call('POST', `/courier/order/${orderId}/mark-paid`, {}, ct)
  check('收款协助不返回金额', markPaid.code === 0 && !('amount' in (markPaid.data || {})))

  // ── 8. 采购方确认收货 → 结算 ──
  console.log('\n【8. 确认收货 + 结算】')
  const d2 = await call('GET', `/order/${orderId}`, null, bt2)
  const receive = await call('POST', `/order/${orderId}/receive`, {
    items: d2.data.items.map(i => ({ orderItemId: i.orderItemId, qtyReceived: 9, rejectQty: 0.5, rejectReason: '品质问题' })),
  }, bt2)
  check('确认收货(订单→70)+生成售后工单', receive.code === 0 && receive.data.aftersaleIds?.length > 0)
  const gen = await call('POST', '/admin/finance/generate', { period: '2026-09' }, at)
  check('生成结算单', gen.code === 0 && gen.data.generated > 0)
  const settle = await call('GET', '/supplier-finance/settlement/2026-09', null, st)
  check('供应商查结算单(含服务费行)', settle.code === 0 && settle.data.serviceFee >= 0)

  console.log('\n' + '='.repeat(50))
  console.log(`验收结果：✅ 通过 ${passed} 项 / ❌ 失败 ${failed} 项`)
  console.log('='.repeat(50))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('测试异常:', e); process.exit(1) })
