/**
 * 卡BJ 页面取证 · 种子数据（自造供应商 + 两张备货中订单，跑完由清理脚本删除）
 * 用法：node scripts/bj-page-seed.js   （输出 JSON：{"code":"bjpage_<TS>","orderIds":[..],"supplierId":..}）
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
  const TS = Date.now()
  const TAG = `卡BJ页面取证${TS}`
  const product = await prisma.product.findFirst({ where: { status: 1 } })
  if (!product) throw new Error('无在售商品')

  const u = await prisma.user.create({ data: { wxOpenid: `dev_bjpage_${TS}`, name: TAG + '档口', roles: [], status: 1 } })
  const s = await prisma.supplier.create({ data: { userId: u.id, stallName: TAG + '档口', address: TAG, status: 1, qualification: {} } })

  const mkOrder = async (n) => {
    const o = await prisma.order.create({
      data: { purchaserId: await prisma.purchaser.findFirst().then((p) => p.id), deliveryDate: new Date(), timeWindow: 2, status: 30, amountOrdered: 100, deliveryFee: 5, payMethod: 2, remark: TAG },
    })
    await prisma.orderItem.create({
      data: { orderId: o.id, productId: product.id, supplierId: s.id, qtyOrdered: 10 + n, qtyDeclared: 10 + n, qtyAccepted: null, salePrice: 2.5, supplyPrice: 2 },
    })
    return Number(o.id)
  }
  const o1 = await mkOrder(1)
  const o2 = await mkOrder(2)
  console.log(JSON.stringify({ code: `bjpage_${TS}`, tag: TAG, supplierId: Number(s.id), userId: Number(u.id), orderIds: [o1, o2] }))
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
