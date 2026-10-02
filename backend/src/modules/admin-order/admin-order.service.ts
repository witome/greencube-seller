import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, OrderStatus } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { SplitDto } from './dto/split.dto'
import { allocateByPriority } from '../../common/utils/split.util'
import { receivableAmount, round2 } from '../../common/utils/amount.util'
// 卡AH（2026-09-30）：收款凭证 / 线上到账 / 「客户未付款」标记 的判定与读取口径唯一实现
import {
  hasPayProof,
  hasWechatPaidRecord,
  readUnpaidMark,
  unpaidMarkViewOf,
  onlinePaidAtOf,
} from '../../common/utils/pay-status.util'

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

    // 卡BJ（2026-10-02）：备货中订单按「订单 × 供应商」带接单状态（ackAt null = 未接单）。
    // 只对备货中(30)订单查/返回；待核单(10)还没拆供应商，没有接单语义。
    const stockingOrderIds = orders.filter((o) => o.status === OrderStatus.STOCKING).map((o) => o.id)
    const ackRows = stockingOrderIds.length
      ? await this.prisma.orderSupplierAck.findMany({
          where: { orderId: { in: stockingOrderIds } },
          select: { orderId: true, supplierId: true, ackAt: true },
        })
      : []
    const ackByOrder = new Map<number, Map<number, string | null>>()
    for (const a of ackRows) {
      const k = Number(a.orderId)
      if (!ackByOrder.has(k)) ackByOrder.set(k, new Map())
      ackByOrder.get(k)!.set(Number(a.supplierId), a.ackAt ? a.ackAt.toISOString() : null)
    }

    return orders.map((o) => ({
      orderId: Number(o.id),
      shopName: o.purchaser.shopName,
      deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
      // 卡BJ：未接单分钟数的计时起点（运营后台展示口径），UTC ISO 串
      createdAt: o.createdAt.toISOString(),
      status: o.status,
      statusText: this.statusText(o.status),
      amountOrdered: Number(o.amountOrdered),
      // 卡T（2026-09-21）：补返回运费与最终金额，供「金额」列显示含运费总金额
      // 口径唯一实现见 common/utils/amount.util.ts: receivableAmount（与每日对账页同源）
      deliveryFee: Number(o.deliveryFee),
      amountFinal: o.amountFinal != null ? Number(o.amountFinal) : null,
      receivable: receivableAmount(o),
      // 卡BJ：该订单里出现的每个供应商逐个给接单状态（未接单 ackAt=null）
      supplierAcks: o.status === OrderStatus.STOCKING
        ? [...new Set(o.items.map((it) => (it.supplierId !== null ? Number(it.supplierId) : 0)))]
            .filter((sid) => sid !== 0)
            .map((sid) => ({
              supplierId: sid,
              supplierName: supplierNameMap.get(sid) ?? `供应商#${sid}`,
              ackAt: ackByOrder.get(Number(o.id))?.get(sid) ?? null,
            }))
        : [],
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

  // ────────────────────────────────────────
  // 已送达/已完成订单（运营查配送员收款凭证 2026-09-19 拍板卡，只读）
  // payProof 由配送员 COD 收款拍照落库，运营侧仅查看，不提供修改入口
  // ────────────────────────────────────────
  async deliveredList() {
    const orders = await this.prisma.order.findMany({
      where: { status: { in: [OrderStatus.DELIVERED, OrderStatus.COMPLETED] } },
      orderBy: { id: 'desc' },
      take: 400, // 覆盖已送达+已完成全量（当前 311 条），订单号较小的历史单也能查凭证
      include: { purchaser: true },
    })

    // payProof.courierId → 配送员姓名（无关系字段，批量查 user；name 优先 → phone → 配送员#id，与每日对账 nameMap 同口径）
    const courierIds = [
      ...new Set(
        orders
          .map((o) => (o.payProof as any)?.courierId)
          .filter((id): id is number => id != null),
      ),
    ]
    // 卡AH（2026-09-30）：标记人姓名（unpaidMark.by = 配送员 **userId**，与 payProof.courierId 不是一回事）
    const markUserIds = [
      ...new Set(
        orders
          .map((o) => readUnpaidMark(o.payProof)?.by)
          .filter((id): id is number => id != null),
      ),
    ]
    // 两组 id 都是 user.id → 合并成一次查询，分别建两张 map（少打一次库）
    const allUserIds = [...new Set([...courierIds, ...markUserIds])]
    const userRows = allUserIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: allUserIds.map((id) => BigInt(id)) } },
          select: { id: true, name: true, phone: true },
        })
      : []
    const displayName = (u: { id: bigint; name: string | null; phone: string | null }, fallback: string) =>
      u.name || u.phone || fallback
    const courierMap = new Map(
      userRows.map((u) => [Number(u.id), displayName(u, `配送员#${Number(u.id)}`)]),
    )
    const markUserMap = new Map(
      userRows.map((u) => [Number(u.id), displayName(u, `用户#${Number(u.id)}`)]),
    )

    // 卡AH：线上到账判定（标记是否**已被线上支付覆盖**）—— 走 hasWechatPaidRecord，不内联 status/channel 判定
    const paidRecords = orders.length
      ? await this.prisma.paymentRecord.findMany({
          where: { orderId: { in: orders.map((o) => o.id) }, status: 1 },
          select: { orderId: true, channel: true, status: true },
        })
      : []
    const paidByOrder = new Map<number, { channel?: string | null; status: number }[]>()
    for (const p of paidRecords) {
      const k = Number(p.orderId)
      if (!paidByOrder.has(k)) paidByOrder.set(k, [])
      paidByOrder.get(k)!.push({ channel: p.channel, status: p.status })
    }

    return orders.map((o) => {
      // 卡AH：标记的统一展示块（读取/覆盖判定唯一实现 = pay-status.util）
      const onlinePaid = hasWechatPaidRecord(paidByOrder.get(Number(o.id)) ?? [])
      const mark = { ...unpaidMarkViewOf(o.payProof, onlinePaid) }
      mark.byName = mark.by != null ? markUserMap.get(mark.by) ?? null : null
      return {
        orderId: Number(o.id),
        shopName: o.purchaser.shopName,
        deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
        status: o.status,
        statusText: this.statusText(o.status),
        amountOrdered: Number(o.amountOrdered),
        // 卡T（2026-09-21）：同上，补运费与最终金额（与每日对账页 receivableAmount 同源）
        deliveryFee: Number(o.deliveryFee),
        amountFinal: o.amountFinal != null ? Number(o.amountFinal) : null,
        receivable: receivableAmount(o),
        payMethod: o.payMethod,
        payProof: o.payProof ?? null,
        // 卡AH：「有凭证」由后端判定（非空 photos）—— 页面不再内联 `payProof?.photos?.length`
        hasProof: hasPayProof(o.payProof),
        // 卡M（2026-09-19 拍板）：采购方在 COD 单送达后点「我已付款」的时间——仅代表客户称已付，不代表钱已核销
        buyerPaidClaimAt: o.buyerPaidClaimAt ? o.buyerPaidClaimAt.toISOString() : null,
        courierName:
          (o.payProof as any)?.courierId != null
            ? courierMap.get(Number((o.payProof as any).courierId)) ?? null
            : null,
        // 卡AH（2026-09-30）：配送员「客户未付款」标记（**不代表已销账**，只作提醒）
        //   unpaidMarkEffective = 仍生效（未线上到账）→ 列表红标 / 「仅看已标记未收款」筛选看它
        //   unpaidMarkOverridden = 已被线上支付覆盖（标记自动失效）→ 列表显示灰标作历史痕迹
        unpaidMarked: mark.marked,
        unpaidMarkedAt: mark.markedAt,
        unpaidMarkRemark: mark.remark,
        unpaidMarkBy: mark.by,
        unpaidMarkByName: mark.byName,
        unpaidMarkOverridden: mark.overridden,
        unpaidMarkEffective: mark.effective,
      }
    })
  }

  // ────────────────────────────────────────
  // 单订单明细（只读）
  // 卡T（2026-09-21）：每日对账页「看订单」与履约页已送达行的「明细」共用此接口
  // （履约页 /admin/order/delivered 只返回金额与凭证，不含 items，明细按需单独拉）
  // ────────────────────────────────────────
  async orderDetail(orderId: number) {
    const o = await this.prisma.order.findUnique({
      where: { id: BigInt(orderId) },
      include: { purchaser: true, items: { include: { product: true } } },
    })
    if (!o) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')

    const supplierIds = [
      ...new Set(o.items.map((it) => it.supplierId).filter((id): id is bigint => id !== null)),
    ]
    const suppliers = supplierIds.length
      ? await this.prisma.supplier.findMany({ where: { id: { in: supplierIds } } })
      : []
    const supplierNameMap = new Map(suppliers.map((s) => [Number(s.id), s.stallName]))

    // payProof.courierId → 配送员姓名（口径与 deliveredList 一致）
    const courierId = (o.payProof as any)?.courierId
    const courier = courierId != null
      ? await this.prisma.user.findUnique({ where: { id: BigInt(courierId) }, select: { name: true, phone: true } })
      : null

    // 卡AH（2026-09-30）：订单详情「收款记录」时间线要两行数据 ——
    //   ① 橙行：unpaidMark（标记人 / 时间 / 备注）
    //   ② 绿行（**仅当已线上支付**）：线上到账时间 / 金额 / 流水号，并标「已由线上支付覆盖（标记自动失效）」
    // 线上到账判定与时间取法一律走 pay-status.util（hasWechatPaidRecord / onlinePaidAtOf，
    // 与采购方列表·详情、后台对账同源，禁止这里内联 filter）。
    const paymentRecords = await this.prisma.paymentRecord.findMany({
      where: { orderId: o.id },
      select: { id: true, payNo: true, channel: true, amount: true, status: true, paidAt: true, createdAt: true },
      orderBy: { id: 'asc' },
    })
    const onlinePaid = hasWechatPaidRecord(paymentRecords)
    const wechatPaidAmount = round2(
      paymentRecords.filter((p) => p.status === 1).reduce((s, p) => s + Number(p.amount), 0),
    )
    const latestPaid = [...paymentRecords]
      .filter((p) => p.status === 1 && (p.channel === 'wechat' || p.channel === 'mock'))
      .sort((a, b) => Number(b.id) - Number(a.id))[0]

    const mark = { ...unpaidMarkViewOf(o.payProof, onlinePaid) }
    if (mark.by != null) {
      const mu = await this.prisma.user.findUnique({
        where: { id: BigInt(mark.by) },
        select: { name: true, phone: true },
      })
      mark.byName = mu ? mu.name || mu.phone || `用户#${mark.by}` : null
    }

    return {
      orderId: Number(o.id),
      shopName: o.purchaser.shopName,
      deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
      timeWindow: ({ 1: '早', 2: '中', 3: '晚' } as Record<number, string>)[o.timeWindow] ?? String(o.timeWindow),
      status: o.status,
      statusText: this.statusText(o.status),
      amountOrdered: Number(o.amountOrdered),
      deliveryFee: Number(o.deliveryFee),
      amountFinal: o.amountFinal != null ? Number(o.amountFinal) : null,
      receivable: receivableAmount(o),
      payMethod: o.payMethod,
      payProof: o.payProof ?? null,
      hasProof: hasPayProof(o.payProof),
      buyerPaidClaimAt: o.buyerPaidClaimAt ? o.buyerPaidClaimAt.toISOString() : null,
      courierName: courier ? courier.name || courier.phone || null : null,
      // 卡AH：收款记录时间线（前端**只渲染**，判定与覆盖推导都在后端完成）
      unpaidMarked: mark.marked,
      unpaidMarkedAt: mark.markedAt,
      unpaidMarkRemark: mark.remark,
      unpaidMarkBy: mark.by,
      unpaidMarkByName: mark.byName,
      unpaidMarkOverridden: mark.overridden,
      unpaidMarkEffective: mark.effective,
      onlinePaid,
      onlinePaidAt: onlinePaidAtOf(paymentRecords as any),
      wechatPaidAmount,
      // 「流水号」= payment_record.pay_no（不可枚举随机支付单号，对外暴露的回调凭据）
      onlinePayNo: latestPaid?.payNo ?? null,
      onlinePayChannel: latestPaid?.channel ?? null,
      items: o.items.map((it) => ({
        orderItemId: Number(it.id),
        productName: it.product?.name,
        unit: it.product?.unit ?? '',
        supplierName: it.supplierId ? supplierNameMap.get(Number(it.supplierId)) : null,
        qtyOrdered: Number(it.qtyOrdered),
        qtyDeclared: it.qtyDeclared ? Number(it.qtyDeclared) : null,
        qtyAccepted: it.qtyAccepted ? Number(it.qtyAccepted) : null,
        shortageReason: it.shortageReason,
        salePrice: Number(it.salePrice),
      })),
    }
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
