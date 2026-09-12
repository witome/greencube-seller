import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

/// 支付流水状态文案（与 payment_record.status 取值对齐）
/// 3=已撤销/待退款（2026-09-12 补：订单配送前取消时，已支付流水由 cancel 事务标记）
const STATUS_TEXT: Record<number, string> = {
  0: '待支付',
  1: '成功',
  2: '关闭',
  3: '已撤销/待退款',
}

/**
 * 运营后台 · 支付流水查询（**纯只读**）
 *
 * ⚠️ 口径说明（重要，页面必须同步提示）：
 * 本表只记「**线上支付**」（微信支付抽象层落库的 payment_record）。
 * **货到付款（COD）的收款不在这张表里** —— COD 走配送员收款 + 拍照留证（audit 动作 COD_PAY_PROOF），
 * 查看入口在「订单履约」页。运营不得把本页当成全部收款口径。
 *
 * 金额口径沿用已拍板：线上支付金额 = 下单时刻应付额（amountOrdered + deliveryFee）。
 */
@Injectable()
export class AdminPaymentService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: { status?: string; keyword?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, parseInt(query.page || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || '20', 10) || 20))

    const where: any = {}

    // 状态筛选：0 待支付 / 1 成功 / 2 关闭 / 3 已撤销待退款；不传 = 全部
    if (query.status !== undefined && query.status !== null && String(query.status) !== '') {
      const s = Number(query.status)
      if (Number.isInteger(s) && s >= 0 && s <= 3) where.status = s
    }

    // 关键词：同时匹配单号（模糊）与订单号（纯数字时精确匹配）
    const kw = (query.keyword || '').trim()
    if (kw) {
      const or: any[] = [{ payNo: { contains: kw } }]
      if (/^\d+$/.test(kw)) or.push({ orderId: BigInt(kw) })
      where.OR = or
    }

    // 默认排序：createdAt 倒序（最新在前）——写进接口契约，前端不再二次排序
    const [total, rows] = await Promise.all([
      this.prisma.paymentRecord.count({ where }),
      this.prisma.paymentRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { order: { include: { purchaser: { select: { shopName: true } } } } },
      }),
    ])

    return {
      total,
      page,
      pageSize,
      list: rows.map((r) => ({
        id: Number(r.id),
        payNo: r.payNo,
        orderId: Number(r.orderId),
        shopName: r.order?.purchaser?.shopName ?? null,
        channel: r.channel,
        amount: Number(r.amount).toFixed(2),
        status: r.status,
        statusText: STATUS_TEXT[r.status] ?? String(r.status),
        createdAt: r.createdAt.toISOString(),
        paidAt: r.paidAt ? r.paidAt.toISOString() : null,
        // 回调原文（留痕）：列表不展示，详情抽屉只读展示（排查支付异常的唯一线索）
        callbackPayload: r.callbackPayload ?? null,
      })),
    }
  }
}
