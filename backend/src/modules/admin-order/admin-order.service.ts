import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, OrderStatus } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { SplitDto } from './dto/split.dto'
import { allocateByPriority } from '../../common/utils/split.util'

@Injectable()
export class AdminOrderService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ────────────────────────────────────────
  // 待处理订单（待核单 status=10 + 备货中 status=30）
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
        unit: it.product?.unit ?? '',
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
  // 支持：待确认订单首次拆单 + 备货中订单「改拆单」
  // 按商品维度聚合（已拆订单的明细按供应商拆了多条，合并回商品再重新分配）
  // ────────────────────────────────────────
  async splitPreview(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: BigInt(orderId) },
      include: { items: { include: { product: true } } },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (order.status !== OrderStatus.PENDING_CONFIRM && order.status !== OrderStatus.STOCKING) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '仅待确认或备货中订单可拆单')
    }

    // 按商品维度聚合（合并已拆分结果）
    const grouped = new Map<number, { productId: number; productName: string; qtyOrdered: number }>()
    for (const item of order.items) {
      const key = Number(item.productId)
      if (!grouped.has(key)) {
        grouped.set(key, { productId: key, productName: item.product?.name ?? '', qtyOrdered: 0 })
      }
      grouped.get(key)!.qtyOrdered += Number(item.qtyOrdered)
    }

    const result = []
    for (const g of grouped.values()) {
      const links = await this.prisma.productSupplierLink.findMany({
        where: { productId: BigInt(g.productId), status: 1 },
        orderBy: { priority: 'asc' },
        include: { supplier: true },
      })
      if (links.length === 0) {
        result.push({ productId: g.productId, productName: g.productName, qtyOrdered: g.qtyOrdered, allocations: [], noSupplier: true })
        continue
      }

      const { allocations, shortage } = allocateByPriority(
        links.map((l) => ({
          supplierId: l.supplierId,
          supplierName: l.supplier.stallName,
          priority: l.priority,
          dailySupply: Number(l.dailySupply),
          supplyPrice: Number(l.supplyPrice),
        })),
        g.qtyOrdered,
      )

      result.push({
        productId: g.productId,
        productName: g.productName,
        qtyOrdered: g.qtyOrdered,
        allocations,
        shortage: shortage > 0 ? shortage : 0,
      })
    }

    return result
  }

  // ────────────────────────────────────────
  // 拆单/改拆单（应用分配，落 supplierId + supplyPrice 快照）
  // 决策 1：按商品维度重建明细，拆完直接进入「备货中」
  // ────────────────────────────────────────
  async split(orderId: number, dto: SplitDto, operatorId?: bigint) {
    const order = await this.prisma.order.findUnique({
      where: { id: BigInt(orderId) },
      include: { items: true },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (order.status !== OrderStatus.PENDING_CONFIRM && order.status !== OrderStatus.STOCKING) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '仅待确认或备货中订单可拆单')
    }

    // 校验：输入的 productId 必须都属于本订单
    const productIds = new Set(order.items.map((i) => Number(i.productId)))
    for (const it of dto.items) {
      if (!productIds.has(it.productId)) {
        throw new BizException(ErrorCode.PARAM_ERROR, `productId ${it.productId} 不属于本订单`)
      }
    }

    // salePrice 快照：按商品取（同一商品 salePrice 一致）
    const salePriceMap = new Map<number, number>()
    for (const item of order.items) {
      if (!salePriceMap.has(Number(item.productId))) {
        salePriceMap.set(Number(item.productId), Number(item.salePrice))
      }
    }
    // 商品备注快照：拆单重建明细时保留采购方备注
    const remarkMap = new Map<number, string | null>()
    for (const item of order.items) {
      if (!remarkMap.has(Number(item.productId))) {
        remarkMap.set(Number(item.productId), item.remark)
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // 决策 1 落点：删除全部明细，按供应商重新生成
      await tx.orderItem.deleteMany({ where: { orderId: BigInt(orderId) } })

      for (const it of dto.items) {
        for (const alloc of it.allocations) {
          const link = await tx.productSupplierLink.findUnique({
            where: { productId_supplierId: { productId: BigInt(it.productId), supplierId: BigInt(alloc.supplierId) } },
          })
          if (!link || link.status !== 1) {
            throw new BizException(ErrorCode.PARAM_ERROR, `供应商 ${alloc.supplierId} 不供应该商品`)
          }
          await tx.orderItem.create({
            data: {
              orderId: BigInt(orderId),
              productId: BigInt(it.productId),
              supplierId: BigInt(alloc.supplierId),
              qtyOrdered: alloc.qty,
              qtyDeclared: alloc.qty, // 默认满额：有货直接备货，缺货再做「异常申报」改小
              remark: remarkMap.get(it.productId) ?? null,
              salePrice: salePriceMap.get(it.productId)!,
              supplyPrice: link.supplyPrice, // ⚠️ 拆单时写供货价快照
            },
          })
        }
      }

      // 拆完直接进入「备货中」
      await tx.order.update({
        where: { id: BigInt(orderId) },
        data: { status: OrderStatus.STOCKING },
      })
    })

    if (operatorId) {
      await this.audit.log({
        operatorId,
        action: order.status === OrderStatus.STOCKING ? 'RE_SPLIT' : 'SPLIT',
        entity: 'order',
        entityId: orderId,
        after: { orderId, allocations: dto.items },
      })
    }

    return { orderId, status: OrderStatus.STOCKING, supplierCount: dto.items.reduce((s, i) => s + i.allocations.length, 0) }
  }

  // ────────────────────────────────────────
  // 一键自动拆单：按供应商优先级 + 当日可供量自动分配并直接应用
  // 与「手动拆单」共用同一套分配算法，落库复用 split
  // ────────────────────────────────────────
  async autoSplit(orderId: number, operatorId?: bigint) {
    const order = await this.prisma.order.findUnique({
      where: { id: BigInt(orderId) },
      include: { items: true },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (order.status !== OrderStatus.PENDING_CONFIRM && order.status !== OrderStatus.STOCKING) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '仅待确认或备货中订单可拆单')
    }

    // 按商品维度聚合
    const grouped = new Map<number, { productId: number; qtyOrdered: number }>()
    for (const item of order.items) {
      const key = Number(item.productId)
      if (!grouped.has(key)) grouped.set(key, { productId: key, qtyOrdered: 0 })
      grouped.get(key)!.qtyOrdered += Number(item.qtyOrdered)
    }

    // 自动分配（主供优先，不足差额流转次供）
    const items: { productId: number; allocations: { supplierId: number; qty: number }[] }[] = []
    for (const g of grouped.values()) {
      const links = await this.prisma.productSupplierLink.findMany({
        where: { productId: BigInt(g.productId), status: 1 },
        orderBy: { priority: 'asc' },
      })
      if (links.length === 0) continue // 无供应商：保留原明细不分配
      const { allocations } = allocateByPriority(
        links.map((l) => ({
          supplierId: l.supplierId,
          priority: l.priority,
          dailySupply: Number(l.dailySupply),
          supplyPrice: Number(l.supplyPrice),
        })),
        g.qtyOrdered,
      )
      if (allocations.length === 0) continue
      items.push({ productId: g.productId, allocations })
    }

    if (!items.length) {
      throw new BizException(ErrorCode.PARAM_ERROR, '该订单无可自动分配的商品（无供应商或可供量为 0）')
    }

    return this.split(orderId, { items }, operatorId)
  }

  // ────────────────────────────────────────
  // 一键拆单：把所有待确认(10)订单自动拆单，逐个处理并统计成败
  // ────────────────────────────────────────
  async autoSplitAll(operatorId?: bigint) {
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING_CONFIRM },
      select: { id: true },
      orderBy: { id: 'asc' },
    })

    let success = 0
    const failed: { orderId: number; reason: string }[] = []
    for (const o of orders) {
      try {
        await this.autoSplit(Number(o.id), operatorId)
        success++
      } catch (e: any) {
        failed.push({ orderId: Number(o.id), reason: e?.message || '拆单失败' })
      }
    }

    return { total: orders.length, success, failed }
  }

  // ────────────────────────────────────────
  // 缺货二次拆单：对无法交付(92)订单重新按优先级+可供量分配供应商，恢复为备货中(30)
  // 用于配送员上报「缺货」异常后，运营重新分配供应商、让新供应商备货
  // ────────────────────────────────────────
  async reSplitShortage(orderId: number, operatorId?: bigint) {
    const order = await this.prisma.order.findUnique({
      where: { id: BigInt(orderId) },
      include: { items: true },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (order.status !== OrderStatus.UNDELIVERABLE) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '仅无法交付(缺货)订单可二次拆单')
    }

    // 按商品聚合（忽略已有供应商，按当前优先级+可供量重新分配）
    const grouped = new Map<number, { productId: number; qtyOrdered: number; salePrice: number; remark: string | null }>()
    for (const item of order.items) {
      const key = Number(item.productId)
      if (!grouped.has(key)) grouped.set(key, { productId: key, qtyOrdered: 0, salePrice: Number(item.salePrice), remark: item.remark })
      grouped.get(key)!.qtyOrdered += Number(item.qtyOrdered)
    }

    let supplierCount = 0
    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId: order.id } })
      for (const g of grouped.values()) {
        const links = await tx.productSupplierLink.findMany({
          where: { productId: BigInt(g.productId), status: 1 },
          orderBy: { priority: 'asc' },
        })
        // 无供应商 / 可供量为 0：保留原明细（不分配，等运营后续处理）
        if (links.length === 0) {
          await tx.orderItem.create({
            data: { orderId: order.id, productId: BigInt(g.productId), qtyOrdered: g.qtyOrdered, remark: g.remark, salePrice: g.salePrice },
          })
          continue
        }
        const { allocations } = allocateByPriority(
          links.map((l) => ({ supplierId: l.supplierId, priority: l.priority, dailySupply: Number(l.dailySupply), supplyPrice: Number(l.supplyPrice) })),
          g.qtyOrdered,
        )
        if (allocations.length === 0) {
          await tx.orderItem.create({
            data: { orderId: order.id, productId: BigInt(g.productId), qtyOrdered: g.qtyOrdered, remark: g.remark, salePrice: g.salePrice },
          })
          continue
        }
        for (const a of allocations) {
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: BigInt(g.productId),
              supplierId: BigInt(a.supplierId),
              qtyOrdered: a.qty,
              qtyDeclared: a.qty,
              remark: g.remark,
              salePrice: g.salePrice,
              supplyPrice: a.supplyPrice,
            },
          })
          supplierCount++
        }
      }
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.STOCKING },
      })
    })

    if (operatorId) {
      await this.audit.log({
        operatorId,
        action: 'RE_SPLIT_SHORTAGE',
        entity: 'order',
        entityId: orderId,
        after: { orderId, supplierCount },
      })
    }

    return { orderId, status: OrderStatus.STOCKING, supplierCount }
  }
}
