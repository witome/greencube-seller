import { Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, OrderStatus } from '../../common/constants/error-codes'
import { OrderService } from '../order/order.service'
import { AuditService } from '../audit/audit.service'
import { WechatPayClient } from './wechat-pay.client'

/**
 * 微信支付（APIv3 · 小程序 JSAPI · 公钥模式）—— 卡R1 2026-09-29
 *
 * 两条 prepay 场景（服务端取金额，绝不收前端金额）：
 *  A. 待确认订单付款：status=10 且 payMethod=0，金额 = amountOrdered + deliveryFee（沿用 order.service.pay 口径②=A）
 *  B. COD 送达后「微信直接支付」：payMethod=2 且 status ∈ {60,70}，金额 = amountFinal ?? (amountOrdered + deliveryFee)
 *     —— 该场景订单已交付，回调只落「流水已支付」，**不推进订单**（核销口径仍以 payProof 为准，卡L 拍板不变）。
 *
 * 回调幂等：流水已 status=1 直接返回成功，不重复推进、不新增审计；
 * 金额核对不一致/验签失败：callbackPayload 留痕后拒绝（HTTP 仍回 200 空体，由 controller 处理，避免微信重试风暴）。
 * 订单推进复用 OrderService.completePaidOrder（不另写第二套）。
 */
@Injectable()
export class WechatPayService {
  private readonly logger = new Logger(WechatPayService.name)

  constructor(
    private prisma: PrismaService,
    private orderService: OrderService,
    private audit: AuditService,
    private client: WechatPayClient,
  ) {}

  /// 金额（元）→ 分（Decimal(12,2) 口径下两位小数，round 即可）
  private toCents(amount: number): number {
    return Math.round(amount * 100)
  }

  /**
   * 采购方发起微信支付：校验 → 关旧流水建新流水（事务+审计）→ jsapi 下单 → 返回拉起收银台参数
   * 响应字段为 order.service.pay(payMethod=1) 的向后兼容超集（orderId/payMethod/payNo/amount/status 全保留）
   */
  async prepay(userId: bigint, orderId: number) {
    const purchaser = await this.prisma.purchaser.findUnique({
      where: { userId },
      include: { user: { select: { wxOpenid: true } } },
    })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(orderId), purchaserId: purchaser.id },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (!this.client.isConfigured()) throw new BizException(ErrorCode.INTERNAL_ERROR, '微信支付未配置，请联系运营')

