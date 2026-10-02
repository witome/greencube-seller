/**
 * 卡BL 收尾 · 回归脚本自造数据清理（只动今天 10:25 之后本卡跑脚本产生的行）
 * 跑法（backend 目录）：node scripts/bl-regression-cleanup.js
 */
const fs = require('fs')
const path = require('path')
const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
for (const line of envTxt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
  if (!m) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (process.env[m[1]] === undefined) process.env[m[1]] = v
}
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const SINCE = new Date('2026-10-02T10:25:00+08:00')

async function main() {
  const users = await prisma.user.findMany({ where: { createdAt: { gte: SINCE } }, select: { id: true } })
  const userIds = users.map((u) => u.id)
  const purchasers = await prisma.purchaser.findMany({ where: { registeredAt: { gte: SINCE } }, select: { id: true } })
  const purchaserIds = purchasers.map((p) => p.id)
  const couriers = await prisma.courier.findMany({ where: { createdAt: { gte: SINCE } }, select: { id: true } })
  const courierIds = couriers.map((c) => c.id)
  console.log(`待清理：user=${userIds.length} purchaser=${purchaserIds.length} courier=${courierIds.length}`)

  // 先清 purchaser 的引用行。⚠️ purchase_demand 是按 demandKey 聚合的表（无 purchaserId），
  // 不归本清理删（demand-test 等脚本自带以菜名 tag 为准的清理）。
  const r1 = await prisma.demandNotifyLog.deleteMany({ where: { purchaserId: { in: purchaserIds } } })
  const r2 = await prisma.demandSubscribeQuota.deleteMany({ where: { purchaserId: { in: purchaserIds } } })
  const r4 = await prisma.appealRecord.deleteMany({ where: { purchaserId: { in: purchaserIds } } })
  const r5 = await prisma.verificationLog.deleteMany({ where: { purchaserId: { in: purchaserIds } } })
  const r6 = await prisma.cartItem.deleteMany({ where: { userId: { in: userIds } } })
  const r7 = await prisma.purchaseDemandItem.deleteMany({ where: { purchaserId: { in: purchaserIds } } })
  const oCnt = await prisma.order.count({ where: { purchaserId: { in: purchaserIds } } })
  const bCnt = await prisma.purchaseBill.count({ where: { purchaserId: { in: purchaserIds } } })
  // 今天自造采购方名下的测试订单（order-shipping/pay-status 绿跑遗留）连同子表一起删
  const orderIds = (await prisma.order.findMany({ where: { purchaserId: { in: purchaserIds } }, select: { id: true } })).map((o) => o.id)
  const o1 = await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })
  const o2 = await prisma.orderSupplierAck.deleteMany({ where: { orderId: { in: orderIds } } })
  const o3 = await prisma.deliveryException.deleteMany({ where: { orderId: { in: orderIds } } })
  const o4 = await prisma.aftersaleOrder.deleteMany({ where: { orderId: { in: orderIds } } })
  const o5 = await prisma.paymentRecord.deleteMany({ where: { orderId: { in: orderIds } } })
  const o6 = await prisma.orderShipping.deleteMany({ where: { orderId: { in: orderIds } } })
  const o7 = await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
  console.log(`测试订单清理：订单=${o7.count} 明细=${o1.count} ack=${o2.count} 异常=${o3.count} 售后=${o4.count} 支付流水=${o5.count} 运单=${o6.count}；purchase_bill=${bCnt}（应为 0）`)

  const d1 = await prisma.courier.deleteMany({ where: { id: { in: courierIds } } })
  const d2 = await prisma.purchaser.deleteMany({ where: { id: { in: purchaserIds } } })
  const d3 = await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  console.log(`主体清理：courier=${d1.count} purchaser=${d2.count} user=${d3.count}`)

  // 残留断言
  const c1 = await prisma.user.count({ where: { createdAt: { gte: SINCE } } })
  const c2 = await prisma.purchaser.count({ where: { registeredAt: { gte: SINCE } } })
  const c3 = await prisma.courier.count({ where: { createdAt: { gte: SINCE } } })
  console.log(`残留断言：user=${c1} purchaser=${c2} courier=${c3}（应全为 0）`)
  if (c1 || c2 || c3) process.exit(1)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('清理异常：', e)
  try { await prisma.$disconnect() } catch (_) {}
  process.exit(1)
})
