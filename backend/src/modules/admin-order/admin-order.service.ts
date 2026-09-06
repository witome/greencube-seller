import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, OrderStatus } from '../../common/constants/error-codes'
import { SplitDto } from './dto/split.dto'

@Injectable()
export class AdminOrderService {
  constructor(private prisma: PrismaService) {}

  // ────────────────────────────────────────
  // 待处理订单（待核单 status=10 + 待称重 status=20/30）
  // ────────────────────────────────────────
  async pendingList() {
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.PENDING_CONFIRM, OrderStatus.STOCKING] },
      },
      orderBy: { id: 'asc' },
      include: { purchaser: true, items: { include: { product: true } } },
    })

    // OrderItem 无 supplier 关系字段，批量查供应商名
    const supplierIds = [...new Set(orders.flatMap((o) => o.items.map((it) => it.supplierId).filter((id): id is bigint => id !== null)))]
    const suppliers = await this.prisma.supplier.findMany({ where: { id: { in: supplierIds } } })
    const supplierNameMap = new Map(suppliers.map((s) => [Number(s.id), s.stallName]))

    return orders.map((o) => ({
      orderId: Number(o.id),
      shopName: o.purchaser.shopName,
      deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
      status: o.status,
      statusText: this.statusText(o.status),
      amountOrdered: Number(o.amountOrdered),
      items: o.items.map((it) => ({
        orderItemId: Number(it.id),
        productName: it.product?.name,
        supplierName: it.supplierId ? supplierNameMap.get(Number(it.supplierId)) : null,
        qtyOrdered: Number(it.qtyOrdered),
        qtyDeclared: it.qtyDeclared ? Number(it.qtyDeclared) : null,
        shortageReason: it.shortageReason,
        qtyAccepted: it.qtyAccepted ? Number(it.qtyAccepted) : null,
      })),
    }))
  }

  private statusText(status: number): string {
    const map: Record<number, string> = {
      [OrderStatus.PENDING_CONFIRM]: '待确认（待拆单）',
      [OrderStatus.SPLITTED]: '已拆单（待备货）',
      [OrderStatus.STOCKING]: '备货中',
      [OrderStatus.WAIT_DELIVERY]: '待配送',
      [OrderStatus.DELIVERING]: '配送中',
      [OrderStatus.DELIVERED]: '已送达',
      [OrderStatus.COMPLETED]: '已完成',
      [OrderStatus.SETTLED]: '已结算',
      [OrderStatus.CANCELLED]: '已取消',
    }
    return map[status] ?? '未知'
  }

  // ────────────────────────────────────────
  // 拆单建议：按供货优先级 + 当日可供量自动分配
  // 决策 1：核单时拆单
  // ────────────────────────────────────────
  async splitPreview(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: BigInt(orderId) },
      include: { items: true },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (order.status !== OrderStatus.PENDING_CONFIRM) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '仅待确认订单可拆单')
    }

    const result = []
    for (const item of order.items) {
      const links = await this.prisma.productSupplierLink.findMany({
        where: { productId: item.productId, status: 1 },
        orderBy: { priority: 'asc' },
        include: { supplier: true },
      })
      if (links.length === 0) {
        result.push({ orderItemId: Number(item.id), productName: item.id, allocations: [], noSupplier: true })
        continue
      }

      // 按优先级分配：主供优先满足，不足则差额流转次供
      let remaining = Number(item.qtyOrdered)
      const allocations = []
      for (const link of links) {
        if (remaining <= 0) break
        const take = Math.min(remaining, Number(link.dailySupply))
        if (take > 0) {
          allocations.push({
            supplierId: Number(link.supplierId),
            supplierName: link.supplier.stallName,
            priority: link.priority,
            qty: Math.round(take * 100) / 100,
            supplyPrice: Number(link.supplyPrice),
          })
          remaining = Math.round((remaining - take) * 100) / 100
        }
      }

      result.push({
        orderItemId: Number(item.id),
        productId: Number(item.productId),
        qtyOrdered: Number(item.qtyOrdered),
        allocations,
        shortage: remaining > 0 ? remaining : 0, // 可供量不足以满足的差额
      })
    }

    return result
  }

  // ────────────────────────────────────────
  // 核单拆单（应用分配，落 supplierId + supplyPrice 快照）
  // 决策 1：下单不拆单，核单时才拆
  // ────────────────────────────────────────
  async split(orderId: number, dto: SplitDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: BigInt(orderId) },
      include: { items: true },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (order.status !== OrderStatus.PENDING_CONFIRM) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '仅待确认订单可拆单')
    }

    // 校验：输入的 orderItemId 必须都属于本订单
    const itemIds = new Set(order.items.map((i) => Number(i.id)))
    for (const it of dto.items) {
      if (!itemIds.has(it.orderItemId)) {
        throw new BizException(ErrorCode.PARAM_ERROR, `orderItemId ${it.orderItemId} 不属于本订单`)
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // 决策 1 落点：删除未拆单的明细，按供应商重新生成
      await tx.orderItem.deleteMany({ where: { orderId: BigInt(orderId) } })

      for (const it of dto.items) {
        // 找到原明细拿 productId / salePrice 快照
        const original = order.items.find((i) => Number(i.id) === it.orderItemId)!
        for (const alloc of it.allocations) {
          const link = await tx.productSupplierLink.findUnique({
            where: { productId_supplierId: { productId: original.productId, supplierId: BigInt(alloc.supplierId) } },
          })
          if (!link || link.status !== 1) {
            throw new BizException(ErrorCode.PARAM_ERROR, `供应商 ${alloc.supplierId} 不供应该商品`)
          }
          await tx.orderItem.create({
            data: {
              orderId: BigInt(orderId),
              productId: original.productId,
              supplierId: BigInt(alloc.supplierId),
              qtyOrdered: alloc.qty,
              qtyDeclared: alloc.qty, // 默认满额：有货直接备货，缺货再做「异常申报」改小
              salePrice: original.salePrice,
              supplyPrice: link.supplyPrice, // ⚠️ 拆单时写供货价快照
            },
          })
        }
      }

      // 拆完直接进入「备货中」，供应商不再需要逐项申报
      await tx.order.update({
        where: { id: BigInt(orderId) },
        data: { status: OrderStatus.STOCKING },
      })
    })

    return { orderId, status: OrderStatus.STOCKING, supplierCount: dto.items.reduce((s, i) => s + i.allocations.length, 0) }
  }
}
