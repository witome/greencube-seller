/**
 * 临时：卡BM 后台三级时长文案 页面取证 种子数据（Hermes 复核用，跑完由 kbm-page-clean.js 删除）
 * 用法：node scripts/kbm-page-seed.js
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
  const TAG = `卡BM页面取证${TS}`
  const product = await prisma.product.findFirst({ where: { status: 1 } })
  if (!product) throw new Error('无在售商品')

  const su = await prisma.user.create({ data: { wxOpenid: `dev_kbmpage_s_${TS}`, name: TAG + '档口', roles: [], status: 1 } })
  const s = await prisma.supplier.create({ data: { userId: su.id, stallName: TAG + '档口', address: TAG, status: 1, qualification: {} } })
  const bu = await prisma.user.create({ data: { wxOpenid: `dev_kbmpage_b_${TS}`, name: TAG + '买家', roles: [], status: 1 } })
  const p = await prisma.purchaser.create({ data: { userId: bu.id, shopName: TAG + '餐馆', contact: '卡BM', phone: '136' + String(TS).slice(-8), address: TAG + '地址', deliveryWindows: ['中 10-13'], accountStatus: 2 } })

  // 三档：20 分钟 / 5 小时 / 3 天（备货中 30，供应商未接单）
  const offsets = [20 * 60 * 1000, 5 * 60 * 60 * 1000, 3 * 24 * 60 * 60 * 1000]
  const orderIds = []
  for (const off of offsets) {
    const o = await prisma.order.create({
      data: {
        purchaserId: p.id, deliveryDate: new Date(), timeWindow: 2, status: 30,
        amountOrdered: 100, deliveryFee: 5, payMethod: 2, remark: TAG,
        createdAt: new Date(Date.now() - off),
      },
    })
    await prisma.orderItem.create({
      data: { orderId: o.id, productId: product.id, supplierId: s.id, qtyOrdered: 10, qtyDeclared: 10, qtyAccepted: null, salePrice: 2.5, supplyPrice: 2 },
    })
    orderIds.push(Number(o.id))
  }
  console.log(JSON.stringify({ tag: TAG, userIds: [Number(su.id), Number(bu.id)], supplierId: Number(s.id), purchaserId: Number(p.id), orderIds }))
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error('SEED FAIL', e); await prisma.$disconnect(); process.exit(1) })
