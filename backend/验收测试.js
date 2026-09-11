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
  // 队列按 registeredAt 升序、pageSize 上限 50；测试数据按拍板保留不清理，
  // 库里采购方会不断累积，本次新注册的记录会落到最后一页 → 逐页找（不能只看第 1 页）
  const found = await (async () => {
    const first = await call('GET', '/admin/buyers/pending?pageSize=50', null, at)
    const pages = Math.max(1, Math.ceil((first.data?.total || 0) / 50))
    let hit = (first.data?.list || []).find(p => p.phone === regPhone)
    for (let p = 2; p <= pages && !hit; p++) {
      const r = await call('GET', `/admin/buyers/pending?pageSize=50&page=${p}`, null, at)
      hit = (r.data?.list || []).find(x => x.phone === regPhone)
    }
    return hit
  })()
  const target = found
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

  // ── 3.5 微信支付模拟回调（任务卡 2026-09-11：支付抽象层，拍板①②③④=A）──
  console.log('\n【3.5 微信支付模拟回调】')
  const crypto = require('crypto')
  const PAY_SECRET = (require('fs').readFileSync(__dirname + '/.env', 'utf8').match(/PAY_CALLBACK_SECRET=(\S+)/) || [])[1]
  const paySign = (payNo, amount) => crypto.createHmac('sha256', PAY_SECRET).update(`${payNo}|${Number(amount)}`).digest('hex')

  const order2 = await call('POST', '/order', { deliveryDate: '2026-09-20', timeWindow: 1, items: [{ productId: pid, qty: 3 }] }, bt2)
  check('支付用例下单(order2 status=10)', order2.code === 0 && order2.data.status === 10)
  const order2Id = order2.data.orderId

  const payRes = await call('POST', `/order/${order2Id}/pay`, { payMethod: 1 }, bt2)
  check('创建支付单(返回 payNo/amount)', payRes.code === 0 && !!payRes.data.payNo && Number(payRes.data.amount) > 0)
  check('创建支付单后订单仍停 10(待支付)', payRes.data.status === 10)
  const payNo = payRes.data.payNo, payAmount = payRes.data.amount

  // 防伪：错签名回调被拒（拍板③=A）
  const forged = await call('POST', '/payment/mock/callback', { payNo, signature: 'deadbeef' })
  check('错签名回调被拒(2001)', forged.code === 2001)
  // 防伪：无签名被拒
  const noSig = await call('POST', '/payment/mock/callback', { payNo: payNo })
  check('无签名回调被拒(1001)', noSig.code === 1001)

  // 正确签名回调 → 订单 10→30（复用拆单）
  const cb = await call('POST', '/payment/mock/callback', { payNo, signature: paySign(payNo, payAmount) })
  check('正确签名回调成功', cb.code === 0 && cb.data.status === 1)
  const o2 = await call('GET', `/order/${order2Id}`, null, bt2)
  check('回调后订单 10→30 且 payMethod=1', o2.data.status === 30 && o2.data.payMethod === 1)

  // 幂等：同一 payNo 重复回调
  const cb2 = await call('POST', '/payment/mock/callback', { payNo, signature: paySign(payNo, payAmount) })
  check('重复回调幂等(alreadyConfirmed)', cb2.code === 0 && cb2.data.alreadyConfirmed === true)
  const o2b = await call('GET', `/order/${order2Id}`, null, bt2)
  check('幂等后订单状态不回退(仍 30)', o2b.data.status === 30)

  // 模拟支付端点（采购方 token 自签，等同前端「模拟支付」按钮链路）
  const order4 = await call('POST', '/order', { deliveryDate: '2026-09-20', timeWindow: 1, items: [{ productId: pid, qty: 2 }] }, bt2)
  const pay4 = await call('POST', `/order/${order4.data.orderId}/pay`, { payMethod: 1 }, bt2)
  const mp = await call('POST', '/payment/mock/pay', { payNo: pay4.data.payNo }, bt2)
  check('模拟支付端点(mock/pay)成功', mp.code === 0 && mp.data.status === 1)
  const o4 = await call('GET', `/order/${order4.data.orderId}`, null, bt2)
  check('mock/pay 后订单 10→30 且 payMethod=1', o4.data.status === 30 && o4.data.payMethod === 1)

  // 放弃支付（拍板④ Hermes 补充）：支付单创建后不回调 → 订单停 10、仍可手动取消
  const order3 = await call('POST', '/order', { deliveryDate: '2026-09-20', timeWindow: 1, items: [{ productId: pid, qty: 1 }] }, bt2)
  const order3Id = order3.data.orderId
  const pay3 = await call('POST', `/order/${order3Id}/pay`, { payMethod: 1 }, bt2)
  check('放弃支付用例: 支付单已创建', pay3.code === 0 && !!pay3.data.payNo)
  const o3 = await call('GET', `/order/${order3Id}`, null, bt2)
  check('放弃支付后订单状态不变(仍 10)', o3.data.status === 10 && o3.data.payMethod === 0)
  const cancel3 = await call('POST', `/order/${order3Id}/cancel`, null, bt2)
  check('放弃支付后仍可手动取消', cancel3.code === 0)
  const o3b = await call('GET', `/order/${order3Id}`, null, bt2)
  check('取消后订单 91 已取消', o3b.data.status === 91)
  // 已取消订单的支付单不可再回调推进（服务端按订单状态拒）
  const cb3 = await call('POST', '/payment/mock/callback', { payNo: pay3.data.payNo, signature: paySign(pay3.data.payNo, pay3.data.amount) })
  check('已取消订单的回调被拒(3002)', cb3.code === 3002)

  // ── 3.6 运营支付流水查询（任务卡 2026-09-11：只读接口 + 权限铁律 3）──
  console.log('\n【3.6 运营支付流水查询（只读）】')
  const PAY_API = '/admin/payments'

  const p0 = await call('GET', PAY_API + '?pageSize=1', null, at)
  check('运营可查支付流水', p0.code === 0 && Array.isArray(p0.data.list) && p0.data.total > 0)
  const firstRow = p0.data.list[0] || {}
  check(
    '字段完整(单号/订单号/渠道/金额/状态/创建时间/支付时间字段)',
    !!firstRow.payNo && !!firstRow.orderId && !!firstRow.channel &&
      typeof firstRow.amount === 'string' && /^\d+\.\d{2}$/.test(firstRow.amount) &&
      firstRow.status !== undefined && !!firstRow.statusText && !!firstRow.createdAt && 'paidAt' in firstRow,
  )
  check('列表含餐馆(shopName)', !!firstRow.shopName)
  check('状态文案映射正确', ['待支付', '成功', '关闭'].includes(firstRow.statusText))

  const p5 = await call('GET', PAY_API + '?pageSize=5', null, at)
  const times = p5.data.list.map((x) => new Date(x.createdAt).getTime())
  check('默认按创建时间倒序(最新在前)', times.length > 1 && times.every((t, i) => i === 0 || times[i - 1] >= t))

  const onlySucc = await call('GET', PAY_API + '?status=1&pageSize=100', null, at)
  check('状态筛选=成功 只返回成功', onlySucc.code === 0 && onlySucc.data.list.length > 0 && onlySucc.data.list.every((x) => x.status === 1))
  const onlyPend = await call('GET', PAY_API + '?status=0&pageSize=100', null, at)
  check('状态筛选=待支付 只返回待支付', onlyPend.code === 0 && onlyPend.data.list.every((x) => x.status === 0))

  // 金额口径（已拍板）：线上支付金额 = 下单时刻应付额(amountOrdered + deliveryFee)
  const succRow = onlySucc.data.list.find((x) => x.orderId === order2Id)
  check('本用例订单的成功流水可见(用于口径核对)', !!succRow)
  const o2c = await call('GET', `/order/${order2Id}`, null, bt2)
  check(
    '金额口径=amountOrdered+deliveryFee',
    !!succRow && Number(succRow.amount) === Number(o2c.data.amountOrdered) + Number(o2c.data.deliveryFee),
    succRow ? { 流水金额: succRow.amount, amountOrdered: o2c.data.amountOrdered, deliveryFee: o2c.data.deliveryFee } : null,
  )

  const byPayNo = await call('GET', PAY_API + '?keyword=' + encodeURIComponent(succRow.payNo.slice(0, 8)), null, at)
  check('按单号搜索命中', byPayNo.code === 0 && byPayNo.data.list.some((x) => x.payNo === succRow.payNo))
  const byOrderId = await call('GET', PAY_API + '?keyword=' + order2Id, null, at)
  check('按订单号搜索命中', byOrderId.code === 0 && byOrderId.data.list.some((x) => x.orderId === order2Id))
  const byMiss = await call('GET', PAY_API + '?keyword=999999999999', null, at)
  check('按不存在的号搜索返回空', byMiss.code === 0 && byMiss.data.total === 0)

  const big = await call('GET', PAY_API + '?pageSize=200', null, at)
  check('pageSize 上限 100 生效', big.code === 0 && big.data.pageSize === 100 && big.data.list.length <= 100)

  // 纯只读：查询前后总量不变（查询不写库、不写流水、不写审计）
  const beforeTotal = (await call('GET', PAY_API + '?pageSize=1', null, at)).data.total
  await call('GET', PAY_API + '?status=1&pageSize=20', null, at)
  await call('GET', PAY_API + '?keyword=mock', null, at)
  const afterTotal = (await call('GET', PAY_API + '?pageSize=1', null, at)).data.total
  check('查询接口不写库(前后 total 一致)', beforeTotal === afterTotal)

  // 权限（铁律 3）：配送员不碰钱、供应商不见销售价、业务员仅限采购方审核
  check('配送员被拒(2002)', (await call('GET', PAY_API, null, ct)).code === 2002)
  check('供应商被拒(2002)', (await call('GET', PAY_API, null, st)).code === 2002)
  check('采购方被拒(2002)', (await call('GET', PAY_API, null, bt2)).code === 2002)
  check('无 token 被拒(2001)', (await call('GET', PAY_API)).code === 2001)
  // 业务员：项目无 business_agent 演示账号，用同密钥签一个「业务员身份」token 仅验证守卫口径（不写库、不建账号）
  // 注意：.env 中 JWT_SECRET 可能带引号（如 JWT_SECRET="xxx"），dotenv 会剥掉引号，
  // 这里必须同样剥引号，否则签名密钥不匹配 → 守卫抛 2001（未登录），用例会「假红/假绿」。
  const jwtSecret = ((require('fs').readFileSync(__dirname + '/.env', 'utf8').match(/^JWT_SECRET=(.*)$/m) || [])[1] || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const agentToken = (() => {
    const h = b64({ alg: 'HS256', typ: 'JWT' })
    const p = b64({ sub: 1, userId: 1, roles: ['business_agent'], currentRole: 'business_agent' })
    return `${h}.${p}.${crypto.createHmac('sha256', jwtSecret).update(`${h}.${p}`).digest('base64url')}`
  })()
  check('业务员被拒(2002，仅限采购方审核)', (await call('GET', PAY_API, null, agentToken)).code === 2002)

  // ── 3.7 业务员权限收口回归（本卡：删除 RolesGuard 对 business_agent 的 ADMIN 兜底放行）──
  // 背景：原 roles.guard.ts:43-45 有兜底 `currentRole==='business_agent' && required.includes(ADMIN)`，
  //       导致业务员可进全部 56 个 @Roles(Role.ADMIN) 接口（资金/派单/商品/审计/支付），违反铁律 3。
  console.log('\n【3.7 业务员权限收口（删兜底回归）】')
  // (a) 「将失去」抽样：业务员访问 ADMIN 接口 → 明确拒绝 2002
  check('业务员被拒·资金结算 /admin/finance/settlements', (await call('GET', '/admin/finance/settlements', null, agentToken)).code === 2002)
  check('业务员被拒·派单调度 /admin/dispatch', (await call('GET', '/admin/dispatch', null, agentToken)).code === 2002)
  check('业务员被拒·商品管理 /admin/goods/pending', (await call('GET', '/admin/goods/pending', null, agentToken)).code === 2002)
  check('业务员被拒·订单核单 /admin/order/pending', (await call('GET', '/admin/order/pending', null, agentToken)).code === 2002)
  check('业务员被拒·审计日志 /audit', (await call('GET', '/audit', null, agentToken)).code === 2002)
  check('业务员被拒·售后工单 /admin/aftersale', (await call('GET', '/admin/aftersale', null, agentToken)).code === 2002)

  // (b) ★ 反向用例（防修过头）：业务员【仍能】进 5 个采购方审核接口 → 守卫放行（非 2001/2002）
  //     写接口统一用不存在的 id(999999999)：守卫放行后由 service 先查存在性抛 NOT_FOUND(4001)，
  //     既证明「进得去」又保证不产生任何写操作/副作用。
  const NA = 999999999
  const notBlocked = (r) => r.code !== 2002 && r.code !== 2001
  const ag1 = await call('GET', '/admin/buyers/pending?pageSize=1', null, agentToken)
  check('业务员仍可进·采购方待审列表(GET buyers/pending)', notBlocked(ag1) && ag1.code === 0)
  const ag2 = await call('GET', `/admin/buyers/${target.purchaserId}/verify-detail`, null, agentToken)
  check('业务员仍可进·审核详情(GET buyers/:id/verify-detail)', notBlocked(ag2) && ag2.code === 0)
  const ag3 = await call('POST', `/admin/buyers/${NA}/verify`, { methods: [1], result: 1 }, agentToken)
  check('业务员仍可进·提交审核(POST buyers/:id/verify → 守卫放行/业务4001)', notBlocked(ag3))
  const ag4 = await call('POST', `/admin/buyers/${NA}/appeal-review`, { approved: true }, agentToken)
  check('业务员仍可进·申诉复核(POST buyers/:id/appeal-review → 守卫放行/业务4001)', notBlocked(ag4))
  const ag5 = await call('POST', `/admin/buyers/${NA}/assign`, { agentId: 1 }, agentToken)
  check('业务员仍可进·指派业务员(POST buyers/:id/assign → 守卫放行/业务4001)', notBlocked(ag5))
  // (c) 反向用例零副作用：上面用的不存在 id，运营查它仍是 4001（未因反向用例被创建/写入）
  check('反向用例未写库(不存在id经运营查仍4001)', (await call('GET', `/admin/buyers/${NA}/verify-detail`, null, at)).code === 4001)

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
