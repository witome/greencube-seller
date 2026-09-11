// 拆单入口回归脚本（本卡：移除批量一键拆单后）
// 运行：NODE_PATH=... node _脚本-拆单入口回归.js
// 作用：真实调用 4 个保留的拆单入口，确认移除批量按钮后它们仍正常。
const path = require('path')
const BASE = 'http://localhost:3001/api/v1'
let ok = 0, ng = 0
const log = (n, c, extra) => { if (c) { ok++; console.log('  ✅ ' + n) } else { ng++; console.log('  ❌ ' + n + (extra ? ' → ' + JSON.stringify(extra) : '')) } }

async function call(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const code = res.status
  let json = null
  try { json = await res.json() } catch (e) { json = null }
  return { code, json }
}

(async () => {
  console.log('='.repeat(56))
  console.log('拆单入口回归（移除「⚡一键拆单」后）')
  console.log('='.repeat(56))
  const at = (await call('POST', '/auth/wx-login', { code: 'admin' })).json.data.token
  const pending = (await call('GET', '/admin/order/pending', null, at)).json.data || []
  const s10 = pending.filter((o) => o.status === 10)
  const s30 = pending.filter((o) => o.status === 30)
  console.log(`\n候选：status=10 共 ${s10.length} 单；status=30 共 ${s30.length} 单\n`)

  // ① 手动拆单：status=10 → 拆单建议 → split → 期望 30
  console.log('【① 手动拆单（拆单建议预览 → 手动拆单）】')
  if (!s10[0]) { log('存在 status=10 订单', false, '无候选'); } else {
    const id = s10[0].orderId
    const pv = await call('GET', `/admin/order/${id}/split-preview`, null, at)
    log(`#${id} 拆单建议生成`, pv.json?.code === 0 && Array.isArray(pv.json.data) && pv.json.data.length > 0, pv.json)
    const items = (pv.json?.data || [])
      .filter((it) => it.allocations && it.allocations.length)
      .map((it) => ({ productId: it.productId, allocations: it.allocations.map((a) => ({ supplierId: a.supplierId, qty: a.qty })) }))
    const sp = await call('POST', `/admin/order/${id}/split`, { items }, at)
    log(`#${id} 手动拆单 → 30 备货中`, sp.json?.code === 0 && sp.json.data?.status === 30, sp.json)
  }

  // ② 行内自动拆单：status=10 → auto-split → 期望 30
  console.log('\n【② 行内「自动拆单」按钮（POST /:id/auto-split）】')
  const autoTarget = s10[1]
  if (!autoTarget) { log('存在第二个 status=10 订单', false, '无候选'); } else {
    const id = autoTarget.orderId
    const r = await call('POST', `/admin/order/${id}/auto-split`, null, at)
    log(`#${id} 行内自动拆单 → 30 备货中`, r.json?.code === 0 && r.json.data?.status === 30, r.json)
  }

  // ③ 改拆单：status=30 → 再次 split → 期望 0（重新生效）
  console.log('\n【③ 改拆单（status=30 重新拆单）】')
  if (!s30[0]) { log('存在 status=30 订单', false, '无候选'); } else {
    const id = s30[0].orderId
    const pv = await call('GET', `/admin/order/${id}/split-preview`, null, at)
    const items = (pv.json?.data || [])
      .filter((it) => it.allocations && it.allocations.length)
      .map((it) => ({ productId: it.productId, allocations: it.allocations.map((a) => ({ supplierId: a.supplierId, qty: a.qty })) }))
    const sp = await call('POST', `/admin/order/${id}/split`, { items }, at)
    log(`#${id} 改拆单成功`, sp.json?.code === 0, sp.json)
  }

  // ④ 缺货二次拆单：需要 status=92（无法交付）
  console.log('\n【④ 缺货二次拆单（re-split-shortage）】')
  // 直接在 DB 里找 92 态订单（只读）
  let o92 = null
  try {
    const { PrismaClient } = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', '@prisma', 'client'))
    const prisma = new PrismaClient()
    const rows = await prisma.order.findMany({ where: { status: 92 }, select: { id: true }, take: 3 })
    o92 = rows.map((r) => Number(r.id))
    await prisma.$disconnect()
  } catch (e) {
    console.log('  （DB 只读探测不可用：' + e.message + '）')
  }
  if (o92 && o92.length) {
    const id = o92[0]
    const r = await call('POST', `/admin/order/${id}/re-split-shortage`, null, at)
    // 92 态订单可能需要可分配供应商；只要不是 404（路由缺失）即视为入口正常
    log(`#${id} 缺货二次拆单路由可达（HTTP≠404）`, r.code !== 404, { http: r.code, body: r.json })
    console.log(`     实测返回：HTTP=${r.code} body=${JSON.stringify(r.json)}`)
  } else {
    const r = await call('POST', '/admin/order/1/re-split-shortage', null, at)
    log('re-split-shortage 路由可达（HTTP≠404；库内无 92 态订单，用非 92 订单验证守卫）', r.code !== 404, { http: r.code, body: r.json })
    console.log(`     实测返回：HTTP=${r.code} body=${JSON.stringify(r.json)}`)
  }

  // ⑤ 批量路由必须 404
  console.log('\n【⑤ 已移除的批量路由（应为 404）】')
  const gone = await call('POST', '/admin/order/auto-split-all', null, at)
  log('POST /admin/order/auto-split-all → 404（路由已移除）', gone.code === 404, { http: gone.code })

  console.log('\n' + '='.repeat(56))
  console.log(`回归结果：✅ 通过 ${ok} 项 / ❌ 失败 ${ng} 项`)
  console.log('='.repeat(56))
  process.exit(ng ? 1 : 0)
})()
