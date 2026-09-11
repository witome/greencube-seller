// 只读探测：找出可驱动 92 流程的订单（status=30 且 demo_supplier 为供应商）
const path = require('path')
const { PrismaClient } = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', '@prisma', 'client'))
const prisma = new PrismaClient()
;(async () => {
  // demo_supplier 的 openid 约定：dev mock 下 code 直接当 openid
  const u = await prisma.user.findFirst({ where: { wxOpenid: 'dev_demo_supplier' }, select: { id: true, roles: true } })
  console.log('demo_supplier user =', u ? { id: Number(u.id), roles: u.roles } : null)
  const sup = u ? await prisma.supplier.findFirst({ where: { userId: u.id }, select: { id: true, stallName: true } }) : null
  console.log('supplier =', sup ? { id: Number(sup.id), stallName: sup.stallName } : null)

  const orders = await prisma.order.findMany({
    where: { status: 30 },
    select: { id: true, items: { select: { supplierId: true, qtyDeclared: true, qtyOrdered: true } } },
    orderBy: { id: 'asc' },
    take: 200,
  })
  const hit = orders.filter((o) => o.items.some((it) => sup && Number(it.supplierId) === Number(sup.id)))
  console.log('status=30 订单数 =', orders.length, '；含 demo_supplier 明细的 =', hit.length)
  hit.slice(0, 5).forEach((o) => console.log('  候选 orderId=' + Number(o.id) + ' items=' + o.items.length + ' suppliers=' + [...new Set(o.items.map((i) => Number(i.supplierId)))].join(',')))

  const s92 = await prisma.order.count({ where: { status: 92 } })
  console.log('当前 92 态订单数 =', s92)
  await prisma.$disconnect()
})().catch((e) => { console.error(e); process.exit(1) })
