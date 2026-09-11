import { Injectable } from '@nestjs/common'
import { createHmac, randomBytes } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, OrderStatus } from '../../common/constants/error-codes'
import { OrderService } from '../order/order.service'

/**
 * 支付抽象层（任务卡 2026-09-11：微信支付抽象层 + 模拟回调）
 * - 通道可插拔：mock（本卡）/ wechat（接商户号后仅新增通道实现，业务代码不动）
 * - 金额口径（拍板②=A）：支付金额 = 下单时刻应付 = amountOrdered + deliveryFee
 * - 回调防伪（拍板③=A）：不可枚举随机 payNo + HMAC-SHA256 签名（PAY_CALLBACK_SECRET）
 *   + 仅 WX_MOCK_PAY=1 注册模拟路由 + 每笔回调全量写 callbackPayload 留痕
 * - 明确欠账（拍板④）：订单超时自动关单未做——放弃支付会留下「状态 0 待支付」悬挂流水，
 *   见《任务卡-微信支付抽象层与模拟回调-20260911.md》五·补
 */
@Injectable()
export class PaymentService {
  constructor(
    private prisma: PrismaService,
    private orderService: OrderService,
  ) {}

  private get mockSecret() {
    return process.env.PAY_CALLBACK_SECRET || ''
  }

  /// 回调签名：HMAC-SHA256(payNo|amount, secret)。amount 经 Number() 规范化（避免 Decimal 精度表示差异）
  private sign(payNo: string, amount: string | number) {
    return createHmac('sha256', this.mockSecret).update(`${payNo}|${Number(amount)}`).digest('hex')
  }

  /// 模拟支付渠道「扣款成功」：前端模拟支付按钮 → 服务端自签 → 走与真实回调完全相同的 confirmPayment 链路
  async mockPay(userId: bigint, payNo: string) {
    const rec = await this.prisma.paymentRecord.findUnique({
      where: { payNo },
      include: { order: { include: { purchaser: { select: { userId: true } } } } },
    })
    if (!rec) throw new BizException(ErrorCode.NOT_FOUND, '支付单不存在')
    // BigInt 归一后比较（JWT 取出的 userId 可能是 string/number，严格等于会类型不等）
    if (BigInt(rec.order.purchaser.userId) !== BigInt(userId)) throw new BizException(ErrorCode.FORBIDDEN)
    const payload = { source: 'mock-pay', payNo, amount: String(rec.amount) }
    return this.confirmPayment(payNo, this.sign(rec.payNo, String(rec.amount)), payload)
  }

  /// 回调入口（无 token，HMAC 验签）：验签 → 幂等 → 事务内推进订单 10→30（复用拆单逻辑）
  async confirmPayment(payNo: string, signature: string, payload: Record<string, any>) {
    const rec = await this.prisma.paymentRecord.findUnique({
      where: { payNo },
      include: { order: { select: { status: true, id: true } } },
    })
    if (!rec) throw new BizException(ErrorCode.NOT_FOUND, '支付单不存在')

    // 防伪：签名不符（或服务端未配密钥）→ 留痕后拒绝
    const expected = this.sign(rec.payNo, String(rec.amount))
    if (!this.mockSecret || signature !== expected) {
      await this.appendCallback(rec.id, { ...payload, signature, rejected: true, reason: '回调签名校验失败' })
      throw new BizException(ErrorCode.UNAUTHORIZED, '回调签名校验失败')
    }

    // 幂等：已成功的支付单重复通知，直接成功返回，不重复落账、不重复推进
    if (rec.status === 1) return { payNo, status: 1, alreadyConfirmed: true, orderId: Number(rec.orderId) }

    if (rec.status === 2) {
      await this.appendCallback(rec.id, { ...payload, signature, rejected: true, reason: '支付单已关闭' })
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '支付单已关闭')
    }
    if (rec.order.status !== OrderStatus.PENDING_CONFIRM) {
      await this.appendCallback(rec.id, {
        ...payload, signature, rejected: true, reason: `订单状态 ${rec.order.status} 不允许支付确认`,
      })
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '订单当前状态不允许支付确认')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentRecord.update({
        where: { id: rec.id },
        data: {
          status: 1,
          paidAt: new Date(),
          callbackPayload: [
            ...((rec.callbackPayload as any[]) || []),
            { ...payload, signature, accepted: true, at: new Date().toISOString() },
          ],
        },
      })
      await this.orderService.completePaidOrder(tx, rec.orderId)
    })
    return { payNo, status: 1, alreadyConfirmed: false, orderId: Number(rec.orderId) }
  }

  /// 被拒回调也全量留痕（拍板③=A 之④）
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
