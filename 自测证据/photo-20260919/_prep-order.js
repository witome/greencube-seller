// 为 E2E 准备一个「可上报」的订单（40 待配送 / 45 已派单），并打印 orderId
// 运行：cd backend && node ../自测证据/photo-20260919/_prep-order.js
const path = require('path')
function loadPrisma() {
  for (const t of ['@prisma/client', path.join(process.cwd(), 'node_modules', '@prisma/client')]) {
    try { return require(t) } catch (e) { /* next */ }
  }
  throw new Error('无法加载 @prisma/client（请在 backend 目录运行）')
}
const { PrismaClient } = loadPrisma()
const prisma = new PrismaClient()
const BASE = 'http://localhost:3001/api/v1'

async function call(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

;(async () => {
  const bt = (await call('POST', '/auth/wx-login', { code: 'buyer' })).data.token
  const st = (await call('POST', '/auth/wx-login', { code: 'demo_supplier' })).data.token
  const goods = await call('GET', '/product/list', null, bt)
  const pid = goods.data.list[0].id
  const o = await call('POST', '/order', { deliveryDate: '2026-09-24', timeWindow: 1, items: [{ productId: pid, qty: 1 }] }, bt)
  const oid = o.data.orderId
  await call('POST', `/order/${oid}/pay`, { payMethod: 2 }, bt)
  const hd = await call('POST', '/supplier-fulfill/handover', { orderId: oid }, st)
  const row = await prisma.$queryRawUnsafe(`SELECT id, status FROM \`order\` WHERE id = ${oid}`)
  console.log(JSON.stringify({ orderId: oid, handoverStatus: hd.data?.status, dbStatus: Number(row[0].status) }))
  await prisma.$disconnect()
})().catch(async (e) => { console.error('PREP_FAILED', e); await prisma.$disconnect(); process.exit(1) })