    // 场景判定（金额一律服务端取数）
    const amountOrderedPlusFee = Math.round((Number(order.amountOrdered) + Number(order.deliveryFee)) * 100) / 100
    let amount: number
    let scenario: 'pending' | 'cod-direct'
    if (order.status === OrderStatus.PENDING_CONFIRM && order.payMethod === 0) {
      scenario = 'pending'
      amount = amountOrderedPlusFee
    } else if (order.payMethod === 2 && (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.COMPLETED)) {
      scenario = 'cod-direct'
      amount = order.amountFinal != null ? Number(order.amountFinal) : amountOrderedPlusFee
    } else {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '订单当前状态不允许微信支付')
    }

    const appid = process.env.WX_APPID
    if (!appid) throw new BizException(ErrorCode.INTERNAL_ERROR, 'WX_APPID 未配置')
    const openid = purchaser.user?.wxOpenid
    if (!openid) throw new BizException(ErrorCode.INTERNAL_ERROR, '缺少支付者 openid')

    // 关旧流水 + 建新单 + 审计 同一事务（口径同 order.service.pay 的 payMethod=1 分支）
    let payNo = ''
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentRecord.updateMany({
        where: { orderId: order.id, status: 0 },
        data: { status: 2 },
      })
      const rec = await tx.paymentRecord.create({
        data: {
          orderId: order.id,
          payNo: randomBytes(16).toString('hex'), // 不可枚举随机，作 out_trade_no（≤32 字符）
          channel: 'wechat',
          amount,
        },
      })
      payNo = rec.payNo
      await this.audit.log(
        {
          operatorId: userId,
          action: 'ORDER_PAY',
          entity: 'order',
          entityId: orderId,
          before: { payMethod: order.payMethod, status: order.status },
          after: {
            payMethod: 1,
            payNo: rec.payNo,
            amount,
            status: order.status,
            note: scenario === 'pending' ? '微信支付待回调' : '微信支付待回调（COD 送达后线上支付）',
          },
        },
        tx,
      )
    })

    // jsapi 下单（失败则流水留 0 待超时关闭；用户重试 prepay 时旧流水会被关掉重建）
    const prepayId = await this.client.jsapiPrepay({
      appid,
      description: `绿立方订单${orderId}`,
      outTradeNo: payNo,
      openid,
      totalCents: this.toCents(amount),
      attach: `orderId=${orderId}`,
    })

    const timeStamp = Math.floor(Date.now() / 1000).toString()
    const nonceStr = randomBytes(16).toString('hex')
    const pkg = `prepay_id=${prepayId}`
    const paySign = this.client.signForMiniProgram(appid, timeStamp, nonceStr, pkg)

    return {
      orderId,
      payMethod: 1,
      payNo,
      channel: 'wechat',
      amount,
      status: order.status,
      timeStamp,
      nonceStr,
      package: pkg,
      signType: 'RSA',
      paySign,
      note: '微信支付：用返回参数调 uni.requestPayment',
    }
  }

  /**
   * 微信回调入口：验签 → 解密 → 幂等 → 金额核对 → 推进订单（10→30）/ 落「已支付」
   * 所有被拒分支：callbackPayload 留痕 + 抛 BizException（controller 统一回 200 空体并记日志）
   */
  async confirmPayment(notifyBody: Record<string, any>, headers: Record<string, string | undefined>, rawBody: string) {
    // 解密先行（解密不依赖验签结果）：失败→仅日志（无 out_trade_no 可留痕）
    let payload: Record<string, any>
    try {
      payload = this.client.decryptResource(notifyBody?.resource || {})
    } catch (e: any) {
      this.logger.error(`[wxpay] 回调解密失败：${e?.message || e}`)
      throw new BizException(ErrorCode.PARAM_ERROR, '回调报文解密失败')
    }
    const outTradeNo = String(payload.out_trade_no || '')

    const rec = outTradeNo
      ? await this.prisma.paymentRecord.findUnique({
          where: { payNo: outTradeNo },
          include: { order: { select: { id: true, status: true } } },
        })
      : null
    if (!rec) {
      this.logger.error(`[wxpay] 回调找不到支付单（out_trade_no 前缀核验失败或不存在）`)
      throw new BizException(ErrorCode.NOT_FOUND, '支付单不存在')
    }

    // 验签（公钥模式）：失败→留痕后拒绝
    if (!this.client.verifyNotify(headers, rawBody)) {
      await this.appendCallback(rec.id, { source: 'wechat-notify', rejected: true, reason: '回调验签失败', outTradeNo })
      throw new BizException(ErrorCode.UNAUTHORIZED, '回调验签失败')
    }

    // 非成功状态：留痕不动账
    if (payload.trade_state && payload.trade_state !== 'SUCCESS') {
      await this.appendCallback(rec.id, { source: 'wechat-notify', rejected: true, reason: `交易状态 ${payload.trade_state} 非成功`, outTradeNo })
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, `交易状态 ${payload.trade_state}`)
    }

    // 幂等：已成功的支付单重复通知 → 直接成功返回，不重复落账/推进/审计
    if (rec.status === 1) {
      return { payNo: rec.payNo, status: 1, alreadyConfirmed: true, orderId: Number(rec.orderId) }
    }
    if (rec.status === 2) {
      await this.appendCallback(rec.id, { source: 'wechat-notify', rejected: true, reason: '支付单已关闭（可能已超时关单）', outTradeNo })
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '支付单已关闭')
    }
    if (rec.status === 3) {
      await this.appendCallback(rec.id, { source: 'wechat-notify', rejected: true, reason: '支付单已撤销（订单已取消）', outTradeNo })
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '支付单已撤销')
    }

    // 金额核对（分）：不一致留痕拒绝
    const expectedCents = this.toCents(Number(rec.amount))
    const notifiedCents = Number(payload.amount?.total)
    if (!Number.isFinite(notifiedCents) || notifiedCents !== expectedCents) {
      await this.appendCallback(rec.id, {
        source: 'wechat-notify', rejected: true, reason: '金额不一致', expectedCents, notifiedCents, outTradeNo,
      })
      throw new BizException(ErrorCode.PARAM_ERROR, '回调金额与支付单不一致')
    }

    // 事务：流水置已成功 + 原始回调全量留痕；订单 10→30 复用 completePaidOrder
    // （COD 送达后线上支付场景订单已是 60/70，不推进——核销仍走 payProof 口径）
    const shouldAdvance = rec.order.status === OrderStatus.PENDING_CONFIRM
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentRecord.update({
        where: { id: rec.id },
        data: {
          status: 1,
          paidAt: new Date(),
          callbackPayload: [
            ...((rec.callbackPayload as any[]) || []),
            { ...payload, source: 'wechat-notify', accepted: true, at: new Date().toISOString() },
          ],
        },
      })
      if (shouldAdvance) {
        await this.orderService.completePaidOrder(tx, rec.orderId)
      }
    })
    if (!shouldAdvance) {
      this.logger.log(`[wxpay] 订单 ${Number(rec.orderId)} 非 10 状态（${rec.order.status}），回调仅落已支付不推进`)
    }
    return { payNo: rec.payNo, status: 1, alreadyConfirmed: false, orderId: Number(rec.orderId) }
  }

  /**
   * 真退款（管理员）：调 v3 退款接口，out_refund_no = 'R' + payNo（幂等键），金额以库为准。
   * 流水 status=1（已支付）或 3（已撤销/待退款）可退；成功后流水置 2（关闭）并留痕 + 审计。
   * 重复请求：若该单已按本幂等键退过款，返回 alreadyRefunded=true，不再调微信。
   */
  async refund(orderId: number, operatorId: bigint) {
    // 取该单最新的微信支付流水（1 已支付 / 2 已关闭[可能已退款] / 3 已撤销待退款）
    const rec = await this.prisma.paymentRecord.findFirst({
      where: { orderId: BigInt(orderId), channel: 'wechat', status: { in: [1, 2, 3] } },
      orderBy: { id: 'desc' },
    })
    if (!rec) throw new BizException(ErrorCode.NOT_FOUND, '无可退款的微信支付流水')
    if (rec.status === 0) throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '该支付流水尚未支付，无可退款')

    const outRefundNo = `R${rec.payNo}`
    // 幂等：已退过（callbackPayload 有本幂等键的成功退款记录）→ 直接返回成功，不再调微信
    const history = ((rec.callbackPayload as any[]) || []).filter((x) => x?.source === 'wechat-refund')
    const refunded = history.find((x) => x?.outRefundNo === outRefundNo && x?.accepted === true)
    if (rec.status === 2) {
      if (refunded) return { orderId, refundId: refunded.refundId ?? null, outRefundNo, alreadyRefunded: true }
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '该支付流水已关闭（可能已退款）')
    }

    const totalCents = this.toCents(Number(rec.amount))
    const result = await this.client.refund({
      outTradeNo: rec.payNo,
      outRefundNo,
      refundCents: totalCents,
      totalCents,
      reason: `订单${orderId}退款`,
    })
    const refundStatus = String(result?.status || result?.channel_state || '')
    const refundId = result?.refund_id ?? result?.id ?? null

    if (refundStatus && refundStatus !== 'SUCCESS') {
      // 受理中：留痕 + 审计，不置终态（结果以微信侧后续状态为准）
      await this.appendCallback(rec.id, {
        source: 'wechat-refund', outRefundNo, refundId, refundStatus, accepted: false, reason: '退款受理中', at: new Date().toISOString(),
      })
      await this.audit.log({
        operatorId: operatorId,
        action: 'ORDER_REFUND',
        entity: 'order',
        entityId: orderId,
        before: { recordStatus: rec.status },
        after: { outRefundNo, refundStatus, amount: Number(rec.amount), note: '微信退款受理中' },
      })
      return { orderId, refundId, outRefundNo, refundStatus, alreadyRefunded: false }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentRecord.update({
        where: { id: rec.id },
        data: {
          status: 2,
          callbackPayload: [
            ...((rec.callbackPayload as any[]) || []),
            { source: 'wechat-refund', outRefundNo, refundId, refundStatus: 'SUCCESS', accepted: true, at: new Date().toISOString() },
          ],
        },
      })
      await this.audit.log(
        {
          operatorId: operatorId,
          action: 'ORDER_REFUND',
          entity: 'order',
          entityId: orderId,
          before: { recordStatus: rec.status },
          after: { outRefundNo, refundId, refundStatus: 'SUCCESS', amount: Number(rec.amount), note: '微信退款成功' },
        },
        tx,
      )
    })
    return { orderId, refundId, outRefundNo, refundStatus: 'SUCCESS', alreadyRefunded: false }
  }

  /// 被拒回调全量留痕（口径同 mock 通道）
  private async appendCallback(recordId: bigint, entry: Record<string, any>) {
    const rec = await this.prisma.paymentRecord.findUnique({
      where: { id: recordId },
      select: { callbackPayload: true },
    })
    const list = (rec?.callbackPayload as any[]) || []
    await this.prisma.paymentRecord.update({
      where: { id: recordId },
      data: { callbackPayload: [...list, { ...entry, at: new Date().toISOString() }] },
    })
  }
}
