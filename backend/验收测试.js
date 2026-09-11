// 绿立方后端 · 全链路验收测试
// 运行：node 验收测试.js   （需后端已启动在 3001 端口）
const BASE = 'http://localhost:3001/api/v1'
const ts = Date.now()
let passed = 0, failed = 0

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name) }
  else { failed++; console.log('  ❌ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')) }
}

// 前置条件不满足时中止（报 ❌ 明细而不是抛 TypeError），避免后续用例连锁误报
function abort(msg) {
  failed++
  console.log('  ❌ ' + msg)
  console.log('\n' + '='.repeat(50))
  console.log(`验收中止：✅ 通过 ${passed} 项 / ❌ 失败 ${failed} 项（未跑完）`)
  console.log('='.repeat(50))
  process.exit(1)
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
  // 手机号含 ts，全局唯一；用它匹配待审核记录，避免历史同名店铺干扰（店名固定会导致匹配到旧记录）
  const regPhone = '139' + String(ts).slice(-8)
  const reg = await call('POST', '/buyer/register', {
    shopName: '验收测试餐馆', contact: '测试员', phone: regPhone,
    address: '验收路 ' + (ts % 100) + ' 号',
  }, bt)
  check('采购方注册成功', reg.code === 0 && reg.data.accountStatus === 1)
  const deny = await call('POST', '/order', { deliveryDate: '2026-09-20', timeWindow: 1, items: [{ productId: 1, qty: 5 }] }, bt)
  check('未激活下单被拦截(3001)', deny.code === 3001)

  // 运营审核通过
  const pendingList = await call('GET', '/admin/buyers/pending?pageSize=50', null, at)
  const target = pendingList.data?.list?.find(p => p.phone === regPhone)
  check('运营看到待审核队列', !!target)
  if (!target) abort('待审核队列未找到本次注册记录(' + regPhone + ')，后续用例无法继续')
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

  // ── 4. 核单拆单（10 待确认 → 30 备货中）──
  // 状态机依据：《开发配套-数据模型与接口草案》第 206/223 行
  //   10 待确认 ──支付后自动拆单──> 30 备货中 ──供应商确认备货完成──> 40 待配送 ──派单──> 45 ──取货──> 50
  //   20「已拆单」为废弃态；无独立验收称重环节（30→40 由供应商确认备货完成触发）
  console.log('\n【4. 核单拆单】')
  const preview = await call('GET', `/admin/order/${orderId}/split-preview`, null, at)
  check('拆单建议生成', preview.code === 0 && preview.data.length > 0)
  // 拆单按「商品维度」（SplitDto: productId + allocations），与 split-preview 返回字段一致
  const split = await call('POST', `/admin/order/${orderId}/split`, {
    items: preview.data.map(p => ({ productId: p.productId, allocations: p.allocations.map(a => ({ supplierId: a.supplierId, qty: a.qty })) })),
  }, at)
  check('拆单→30 备货中', split.code === 0 && split.data?.status === 30)

  // ── 5. 供应商备货申报（决策 2：拆单即默认满额，只有缺货才走「异常申报」）──
  console.log('\n【5. 供应商备货申报】')
  const stockList = await call('GET', '/supplier-fulfill/stock-list', null, st)
  const myItems = stockList.data?.find(o => o.orderId === orderId)?.items || []
  check('供应商看到备货单', myItems.length > 0)
  if (!myItems.length) abort('本供应商备货单中未找到订单 ' + orderId + '，后续用例无法继续')
  // 有货直接备货：拆单时已按订购量默认满额申报（qtyDeclared = qtyOrdered）
  check('明细已默认满额申报', myItems.every(i => Number(i.qtyDeclared) === Number(i.qtyOrdered)))
  // 反向用例：不缺货时不允许「异常申报」
  const fullDeclare = await call('POST', '/supplier-fulfill/declare', {
    orderId, items: myItems.map(i => ({ orderItemId: i.orderItemId, qtyDeclared: i.qtyOrdered })),
  }, st)
  check('满额申报被拒(不缺货无需异常申报)', fullDeclare.code !== 0)
  // 缺货异常申报：少交必须填原因
  const shortQty = Number(myItems[0].qtyOrdered) - 1
  const noReason = await call('POST', '/supplier-fulfill/declare', {
    orderId, items: [{ orderItemId: myItems[0].orderItemId, qtyDeclared: shortQty }],
  }, st)
  check('缺货未填原因被拒', noReason.code !== 0)
  const declare = await call('POST', '/supplier-fulfill/declare', {
    orderId, items: [{ orderItemId: myItems[0].orderItemId, qtyDeclared: shortQty, shortageReason: '到货不足' }],
  }, st)
  check('缺货异常申报成功(停留30)', declare.code === 0)

  // ── 6. 供应商确认备货完成（30 → 40 待配送）──
  console.log('\n【6. 确认备货完成】')
  const handover = await call('POST', '/supplier-fulfill/handover', { orderId }, st)
  check('确认备货完成→40 待配送', handover.code === 0 && handover.data?.status === 40)
  const od6 = await call('GET', `/order/${orderId}`, null, bt2)
  // 交付金额 = 验收量×销售价 + 运费；无独立称重，qtyAccepted = qtyDeclared
  check('最终金额重算(含运费)', od6.data?.amountFinal > 0 && od6.data.amountFinal > od6.data.amountOrdered)

  // ── 7. 派送调度 + 配送交付 ──
  console.log('\n【7. 派送调度 + 配送交付】')
  const od7 = await call('GET', `/order/${orderId}`, null, bt2)
  if (od7.data.status !== 45) {
    // 备货完成时会尝试自动派单；若无「在线+空闲」配送员则停留 40，由运营手动派单
    const dispatch = await call('POST', '/admin/dispatch', { courierId: 1, orderIds: [orderId] }, at)
    check('派单创建任务', dispatch.code === 0 && !!dispatch.data.taskId)
  } else {
    check('派单创建任务', true)
  }
  const tasks = await call('GET', '/courier/today-tasks', null, ct)
  const taskId = tasks.data?.find(t => (t.stationList || []).some(s => s.orderId === orderId))?.taskId
  check('配送员看到今日任务', !!taskId)
  if (!taskId) abort('配送员今日任务中未找到订单 ' + orderId + ' 的派送任务，后续用例无法继续')
  const pickup = await call('POST', `/courier/task/${taskId}/pickup`, {}, ct)
  check('扫码取货(订单→50)', pickup.code === 0)
  // 出发：任务 1 配送中 → 2 已出发（deliver 要求任务状态为「已出发」，全路线批量操作）
  const depart = await call('POST', '/courier/depart', {}, ct)
  check('出发(任务→已出发)', depart.code === 0)
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
