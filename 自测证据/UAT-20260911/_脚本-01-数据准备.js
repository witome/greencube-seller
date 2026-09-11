// UAT 数据准备：为固定账号 buyer 造出「已送达订单 / 已收货+售后工单 / 新订单」
// 运行：node _uat_seed.js   （需后端在 3001）
const BASE = 'http://127.0.0.1:3001/api/v1'

async function call(m, p, b, t) {
  const r = await fetch(BASE + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  })
  return r.json()
}

;(async () => {
  const bt = (await call('POST', '/auth/wx-login', { code: 'buyer' })).data.token
  const at = (await call('POST', '/auth/wx-login', { code: 'admin' })).data.token
  const ct = (await call('POST', '/auth/wx-login', { code: 'courier' })).data.token
  const st = (await call('POST', '/auth/wx-login', { code: 'demo_supplier' })).data.token

  const goods = await call('GET', '/product/list?pageSize=3', null, bt)
  const products = goods.data.list
  console.log('可用商品:', products.map((p) => `${p.id}:${p.name}`).join(', '))

  const mkOrder = async (items) => {
    const o = await call('POST', '/order', { deliveryDate: '2026-09-20', timeWindow: 1, items }, bt)
    if (o.code !== 0) throw new Error('下单失败: ' + JSON.stringify(o))
    return o.data.orderId
  }

  // 走完 拆单 → 确认备货完成 → 派单 → 取货 → 出发 → 交付
  const deliverAll = async (oids) => {
    for (const oid of oids) {
      const pv = await call('GET', `/admin/order/${oid}/split-preview`, null, at)
      await call('POST', `/admin/order/${oid}/split`, {
        items: pv.data.map((p) => ({ productId: p.productId, allocations: p.allocations.map((a) => ({ supplierId: a.supplierId, qty: a.qty })) })),
      }, at)
      await call('POST', '/supplier-fulfill/handover', { orderId: oid }, st)
    }
    // 逐个派单（备货完成时可能已自动派单，失败则忽略）
    for (const oid of oids) {
      const d = await call('POST', '/admin/dispatch', { courierId: 1, orderIds: [oid] }, at)
      if (d.code !== 0) console.log(`  订单 ${oid} 派单返回: ${d.msg}`)
    }
    const tasks = await call('GET', '/courier/today-tasks', null, ct)
    for (const oid of oids) {
      const t = tasks.data.find((x) => (x.stationList || []).some((s) => s.orderId === oid))
      if (!t) { console.log(`  ⚠️ 订单 ${oid} 未找到配送任务`); continue }
      await call('POST', `/courier/task/${t.taskId}/pickup`, {}, ct)
    }
    await call('POST', '/courier/depart', {}, ct)
    const tasks2 = await call('GET', '/courier/today-tasks', null, ct)
    for (const oid of oids) {
      const t = tasks2.data.find((x) => (x.stationList || []).some((s) => s.orderId === oid))
      if (!t) continue
      const r = await call('POST', `/courier/task/${t.taskId}/deliver`, { photos: ['evt.jpg'], signature: 'sig.png' }, ct)
      console.log(`  订单 ${oid} 交付: ${r.code === 0 ? 'OK' : JSON.stringify(r)}`)
    }
  }

  // ① 已送达（60）
  const orderA = await mkOrder([{ productId: products[0].id, qty: 10 }])
  // ② 已收货（70）+ 拒收 0.5 → 生成售后工单
  const orderB = await mkOrder([{ productId: products[1].id, qty: 8 }])
  // ③ 新订单（10，待交付）
  const orderC = await mkOrder([{ productId: products[0].id, qty: 3 }])

  await deliverAll([orderA, orderB])

  // 订单 B 确认收货（拒收 0.5 → 决策 3 生成售后工单）
  const db = await call('GET', `/order/${orderB}`, null, bt)
  const rec = await call('POST', `/order/${orderB}/receive`, {
    items: db.data.items.map((i) => ({
      orderItemId: i.orderItemId,
      qtyReceived: Number(i.qtyAccepted) - 0.5,
      rejectQty: 0.5,
      rejectReason: '到货有压伤，品质问题',
    })),
  }, bt)
  console.log('订单 B 确认收货:', rec.code === 0 ? 'OK' : JSON.stringify(rec), '售后单:', rec.data?.aftersaleIds)

  const da = await call('GET', `/order/${orderA}`, null, bt)
  const af = await call('GET', '/buyer/aftersale', null, bt)
  console.log('\n===== UAT 数据就绪 =====')
  console.log('订单 A（已送达）orderId =', orderA, '| status', da.data.status, '| createdAt', da.data.createdAt, '| deliveredAt', da.data.deliveredAt)
  console.log('订单 B（已收货+售后）orderId =', orderB)
  console.log('订单 C（待交付）orderId =', orderC)
  console.log('售后工单数 =', af.data.length, '| 售后中(status0/1) =', af.data.filter((a) => a.status === 0 || a.status === 1).length)
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
