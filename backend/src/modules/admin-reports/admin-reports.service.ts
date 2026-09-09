import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { OrderStatus } from '../../common/constants/error-codes'

@Injectable()
export class AdminReportsService {
  constructor(private prisma: PrismaService) {}

  // ────────────────────────────────────────
  // 经营总览：今日/本月订单数、GMV、待处理、售后、状态分布
  // ────────────────────────────────────────
  async overview() {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [todayOrders, todayGmv, monthOrders, monthGmv, pendingCount, aftersalePending, statusDist] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.order.aggregate({ where: { createdAt: { gte: todayStart } }, _sum: { amountOrdered: true } }),
      this.prisma.order.count({ where: { createdAt: { gte: monthStart } } }),
      this.prisma.order.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { amountOrdered: true } }),
      this.prisma.order.count({
        where: {
          status: {
            in: [OrderStatus.PENDING_CONFIRM, OrderStatus.STOCKING, OrderStatus.WAIT_DELIVERY, OrderStatus.ASSIGNED, OrderStatus.DELIVERING],
          },
        },
      }),
      this.prisma.aftersaleOrder.count({ where: { status: 0 } }),
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    ])

    const statusText: Record<number, string> = {
      [OrderStatus.PENDING_CONFIRM]: '待确认',
      [OrderStatus.STOCKING]: '备货中',
      [OrderStatus.WAIT_DELIVERY]: '待配送',
      [OrderStatus.ASSIGNED]: '已派单',
      [OrderStatus.DELIVERING]: '配送中',
      [OrderStatus.DELIVERED]: '已送达',
      [OrderStatus.COMPLETED]: '已完成',
      [OrderStatus.SETTLED]: '已结算',
      [OrderStatus.CANCELLED]: '已取消',
    }

    return {
      todayOrders,
      todayGmv: Math.round(Number(todayGmv._sum.amountOrdered || 0) * 100) / 100,
      monthOrders,
      monthGmv: Math.round(Number(monthGmv._sum.amountOrdered || 0) * 100) / 100,
      pendingCount,
      aftersalePending,
      statusDist: statusDist.map((s) => ({ status: s.status, statusText: statusText[s.status] || '未知', count: s._count._all })),
    }
  }

  // ────────────────────────────────────────
  // 分类销售（按配送月聚合）
  // ────────────────────────────────────────
  async categorySales(query: { period?: string }) {
    const period = query.period || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    const [year, month] = period.split('-').map(Number)
    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 1)

    const items = await this.prisma.orderItem.findMany({
      where: {
        order: {
          deliveryDate: { gte: start, lt: end },
          status: { not: OrderStatus.CANCELLED },
        },
      },
      include: { product: { include: { category: true } } },
    })

    const byCategory = new Map<bigint, { categoryName: string; sales: number; qty: number }>()
    for (const it of items) {
      const cat = it.product.category
      const amount = Number(it.qtyOrdered) * Number(it.salePrice)
      const cur = byCategory.get(cat.id) || { categoryName: cat.name, sales: 0, qty: 0 }
      cur.sales += amount
      cur.qty += Number(it.qtyOrdered)
      byCategory.set(cat.id, cur)
    }

    const list = [...byCategory.entries()]
      .map(([categoryId, v]) => ({
        categoryId: Number(categoryId),
        categoryName: v.categoryName,
        sales: Math.round(v.sales * 100) / 100,
        qty: Math.round(v.qty * 100) / 100,
      }))
      .sort((a, b) => b.sales - a.sales)

    const totalSales = Math.round(list.reduce((s, x) => s + x.sales, 0) * 100) / 100

    return { period, totalSales, list }
  }
}
