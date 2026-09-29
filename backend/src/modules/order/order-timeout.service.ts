import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { OrderStatus } from '../../common/constants/error-codes'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'

/**
 * 订单超时自动关单（卡R1 2026-09-29，补「微信支付抽象层」卡登记的欠账④）
 *
 * 背景：放弃支付会留下 payment_record.status=0 悬挂流水、订单停在 10（待确认）。
 * 修法：默认每 10 分钟（ORDER_TIMEOUT_CRON 环境变量可覆盖，6 段 cron）扫出
 *       「status=10 且 createdAt 早于 ORDER_PAY_TIMEOUT_MINUTES（默认 30）分钟前」的订单 →
 *       订单置取消(91) + 该单 status=0 流水关成 2 + 写审计 ORDER_TIMEOUT_CLOSE（operatorId=0 系统）。
 *
 * 只关「待确认未支付」的单：COD 下单后立即进 30，天然不在扫描范围（不会碰货到付款）；
 * 已取消(91)等其它状态也不在扫描范围。关单用条件更新（仍为 10 才关）防并发重复处理；
 * running 防止上一轮未跑完时 cron 重入。单轮限量 200 单，防止极端积压拖垮单轮。
 */
@Injectable()
export class OrderTimeoutService {
  private readonly logger = new Logger(OrderTimeoutService.name)
  private running = false

  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /// 定时入口：cron 可用 env ORDER_TIMEOUT_CRON 覆盖（默认每 10 分钟）
  @Cron(process.env.ORDER_TIMEOUT_CRON || '0 */10 * * * *', { timeZone: 'Asia/Shanghai' })
  async handleCron() {
    await this.runSweep()
  }

  /**
   * 扫描核心逻辑（公开方法，便于脚本/人工触发验证）
   * 返回 { closed 本次关单数, minutes 超时阈值 }
   */
  async runSweep(): Promise<{ closed: number; minutes: number }> {
    if (this.running) return { closed: 0, minutes: Number(process.env.ORDER_PAY_TIMEOUT_MINUTES || 30) }
    this.running = true
    try {
      const minutes = Number(process.env.ORDER_PAY_TIMEOUT_MINUTES || 30)
      if (!Number.isFinite(minutes) || minutes <= 0) return { closed: 0, minutes }
      const deadline = new Date(Date.now() - minutes * 60_000)
      const orders = await this.prisma.order.findMany({
        where: { status: OrderStatus.PENDING_CONFIRM, createdAt: { lt: deadline } },
        select: { id: true },
        take: 200,
        orderBy: { id: 'asc' },
      })
      if (!orders.length) return { closed: 0, minutes }

      let closed = 0
      for (const o of orders) {
        try {
          await this.prisma.$transaction(async (tx) => {
            // 条件更新防并发：仍是 10 才关（回调/人工操作刚好推进过的单自动跳过）
            const r = await tx.order.updateMany({
              where: { id: o.id, status: OrderStatus.PENDING_CONFIRM },
              data: { status: OrderStatus.CANCELLED },
            })
            if (r.count === 0) return
            const pending = await tx.paymentRecord.findMany({ where: { orderId: o.id, status: 0 } })
            for (const rec of pending) {
              await tx.paymentRecord.update({
                where: { id: rec.id },
                data: {
                  status: 2,
                  callbackPayload: [
                    ...((rec.callbackPayload as any[]) || []),
                    {
                      source: 'order-timeout',
                      closedAt: new Date().toISOString(),
                      note: `支付超时（${minutes} 分钟未支付），流水自动关闭`,
                    },
                  ],
                },
              })
            }
            await this.audit.log(
              {
                operatorId: 0n, // 系统触发（口径同派单重试 AUTO_ASSIGN_DISPATCH）
                action: 'ORDER_TIMEOUT_CLOSE',
                entity: 'order',
                entityId: Number(o.id),
                before: { status: OrderStatus.PENDING_CONFIRM },
                after: {
                  status: OrderStatus.CANCELLED,
                  closedPayments: pending.length,
                  timeoutMinutes: minutes,
                  note: '超时未支付自动关单',
                },
              },
              tx,
            )
            closed++
          })
        } catch (e: any) {
          this.logger.error(`[order-timeout] 关单失败 orderId=${Number(o.id)}：${e?.message || e}`)
        }
      }
      if (closed) this.logger.log(`[order-timeout] 本轮关单 ${closed}（阈值 ${minutes} 分钟）`)
      return { closed, minutes }
    } finally {
      this.running = false
    }
  }
}
