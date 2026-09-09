import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, OrderStatus } from '../../common/constants/error-codes'
import { DeclareDto } from './dto/declare.dto'
import { AuditService } from '../audit/audit.service'

@Injectable()
export class SupplierFulfillService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /// 根据当前登录用户查供应商身份
  private async getSupplier(userId: bigint) {
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } })
    if (!supplier) throw new BizException(ErrorCode.FORBIDDEN, '当前账号不是供应商')
    return supplier
  }

  // ────────────────────────────────────────
  // 备货单列表：需本供应商备货的订单明细
  // 契约《开发配套-API接口字段契约》第 7 节
  // ────────────────────────────────────────
  async stockList(userId: bigint, query: { date?: string }) {
    const supplier = await this.getSupplier(userId)

    const where: any = {
      supplierId: supplier.id,
      qtyAccepted: null, // 仅显示未确认备货的明细
      order: { status: { in: [OrderStatus.STOCKING] } },
    }
    // 防御：小程序端可能把 undefined 序列化成 "undefined"，new Date("undefined") 会抛异常
    const dateStr = query.date && query.date !== 'undefined' ? query.date : undefined
    if (dateStr) {
      const d = new Date(dateStr)
      if (!Number.isNaN(d.getTime())) where.order = { ...where.order, deliveryDate: d }
    }

    const items = await this.prisma.orderItem.findMany({
      where,
      include: { order: true, product: true },
      orderBy: { orderId: 'asc' },
    })

    // 按订单分组
    const grouped = new Map<number, any>()
    for (const it of items) {
      const oid = Number(it.orderId)
      if (!grouped.has(oid)) {
        grouped.set(oid, {
          orderId: oid,
          deliveryDate: it.order.deliveryDate.toISOString().slice(0, 10),
          declareDeadline: this.deadline(it.order.deliveryDate),
          items: [],
        })
      }
      grouped.get(oid).items.push({
        orderItemId: Number(it.id),
        productName: it.product.name,
        unit: it.product.unit,
        qtyOrdered: Number(it.qtyOrdered),
        qtyDeclared: it.qtyDeclared ? Number(it.qtyDeclared) : null,
        isAutoDeclared: it.isAutoDeclared,
        remark: it.remark,
      })
    }

    return Array.from(grouped.values())
  }

  // ────────────────────────────────────────
  // 异常申报（缺货专用）：有货直接备货、默认满额，无需申报；
  // 仅缺货（少交）时才提交，且必须填缺货原因
  // ────────────────────────────────────────
  async declare(userId: bigint, dto: DeclareDto) {
    const supplier = await this.getSupplier(userId)

    const order = await this.prisma.order.findUnique({
      where: { id: BigInt(dto.orderId) },
      include: { items: true },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (order.status !== OrderStatus.STOCKING) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '订单当前状态不可申报')
    }

    const declaredCount: number[] = []
    await this.prisma.$transaction(async (tx) => {
      for (const it of dto.items) {
        const item = order.items.find((i) => Number(i.id) === it.orderItemId && Number(i.supplierId) === Number(supplier.id))
        if (!item) throw new BizException(ErrorCode.FORBIDDEN, `明细 ${it.orderItemId} 不属于本供应商`)

        if (it.qtyDeclared > Number(item.qtyOrdered)) {
          throw new BizException(ErrorCode.PARAM_ERROR, '申报数量不能超过订购数量')
        }
        if (it.qtyDeclared >= Number(item.qtyOrdered)) {
          throw new BizException(ErrorCode.PARAM_ERROR, `明细 ${it.orderItemId} 不缺货，无需异常申报`)
        }
        if (!it.shortageReason) {
          throw new BizException(ErrorCode.PARAM_ERROR, `明细 ${it.orderItemId} 缺货，必须填写缺货原因`)
        }

        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            qtyDeclared: it.qtyDeclared,
            shortageReason: it.shortageReason,
            isAutoDeclared: 0,
          },
        })
        declaredCount.push(Number(item.id))
      }
    })

    await this.audit.log({
      operatorId: userId,
      action: 'SUPPLIER_DECLARE',
      entity: 'order',
      entityId: Number(dto.orderId),
      before: null,
      after: { supplierId: Number(supplier.id), shortageItems: declaredCount.length },
    })

    return { orderId: Number(dto.orderId), shortageDeclared: declaredCount.length }
  }

  // ────────────────────────────────────────
  // 交接确认（备货完成，等待配送员取货扫码）
  // 真实交接由配送员「扫码取货」触发（courier 模块），此处为供应商侧的「已备好」确认
  // 有货直接备货，默认满额，无需申报校验
  // ────────────────────────────────────────
  async handover(userId: bigint, dto: { orderId: number }) {
    const supplier = await this.getSupplier(userId)
    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(dto.orderId), items: { some: { supplierId: supplier.id } } },
      include: { items: true },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在或不属于本供应商')
    if (order.status !== OrderStatus.STOCKING) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '订单当前状态不可确认备货')
    }

    // 不用验收称重：本供应商明细的「申报量」即最终交付量，直接落 qtyAccepted
    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        if (item.supplierId === null || Number(item.supplierId) !== Number(supplier.id)) continue
        if (item.qtyAccepted === null) {
          const qtyAccepted = item.qtyDeclared !== null ? Number(item.qtyDeclared) : Number(item.qtyOrdered)
          await tx.orderItem.update({
            where: { id: item.id },
            data: { qtyAccepted },
          })
        }
      }
    })

    // 所有供应商都确认备货后，算最终金额并进入「待配送」
    const pending = await this.prisma.orderItem.count({
      where: { orderId: order.id, qtyAccepted: null },
    })
    let status: number = OrderStatus.STOCKING
    if (pending === 0) {
      const allItems = await this.prisma.orderItem.findMany({ where: { orderId: order.id } })
      // 交付金额 = 商品金额（验收数量×销售价）+ 运费
      const amountFinal = allItems.reduce((s, i) => s + Number(i.qtyAccepted) * Number(i.salePrice), 0) + Number(order.deliveryFee)
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.WAIT_DELIVERY, amountFinal: Math.round(amountFinal * 100) / 100 },
      })
      status = OrderStatus.WAIT_DELIVERY
      // 以自动派单为主：订单进入待配送后自动派给最合适的配送员（失败则保留待配送，等运营手动派单）
      await this.autoAssignOrder(order.id)
    }

    await this.audit.log({
      operatorId: userId,
      action: 'SUPPLIER_HANDOVER',
      entity: 'order',
      entityId: Number(order.id),
      before: null,
      after: { supplierId: Number(supplier.id), orderStatus: status },
    })

    return { orderId: Number(order.id), ready: true, status }
  }

  // ────────────────────────────────────────
  // 自动派单：把待配送订单派给最合适的配送员（在线 + 空闲 + 未超单量，按优先级）
  // 与运营后台 autoAssign 共用同一规则；无可用配送员时保持待配送，等运营手动派单
  // ────────────────────────────────────────
  private async autoAssignOrder(orderId: bigint) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { purchaser: true },
    })
    if (!order || order.status !== OrderStatus.WAIT_DELIVERY) return

    const couriers = await this.prisma.courier.findMany({
      where: { status: 1, online: 1, onRoute: 0 },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
    if (!couriers.length) return

    // 统计各配送员当前未完成任务数
    const activeTasks = await this.prisma.deliveryTask.findMany({
      where: { status: { in: [0, 1, 2] } },
      select: { courierId: true },
    })
    const taskCount = new Map<number, number>()
    for (const t of activeTasks) {
      taskCount.set(Number(t.courierId), (taskCount.get(Number(t.courierId)) || 0) + 1)
    }

    // 找第一个未超单量限制的配送员
    let target = null
    for (const c of couriers) {
      if ((taskCount.get(Number(c.id)) || 0) < c.maxOrders) {
        target = c
        break
      }
    }
    if (!target) return

    const stationList = [
      { seq: 1, type: 'deliver', orderId: Number(order.id), shopName: order.purchaser.shopName, address: order.purchaser.address },
    ]
    const routeNo = `R${order.deliveryDate.toISOString().slice(0, 10).replace(/-/g, '')}-${Number(target.id)}`

    await this.prisma.$transaction([
      this.prisma.deliveryTask.create({ data: { courierId: target.id, routeNo, stationList, status: 0 } }),
      this.prisma.order.update({ where: { id: order.id }, data: { status: OrderStatus.ASSIGNED } }),
    ])
  }

  private deadline(deliveryDate: Date): string {
    const hour = parseInt(process.env.DECLARE_DEADLINE_HOUR || '22')
    const d = new Date(deliveryDate)
    d.setDate(d.getDate() - 1)
    return `${d.toISOString().slice(0, 10)} ${String(hour).padStart(2, '0')}:00`
  }
}
