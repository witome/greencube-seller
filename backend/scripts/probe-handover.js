/**
 * 临时探针：供应商「确认备货完成」今天还能不能把订单推到 40 待配送？
 * （用于判定 验收测试.js 里「取消用例C 备货完成→40」4 项恒红的归因）
 * 用法：node scripts/probe-handover.js
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
const BASE = 'http://127.0.0.1:3001/api/v1'
const TS = Date.now()
const TAG = `HO探针${TS}`
const ids = { u: [], p: [], s: [], o: [], i: [] }

const api = async (m, p, body, token) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body != null ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => null)
  return { status: r.status, code: j?.code, msg: j?.msg, data: j?.data }
}

async function main() {
  const product = await prisma.product.findFirst({ where: { status: 1 } })
  const bu = await prisma.user.create({ data: { wxOpenid: `dev_ho_b_${TS}`, name: TAG, roles: [], status: 1 } }); ids.u.push(bu.id)
  const p = await prisma.purchaser.create({ data: { userId: bu.id, shopName: TAG + '餐馆', contact: '探', phone: '133' + String(TS).slice(-8), address: TAG, deliveryWindows: ['中 10-13'], accountStatus: 2 } }); ids.p.push(p.id)
  const su = await prisma.user.create({ data: { wxOpenid: `dev_ho_s_${TS}`, name: TAG + '档口', roles: [], status: 1 } }); ids.u.push(su.id)
  const s = await prisma.supplier.create({ data: { userId: su.id, stallName: TAG + '档口', address: TAG, status: 1, qualification: {} } }); ids.s.push(s.id)

  const mk = async (n) => {
    const o = await prisma.order.create({ data: { purchaserId: p.id, deliveryDate: new Date(), timeWindow: 2, status: 30, amountOrdered: 100, deliveryFee: 5, payMethod: 2, remark: TAG } }); ids.o.push(o.id)
    const it = await prisma.orderItem.create({ data: { orderId: o.id, productId: product.id, supplierId: s.id, qtyOrdered: 10 + n, qtyDeclared: 10 + n, qtyAccepted: null, salePrice: 2.5, supplyPrice: 2 } }); ids.i.push(it.id)
    return Number(o.id)
  }
  const o1 = await mk(1)   // 单供应商单明细
  const o2 = await mk(2)   // 另一个也单供应商（对照组）

  const login = await api('POST', '/auth/wx-login', { code: `ho_s_${TS}` })
  const token = login.data?.token
  console.log('供应商登录：', login.code === 0 ? 'OK' : JSON.stringify(login))

  for (const oid of [o1, o2]) {
    const ack = await api('POST', '/supplier-fulfill/ack', { orderId: oid }, token)
    const ho = await api('POST', '/supplier-fulfill/handover', { orderId: oid }, token)
    const after = await prisma.order.findUnique({ where: { id: BigInt(oid) }, select: { status: true, amountFinal: true } })
    console.log(`订单 #${oid}：ack code=${ack.code} handover code=${ho.code} msg=${ho.msg || ''} → 状态=${after.status}（40=待配送）`)
  }

  // 清理（按前缀清掉本次与历史残留；handover 会建派送任务，必须先删它）
  const ords = await prisma.order.findMany({ where: { remark: { startsWith: 'HO探针' } }, select: { id: true } })
  const oids = ords.map((o) => o.id)
  const dt = await prisma.deliveryException.deleteMany({ where: { orderId: { in: oids } } })
  const oa = await prisma.orderSupplierAck.deleteMany({ where: { orderId: { in: oids } } })
  const oi = await prisma.orderItem.deleteMany({ where: { orderId: { in: oids } } })
  const od = await prisma.order.deleteMany({ where: { id: { in: oids } } })
  const cpur = await prisma.purchaser.findMany({ where: { shopName: { startsWith: 'HO探针' } }, select: { id: true, userId: true } })
  const csup = await prisma.supplier.findMany({ where: { stallName: { startsWith: 'HO探针' } }, select: { id: true, userId: true } })
  await prisma.purchaser.deleteMany({ where: { id: { in: cpur.map((x) => x.id) } } })
  await prisma.supplier.deleteMany({ where: { id: { in: csup.map((x) => x.id) } } })
  await prisma.user.deleteMany({ where: { OR: [{ wxOpenid: { startsWith: 'dev_ho_' } }] } })
  console.log('清理：exception=' + dt.count + ' ack=' + oa.count + ' item=' + oi.count + ' order=' + od.count)
  console.log('残留回读：', JSON.stringify({
    order: await prisma.order.count({ where: { remark: { startsWith: 'HO探针' } } }),
    purchaser: await prisma.purchaser.count({ where: { shopName: { startsWith: 'HO探针' } } }),
    supplier: await prisma.supplier.count({ where: { stallName: { startsWith: 'HO探针' } } }),
    user: await prisma.user.count({ where: { wxOpenid: { startsWith: 'dev_ho_' } } }),
  }))
  console.log('清理残留：', JSON.stringify({
    order: await prisma.order.count({ where: { remark: TAG } }),
    purchaser: await prisma.purchaser.count({ where: { shopName: TAG + '餐馆' } }),
    supplier: await prisma.supplier.count({ where: { stallName: TAG + '档口' } }),
  }))
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error('FAIL', e); await prisma.$disconnect(); process.exit(1) })
