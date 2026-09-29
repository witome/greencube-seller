import { Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import {
  BizException,
  ErrorCode,
  AccountStatus,
  OrderStatus,
} from '../../common/constants/error-codes'
import { CreateOrderDto } from './dto/create-order.dto'
import { ReceiveOrderDto } from './dto/receive-order.dto'
import { UpdateOrderDto } from './dto/update-order.dto'
import { PayOrderDto } from './dto/pay-order.dto'
import { allocateByPriority } from '../../common/utils/split.util'
import { AuditService } from '../audit/audit.service'
// 卡S2（2026-09-29）：支付/收款状态口径唯一实现 —— 列表/详情/后台对账三处都必须调它，禁止内联判定
import { payStatusOf, hasPayProof, hasWechatPaidRecord } from '../../common/utils/pay-status.util'

@Injectable()
export class OrderService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /// ⚠️ 仅「正常」采购方可下单
  private async assertActivePurchaser(userId: bigint) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser || purchaser.accountStatus !== AccountStatus.ACTIVE) {
      throw new BizException(ErrorCode.ACCOUNT_NOT_ACTIVE)
    }
    return purchaser
  }

  // ────────────────────────────────────────
  // 下单 → status=10（⚠️ 决策 1：此时不拆单）
  // 契约《开发配套-API接口字段契约》第 5 节
  // ────────────────────────────────────────
  async create(userId: bigint, dto: CreateOrderDto) {
    const purchaser = await this.assertActivePurchaser(userId)

    // 校验商品均在售
    const productIds = dto.items.map((i) => BigInt(i.productId))
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    })
    const productMap = new Map(products.map((p) => [Number(p.id), p]))
    for (const it of dto.items) {
      const p = productMap.get(it.productId)
      if (!p || p.status !== 1) throw new BizException(ErrorCode.NOT_FOUND, `商品 ${it.productId} 不存在或已下架`)
    }

    // 计算下单金额（销售价快照）
    const amountOrdered = dto.items.reduce(
      (sum, it) => sum + it.qty * Number(productMap.get(it.productId)!.salePrice),
      0,
    )
    const amountOrderedRounded = Math.round(amountOrdered * 100) / 100
    const urgent = dto.urgent ?? 0
    // 计算运费（满额免运费 / 次日达免运费 / 加急加收）
    const deliveryFee = await this.calcDeliveryFee(amountOrderedRounded, new Date(dto.deliveryDate), urgent)

    const order = await this.prisma.$transaction(async (tx) => {
      const o = await tx.order.create({
        data: {
          purchaserId: purchaser.id,
          deliveryDate: new Date(dto.deliveryDate),
          timeWindow: dto.timeWindow,
          remark: dto.remark,
          shortagePolicy: dto.shortagePolicy ?? 'auto_replace',
          urgent,
          status: OrderStatus.PENDING_CONFIRM,
          amountOrdered: amountOrderedRounded,
          deliveryFee,
          // 订单来源：1 小程序自选（默认）/ 2 AI 客服代下单（dto 可选传入，仅这两值，DTO 已校验）
          source: dto.source ?? 1,
          items: {
            create: dto.items.map((it) => ({
              productId: BigInt(it.productId),
              qtyOrdered: it.qty,
              remark: it.remark ?? null,
              // ⚠️ supplyPrice 拆单时填；salePrice 下单时快照
              salePrice: productMap.get(it.productId)!.salePrice,
            })),
          },
        },
      })
      // 下单后立即自动拆单（按供应商优先级 + 当日可供量）
      await this.autoSplit(tx, o.id)
      // 清空购物车中对应商品：与建单同事务（2026-09-19 卡B 涉订单收口），
      // 杜绝「订单已建、购物车未清」残留导致采购方重复下单
      await tx.cartItem.deleteMany({
        where: { userId, productId: { in: productIds } },
      })
      return o
    })

    // 铁律 3：下单是订单全链路起点（含金额快照 + 下单事务内即时拆单），写审计
    // （2026-09-11 补，闭合审计复核缺口 S1）
    // ⚠️ 高频：落库量与订单量 1:1，代价评估见任务卡「审计量预估」段
    await this.audit.log({
      operatorId: userId,
      action: 'ORDER_CREATE',
      entity: 'order',
      entityId: Number(order.id),
      after: {
        status: order.status,
        purchaserId: Number(purchaser.id),
        itemCount: dto.items.length,
        amountOrdered: Number(order.amountOrdered),
        deliveryFee: Number(order.deliveryFee),
      },
    })

    return { orderId: Number(order.id), status: order.status, amountOrdered: Number(order.amountOrdered), deliveryFee: Number(order.deliveryFee) }
  }

  // ────────────────────────────────────────
  // 计算运费：加急运费与常规运费互斥（单独计，不叠加）
  // 加急：收加急运费（满 urgentFreeThreshold 免加急费）
  // 非加急：次日达免运费 / 满额免运费 / 否则收基础运费
  // ────────────────────────────────────────
  private async calcDeliveryFee(amountOrdered: number, deliveryDate: Date, urgent = 0): Promise<number> {
    const cfg = await this.prisma.platformConfig.findUnique({ where: { key: 'delivery_fee' } })
    const value = (cfg?.value as any) || { fee: 5, freeThreshold: 100, freeNextDay: true, urgentFee: 0, urgentFreeThreshold: 0 }
    const fee = Number(value.fee ?? 5)
    const freeThreshold = Number(value.freeThreshold ?? 100)
    const freeNextDay = !!value.freeNextDay
    const urgentFee = Number(value.urgentFee ?? 0)
    const urgentFreeThreshold = Number(value.urgentFreeThreshold ?? 0)

    // 加急：运费 = 加急运费（单独计，不叠加常规运费；满 urgentFreeThreshold 免加急费）
    if (urgent) {
      if (urgentFreeThreshold > 0 && amountOrdered >= urgentFreeThreshold) return 0
      return Math.round(urgentFee * 100) / 100
    }

    // 非加急：常规运费（次日达免 / 满额免 / 否则基础运费）
    let base = fee
    if (freeNextDay) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
      if (deliveryDate.toISOString().slice(0, 10) === tomorrowStr) base = 0
    }
    if (freeThreshold > 0 && amountOrdered >= freeThreshold) base = 0

    return Math.round(base * 100) / 100
  }

  // ────────────────────────────────────────
  // 订单列表
  // ────────────────────────────────────────
  async list(userId: bigint, query: { status?: string; page?: string; pageSize?: string }) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    const page = Math.max(1, parseInt(query.page || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(query.pageSize || '20')))
    const status = query.status ? parseInt(query.status) : undefined

    const where: any = { purchaserId: purchaser.id }
    if (status) where.status = status

    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { items: true } },
          items: { include: { product: true } },
          // 卡S2（2026-09-29）：支付状态判定需要支付流水（channel/status/paidAt）
          payments: { select: { channel: true, status: true, paidAt: true, createdAt: true, id: true } },
        },
      }),
    ])

    return {
      total,
      list: rows.map((o) => {
        // 卡S2：支付状态判定走唯一实现 pay-status.util（与详情/后台对账同源）
        const onlinePaid = hasWechatPaidRecord(o.payments)
        const proof = hasPayProof(o.payProof)
        const pay = payStatusOf({ payMethod: o.payMethod, status: o.status, onlinePaid, hasProof: proof })
        // 已支付的线上流水取**最新一条**（id 最大）的时间 —— 与 detail 的 onlinePaidAt 取法完全一致
        const paidRec = o.payments
          .filter((p) => p.status === 1 && (p.channel === 'wechat' || p.channel === 'mock'))
          .sort((a, b) => Number(b.id) - Number(a.id))[0]
        return {
          orderId: Number(o.id),
          deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
          timeWindow: o.timeWindow,
          status: o.status,
          statusText: this.statusText(o.status),
          itemCount: o._count.items,
          amountFinal: o.amountFinal ? Number(o.amountFinal) : null,
          // ── 卡S2 新增：支付状态（四档文案唯一来源 = pay-status.util）──
          payStatus: pay.code,
          payStatusText: pay.text,
          onlinePaidAt: paidRec ? (paidRec.paidAt ?? paidRec.createdAt).toISOString() : null,
          paidProofAt: (o.payProof as any)?.paidAt ?? null,
          // 订单明细（商品名 + 数量，供首页展开展示）
          items: o.items.map((it) => ({
            name: it.product?.name ?? '',
            qty: Number(it.qtyOrdered),
            unit: it.product?.unit ?? '',
          })),
        }
      }),
    }
  }

  // ────────────────────────────────────────
  // 订单详情（五数量）
  // ────────────────────────────────────────
  async detail(userId: bigint, orderId: number) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND)

    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(orderId), purchaserId: purchaser.id },
      include: { items: { include: { product: true } } },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')

    // 运费规则（满额免运费 / 次日达免运费 / 加急运费），供前端实时计算运费与展示「满 X 免运费」
    const feeCfg = await this.prisma.platformConfig.findUnique({ where: { key: 'delivery_fee' } })
    const feeValue = (feeCfg?.value as any) || { fee: 5, freeThreshold: 100, freeNextDay: true, urgentFee: 0, urgentFreeThreshold: 0 }
    const baseDeliveryFee = Number(feeValue.fee ?? 5)
    const freeDeliveryThreshold = Number(feeValue.freeThreshold ?? 100)
    const freeNextDay = !!feeValue.freeNextDay
    const urgentFee = Number(feeValue.urgentFee ?? 0)
    const urgentFreeThreshold = Number(feeValue.urgentFreeThreshold ?? 0)

    // 交付确认时间：取本单配送任务的完成时间（配送员「交付确认」时落 completedAt）
    // 任务与订单通过 stationList（JSON 数组）里的 orderId 关联，故用 JSON 包含查询
    const deliveredTask = await this.prisma.deliveryTask.findFirst({
      where: {
        completedAt: { not: null },
        stationList: { array_contains: { orderId: Number(orderId) } },
      },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    })

    // 卡S1（2026-09-29）：COD 单在送达后用「微信直接支付」的**到账时间**。
    // ⚠️ 与 buyerPaidClaimAt / paidProofAt 是**三件不同的事**（卡S2 起采购方页面只展示
    //    后两档「已付款」，不再展示客户声明）：
    //    buyerPaidClaimAt = 采购方点「我已付款」（客户口头称已付，不是资金证据）
    //    paidProofAt      = 配送员上传现金收款凭证（COD 现金核销）
    //    onlinePaidAt     = 微信支付真的到账（有支付流水）；退款后流水置 2 → 这里自动变回 null
    const onlinePaidAt = await this.onlinePaidAt(order.id)
    // 卡S2（2026-09-29）：四档支付状态判定走唯一实现 pay-status.util（与列表/后台对账同源）
    const pay = payStatusOf({
      payMethod: order.payMethod,
      status: order.status,
      onlinePaid: !!onlinePaidAt,
      hasProof: hasPayProof(order.payProof),
    })

    return {
      orderId: Number(order.id),
      status: order.status,
      statusText: this.statusText(order.status),
      timeline: this.timeline(order.status),
      createdAt: order.createdAt.toISOString(),          // 下单时间
      deliveredAt: deliveredTask?.completedAt ? deliveredTask.completedAt.toISOString() : null, // 交付确认时间
      deliveryDate: order.deliveryDate.toISOString().slice(0, 10),
      timeWindow: order.timeWindow,
      remark: order.remark,
      items: order.items.map((it) => ({
        orderItemId: Number(it.id),
        productId: Number(it.productId),
        name: it.product.name,
        unit: it.product.unit,
        remark: it.remark,
        qtyOrdered: Number(it.qtyOrdered),          // ①
        qtyDeclared: it.qtyDeclared ? Number(it.qtyDeclared) : null, // ②
        qtyAccepted: it.qtyAccepted ? Number(it.qtyAccepted) : null, // ③
        qtyReceived: it.qtyReceived ? Number(it.qtyReceived) : null, // ⑤
        isAutoDeclared: it.isAutoDeclared,          // 决策 2 标记
        salePrice: Number(it.salePrice),
        subtotal: Math.round(Number(it.qtyOrdered) * Number(it.salePrice) * 100) / 100,
      })),
      amountOrdered: Number(order.amountOrdered),
      amountFinal: order.amountFinal ? Number(order.amountFinal) : null,
      deliveryFee: Number(order.deliveryFee),
      baseDeliveryFee,
      freeDeliveryThreshold,
      freeNextDay,
      urgentFee,
      urgentFreeThreshold,
      urgent: order.urgent,
      payMethod: order.payMethod,
      // 卡S1（2026-09-29）：COD 送达后付款闭环的三个时间，**三件不同的事**、永不合并：
      //   buyerPaidClaimAt = 采购方点「我已付款」（客户口头称已付，不是资金证据；
      //                      卡S2 起采购方页面不再展示该口径，字段保留仅为兼容老版本小程序包）
      //   paidProofAt      = 配送员上传现金收款凭证（COD 现金核销）
      //   onlinePaidAt     = 微信支付真的到账（有支付流水）；退款后流水置 2 → 自动变回 null
      buyerPaidClaimAt: order.buyerPaidClaimAt ? order.buyerPaidClaimAt.toISOString() : null,
      paidProofAt: (order.payProof as any)?.paidAt ?? null,
      onlinePaidAt,
      // 卡S2（2026-09-29）：四档支付状态（文案唯一来源 = pay-status.util），前端只做展示与配色
      payStatus: pay.code,
      payStatusText: pay.text,
    }
  }

  /// 「线上已收款」时间（没有则 null）。**唯一实现** —— 是否已付走 pay-status.util 的
  /// hasWechatPaidRecord，与列表页内存计算完全同逻辑：最新一条已支付线上流水的 paidAt ?? createdAt
  private async onlinePaidAt(orderId: bigint): Promise<string | null> {
    const recs = await this.prisma.paymentRecord.findMany({
      where: { orderId },
      orderBy: { id: 'desc' },
      select: { channel: true, status: true, paidAt: true, createdAt: true },
    })
    if (!hasWechatPaidRecord(recs)) return null
    const rec = recs.find((r) => r.status === 1 && (r.channel === 'wechat' || r.channel === 'mock'))!
    return (rec.paidAt ?? rec.createdAt).toISOString()
  }

  /**
   * 按**支付单号**查订单详情（卡S1：微信「小程序购物订单」/发货通知跳转专用）。
   *
   * 微信要求订单详情 path 里带 `${商品订单号}`，它会把下单接口的 `out_trade_no` 填进去
   * —— 我们的 `out_trade_no` = `payment_record.payNo`（32 位随机串），**不是订单 id**。
   * 所以这条路由只接收 payNo，换成订单 id 后再复用 detail()（详情口径只有一份）。
   *
   * ⚠️ 越权口径：payNo 命中但订单不属于当前采购方 → 一律 404（不泄露他人订单是否存在）；
   *    格式不对也直接拒（防拿它当模糊查询扫库）。
   */
  async detailByPayNo(userId: bigint, payNo: string) {
    if (!/^[0-9A-Za-z_-]{6,40}$/.test(String(payNo || ''))) {
      throw new BizException(ErrorCode.PARAM_ERROR, '支付单号格式不正确')
    }
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND)
    const rec = await this.prisma.paymentRecord.findUnique({
      where: { payNo },
      select: { orderId: true, order: { select: { purchaserId: true } } },
    })
    if (!rec || rec.order?.purchaserId !== purchaser.id) {
      throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    }
    return this.detail(userId, Number(rec.orderId))
  }

  // ────────────────────────────────────────
  // 取消订单（2026-09-12 拍板 2A+3：配送前可取消）
  // 允许采购方自助取消：待确认(10) / 备货中(30) / 待配送(40)
  // 已派单(45)及之后一律拒绝（提示「已派单，请联系运营处理」）
  // 取消时同步处理：①已支付流水标记「已撤销/待退款」(status=3)；
  // ②拆单痕迹（order_item.supplierId）保留不清（留证据）；
  // ③订单置 91 后天然不可再派单（派单入口都只取 WAIT_DELIVERY）
  // 真实微信退款等接商户号后实现（登记欠账，本卡不做真退款）
  // ────────────────────────────────────────
  async cancel(userId: bigint, orderId: number) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND)

    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(orderId), purchaserId: purchaser.id },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')

    const cancellable: number[] = [OrderStatus.PENDING_CONFIRM, OrderStatus.STOCKING, OrderStatus.WAIT_DELIVERY]
    if (!cancellable.includes(order.status)) {
      // 45 及之后（含配送中/已送达/已完成等）明确告知联系运营；91 已取消等其它状态给通用提示
      const msg = order.status >= OrderStatus.ASSIGNED && order.status !== OrderStatus.CANCELLED
        ? '已派单，请联系运营处理'
        : '当前状态不可取消'
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, msg)
    }

    // 事务：订单置取消 + 已支付流水标记「已撤销/待退款」，要么都成要么都不成
    let revokedPayments = 0
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELLED },
      })

      // 支付流水：仅「已支付(status=1)」标记为 3=已撤销/待退款（按该表现有 Int status 口径扩展）；
      // status=0 待支付的悬挂流水是既有欠账口径（放弃支付，见 payment.service 头注释），本卡不动
      if (order.payMethod === 1) {
        const paid = await tx.paymentRecord.findMany({
          where: { orderId: order.id, status: 1 },
        })
        for (const rec of paid) {
          await tx.paymentRecord.update({
            where: { id: rec.id },
            data: {
              status: 3,
              callbackPayload: [
                ...((rec.callbackPayload as any[]) || []),
                { source: 'order-cancel', revokedAt: new Date().toISOString(), note: '订单取消，流水撤销待退款（真实退款待接商户号）' },
              ],
            },
          })
          revokedPayments++
        }
      }
    })

    // 铁律 3：取消订单属状态变更（含金额撤销），写审计
    // before 必须带「取消时的状态」（区分在哪一步取消：待确认/备货中/待配送）+ 金额
    await this.audit.log({
      operatorId: userId,
      action: 'ORDER_CANCEL',
      entity: 'order',
      entityId: orderId,
      before: {
        status: order.status,
        statusText: this.statusText(order.status),
        payMethod: order.payMethod,
        amountOrdered: Number(order.amountOrdered),
        amountFinal: order.amountFinal ? Number(order.amountFinal) : null,
      },
      after: { status: OrderStatus.CANCELLED, revokedPayments },
    })

    return { orderId, status: OrderStatus.CANCELLED }
  }

  // ────────────────────────────────────────
  // 编辑待确认订单（覆盖式：提交新商品清单，重算金额）
  // ────────────────────────────────────────
  async update(userId: bigint, orderId: number, dto: UpdateOrderDto) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND)

    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(orderId), purchaserId: purchaser.id },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (order.status !== OrderStatus.PENDING_CONFIRM) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '仅待确认订单可修改')
    }
    if (order.payMethod !== 0) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '已支付订单不可修改')
    }

    // 校验商品均在售
    const productIds = dto.items.map((i) => BigInt(i.productId))
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } })
    const productMap = new Map(products.map((p) => [Number(p.id), p]))
    for (const it of dto.items) {
      const p = productMap.get(it.productId)
      if (!p || p.status !== 1) throw new BizException(ErrorCode.NOT_FOUND, `商品 ${it.productId} 不存在或已下架`)
    }

    const amountOrdered = dto.items.reduce((sum, it) => sum + it.qty * Number(productMap.get(it.productId)!.salePrice), 0)
    const amountOrderedRounded = Math.round(amountOrdered * 100) / 100

    // 可选的配送日期/时间段更新（未传则保持不变）
    const deliveryPatch: any = { amountOrdered: amountOrderedRounded }
    // 配送日期：优先用新传的，否则沿用订单原有日期
    const effectiveDeliveryDate = dto.deliveryDate ? new Date(dto.deliveryDate) : order.deliveryDate
    if (dto.deliveryDate) {
      deliveryPatch.deliveryDate = new Date(dto.deliveryDate)
    }
    // ⚠️ 无论是否改日期，只要商品/金额变了就重算运费（满额免运费随金额联动；加急费随 urgent 保留）
    deliveryPatch.deliveryFee = await this.calcDeliveryFee(amountOrderedRounded, effectiveDeliveryDate, order.urgent)
    if (dto.timeWindow !== undefined) deliveryPatch.timeWindow = dto.timeWindow
    if (dto.remark !== undefined) deliveryPatch.remark = dto.remark

    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId: order.id } })
      await tx.orderItem.createMany({
        data: dto.items.map((it) => ({
          orderId: order.id,
          productId: BigInt(it.productId),
          qtyOrdered: it.qty,
          remark: it.remark ?? null,
          salePrice: productMap.get(it.productId)!.salePrice,
        })),
      })
      // 编辑后重新自动拆单（明细重建，supplierId 需按优先级+可供量重新分配）
      await this.autoSplit(tx, order.id)
      await tx.order.update({
        where: { id: order.id },
        data: deliveryPatch,
      })
    })

    // 铁律 3：编辑待确认订单会重算金额并重新拆单，属关键操作，写审计（2026-09-11 补，闭合 S1）
    await this.audit.log({
      operatorId: userId,
      action: 'ORDER_UPDATE',
      entity: 'order',
      entityId: orderId,
      before: { status: order.status, amountOrdered: Number(order.amountOrdered), deliveryFee: Number(order.deliveryFee) },
      after: {
        amountOrdered: amountOrderedRounded,
        deliveryFee: deliveryPatch.deliveryFee,
        itemCount: dto.items.length,
      },
    })

    return { orderId, amountOrdered: Math.round(amountOrdered * 100) / 100 }
  }

  // ────────────────────────────────────────
  // 加急 / 取消加急（仅待确认未支付订单）
  // 加急后运费重算：基础运费规则 + 加急运费
  // ────────────────────────────────────────
  async setUrgent(userId: bigint, orderId: number, urgent: number) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND)

    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(orderId), purchaserId: purchaser.id },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (order.status !== OrderStatus.PENDING_CONFIRM) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '仅待确认订单可设置加急')
    }
    if (order.payMethod !== 0) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '已支付订单不可设置加急')
    }

    const target = urgent ? 1 : 0
    const deliveryFee = await this.calcDeliveryFee(Number(order.amountOrdered), order.deliveryDate, target)

    await this.prisma.order.update({
      where: { id: order.id },
      data: { urgent: target, deliveryFee },
    })

    return { orderId, urgent: target, deliveryFee }
  }

  // ────────────────────────────────────────
  // 选择支付方式（1 微信支付 / 2 货到付款）
  // 2 货到付款：支付生效后自动拆单：按供应商优先级 + 当日可供量分配，订单 10 → 30 备货中
  // 1 微信支付（2026-09-11 拍板）：创建支付流水（payment_record），订单停留 10 待支付；
  //   支付回调到达后经 PaymentService → completePaidOrder 推进 10 → 30（金额口径②=A：下单时刻应付）
  // ────────────────────────────────────────
  async pay(userId: bigint, orderId: number, dto: PayOrderDto) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND)

    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(orderId), purchaserId: purchaser.id },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (order.status !== OrderStatus.PENDING_CONFIRM) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '仅待确认订单可选择支付方式')
    }
    if (order.payMethod !== 0) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '订单已支付')
    }

    // 微信支付：创建支付单即返回，订单不推进（放弃支付则停在 10，仍可手动取消——拍板④ Hermes 补充）
    if (dto.payMethod === 1) {
      const amount = Math.round((Number(order.amountOrdered) + Number(order.deliveryFee)) * 100) / 100
      let payNo = ''
      // 关旧流水 + 建新单 + 审计 同一事务（2026-09-15 涉钱收口：避免"关了旧单、新单没建成"的悬挂状态）
      await this.prisma.$transaction(async (tx) => {
        // 同单历史「待支付」流水先关闭（重开新单，减少悬挂记录）
        await tx.paymentRecord.updateMany({
          where: { orderId: order.id, status: 0 },
          data: { status: 2 },
        })
        const rec = await tx.paymentRecord.create({
          data: {
            orderId: order.id,
            payNo: randomBytes(16).toString('hex'), // 不可枚举随机（拍板③=A）
            channel: 'mock',
            amount,
          },
        })
        payNo = rec.payNo
        // 铁律 3：创建支付流水属金额类关键操作，写审计（2026-09-11 补，闭合 S1）
        await this.audit.log(
          {
            operatorId: userId,
            action: 'ORDER_PAY',
            entity: 'order',
            entityId: orderId,
            before: { payMethod: order.payMethod, status: order.status },
            after: { payMethod: 1, payNo: rec.payNo, amount, status: OrderStatus.PENDING_CONFIRM, note: '微信支付（模拟通道）待回调' },
          },
          tx,
        )
      })
      return {
        orderId,
        payMethod: 1,
        payNo,
        channel: 'mock',
        amount,
        status: OrderStatus.PENDING_CONFIRM,
        note: '微信支付（模拟通道）：待支付回调',
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { payMethod: dto.payMethod },
      })
      // 兼容：仅当整单明细都未拆（无任何 supplierId）时补拆——新流程下单时已自动拆单
      const assigned = await tx.orderItem.count({ where: { orderId: order.id, supplierId: { not: null } } })
      if (assigned === 0) {
        await this.autoSplit(tx, order.id)
      }
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.STOCKING },
      })
    })

    // 铁律 3：选择支付方式会推进订单状态（10→30）并可能触发补拆，写审计（2026-09-11 补，闭合 S1）
    await this.audit.log({
      operatorId: userId,
      action: 'ORDER_PAY',
      entity: 'order',
      entityId: orderId,
      before: { payMethod: order.payMethod, status: order.status },
      after: { payMethod: dto.payMethod, status: OrderStatus.STOCKING, note: '货到付款' },
    })

    return { orderId, payMethod: dto.payMethod, status: OrderStatus.STOCKING, note: '货到付款' }
  }

  /// 支付回调成功后的订单推进（必须在支付事务的 tx 上执行，供 PaymentService 调用）：
  /// 兼容补拆 + payMethod=1 + 订单 10 → 30
  async completePaidOrder(tx: any, orderId: bigint) {
    const order = await tx.order.findUnique({ where: { id: orderId } })
    if (!order || order.status !== OrderStatus.PENDING_CONFIRM) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '订单当前状态不允许支付确认')
    }
    const assigned = await tx.orderItem.count({ where: { orderId: order.id, supplierId: { not: null } } })
    if (assigned === 0) {
      await this.autoSplit(tx, order.id)
    }
    await tx.order.update({
      where: { id: order.id },
      data: { payMethod: 1, status: OrderStatus.STOCKING },
    })
    return { orderId: Number(orderId), payMethod: 1, status: OrderStatus.STOCKING }
  }

  // ────────────────────────────────────────
  // 自动拆单：按供应商优先级（priority 升序）+ 当日可供量分配
  // 无供应商 / 可供量为 0 的商品保留原明细，不分配（运营后续手动改拆单处理）
  // ────────────────────────────────────────
  private async autoSplit(tx: any, orderId: bigint) {
    const items = await tx.orderItem.findMany({ where: { orderId } })
    for (const item of items) {
      const links = await tx.productSupplierLink.findMany({
        where: { productId: item.productId, status: 1 },
        orderBy: { priority: 'asc' },
      })
      if (links.length === 0) continue

      const { allocations } = allocateByPriority(
        links.map((l) => ({
          supplierId: l.supplierId,
          priority: l.priority,
          dailySupply: Number(l.dailySupply),
          supplyPrice: Number(l.supplyPrice),
        })),
        Number(item.qtyOrdered),
      )
      if (allocations.length === 0) continue

      await tx.orderItem.delete({ where: { id: item.id } })
      for (const a of allocations) {
        await tx.orderItem.create({
          data: {
            orderId,
            productId: item.productId,
            supplierId: BigInt(a.supplierId),
            qtyOrdered: a.qty,
            qtyDeclared: a.qty,
            remark: item.remark,
            salePrice: item.salePrice,
            supplyPrice: a.supplyPrice,
          },
        })
      }
    }
  }

  // ────────────────────────────────────────
  // 逐项接受/拒收（决策 3：拒收自动生成售后工单）
  // ────────────────────────────────────────
  async receive(userId: bigint, orderId: number, dto: ReceiveOrderDto) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND)

    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(orderId), purchaserId: purchaser.id },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '仅已送达订单可确认收货')
    }

    const aftersaleIds: number[] = []

    // 明细回填 + 售后工单 + 主单推进 + 审计 同一事务（2026-09-15 涉钱收口：
    // 避免"部分明细已回填/售后单已建、主单没推进"的中间态）
    await this.prisma.$transaction(async (tx) => {
      for (const it of dto.items) {
        const item = await tx.orderItem.findFirst({
          where: { id: BigInt(it.orderItemId), orderId: order.id },
        })
        if (!item) continue

        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            qtyReceived: it.qtyReceived,
            rejectReason: it.rejectReason,
          },
        })

        // 决策 3：拒收差额（验收 − 接受）> 0 时生成售后工单
        const rejectQty = it.rejectQty ?? 0
        if (rejectQty > 0) {
          const aftersale = await tx.aftersaleOrder.create({
            data: {
              orderId: order.id,
              orderItemId: item.id,
              type: 1, // 少货（拒收默认归为少货/品质，可按 rejectReason 细分）
              reason: it.rejectReason,
              qtyDiff: rejectQty,
              amountDiff: rejectQty * Number(item.salePrice),
              status: 0,
            },
          })
          aftersaleIds.push(Number(aftersale.id))
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.COMPLETED },
      })

      // 铁律 3：确认收货属状态变更（含拒收差额定责 + 售后工单生成），写审计（2026-09-11 补，闭合 S1）
      await this.audit.log(
        {
          operatorId: userId,
          action: 'ORDER_RECEIVE',
          entity: 'order',
          entityId: orderId,
          before: { status: order.status },
          after: { status: OrderStatus.COMPLETED, itemCount: dto.items.length, aftersaleIds },
        },
        tx,
      )
    })

    return { orderId, status: OrderStatus.COMPLETED, aftersaleIds }
  }

  // ────────────────────────────────────────
  // 状态文本映射
  // ────────────────────────────────────────
  private statusText(status: number): string {
    const map: Record<number, string> = {
      [OrderStatus.PENDING_CONFIRM]: '待确认',
      [OrderStatus.SPLITTED]: '备货中', // 拆单对采购方不可见，等同于备货中
      [OrderStatus.STOCKING]: '备货中',
      [OrderStatus.WAIT_DELIVERY]: '待配送',
      [OrderStatus.ASSIGNED]: '已派单',
      [OrderStatus.DELIVERING]: '配送中',
      [OrderStatus.DELIVERED]: '已送达',
      [OrderStatus.COMPLETED]: '已完成',
      [OrderStatus.SETTLED]: '已结算',
      [OrderStatus.CANCELLED]: '已取消',
    }
    return map[status] ?? '未知'
  }

  private timeline(status: number) {
    const steps = [
      { status: 10, text: '已下单' },
      { status: 30, text: '备货中' },
      { status: 40, text: '待配送' },
      { status: 50, text: '配送中' },
      { status: 70, text: '已完成' },
    ]
    // 拆单(20) 对采购方等同于备货中(30)，归一化后再定位进度
    const effective = status === OrderStatus.SPLITTED ? OrderStatus.STOCKING : status
    const idx = steps.findIndex((s) => s.status === effective)
    return steps.map((s, i) => ({ ...s, done: i <= idx, current: i === idx }))
  }
}
