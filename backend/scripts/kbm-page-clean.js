/**
 * 临时：卡BM 页面取证结果清理（按 tag 精确删除自造数据）
 * 用法：node scripts/kbm-page-clean.js "<TAG>"
 */
const path = require('path')
const fs = require('fs')
try {
  const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  for (const line of envTxt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
} catch (e) { /* ignore */ }
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const tag = process.argv[2]
  if (!tag) throw new Error('需要传 TAG')
  const orders = await prisma.order.findMany({ where: { remark: tag }, select: { id: true } })
  const oids = orders.map((o) => o.id)
  const items = oids.length ? await prisma.orderItem.deleteMany({ where: { orderId: { in: oids } } }) : { count: 0 }
  const od = oids.length ? await prisma.order.deleteMany({ where: { id: { in: oids } } }) : { count: 0 }
  const pu = await prisma.purchaser.findMany({ where: { shopName: { startsWith: tag } }, select: { id: true, userId: true } })
  const pd = pu.length ? await prisma.purchaser.deleteMany({ where: { id: { in: pu.map((x) => x.id) } } }) : { count: 0 }
  const su = await prisma.supplier.findMany({ where: { stallName: { startsWith: tag } }, select: { id: true, userId: true } })
  const sd = su.length ? await prisma.supplier.deleteMany({ where: { id: { in: su.map((x) => x.id) } } }) : { count: 0 }
  const uids = [...pu.map((x) => x.userId), ...su.map((x) => x.userId)]
  const ud = uids.length ? await prisma.user.deleteMany({ where: { id: { in: uids } } }) : { count: 0 }
  console.log(JSON.stringify({ orderItems: items.count, orders: od.count, purchasers: pd.count, suppliers: sd.count, users: ud.count,
    residue: { orderItem: await prisma.orderItem.count({ where: { orderId: { in: oids } } }), order: await prisma.order.count({ where: { remark: tag } }),
      purchaser: await prisma.purchaser.count({ where: { shopName: { startsWith: tag } } }), supplier: await prisma.supplier.count({ where: { stallName: { startsWith: tag } } }),
      user: await prisma.user.count({ where: { wxOpenid: { contains: tag.slice(-13) } } }) } }))
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error('CLEAN FAIL', e); await prisma.$disconnect(); process.exit(1) })
