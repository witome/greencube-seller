import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { OrderStatus } from '../../common/constants/error-codes'
import { SupplierFulfillService } from './supplier-fulfill.service'

/**
 * 决策 2 · 申报超时自动兜底（2026-09-10 补齐）
 *
 * 每日 22:00（申报截止，DECLARE_DEADLINE_HOUR）对「今晚 22:00 截止」
 * 即配送日期 = 明天、状态 = 备货中(STOCKING)的订单，把供应商尚未完成
 * 申报/交接的明细按当日可供量（ProductSupplierLink.dailySupply）自动
 * 兜底申报，并标 is_auto_declared=1。
 *
 * 幂等：只处理 isAutoDeclared=0 且 qtyAccepted=null 且供应商未做过
 * 缺货调整（qtyDeclared=qtyOrdered）的明细；落库走与手动申报相同的
 * applyDeclareUpdate 共用路径，重复触发不会产生双份。
 */
@Injectable()
export class AutoDeclareService {
  private readonly logger = new Logger(AutoDeclareService.name)

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private fulfill: SupplierFulfillService,
  ) {}

  /// 定时入口：cron 可用 env AUTO_DECLARE_CRON 覆盖（默认每日 22:00）
  @Cron(process.env.AUTO_DECLARE_CRON || '0 0 22 * * *', { timeZone: 'Asia/Shanghai' })
  async handleCron() {
    await this.runAutoDeclare()
  }

  /**
   * 兜底核心逻辑（可独立调用，便于手工/脚本触发验证）
   * @param targetDate 配送日期 YYYY-MM-DD；缺省 = 明天（今晚 22:00 截止的那批）
   * @param operatorId 审计操作人；cron 触发为 0（系统），手动触发传当前管理员
   */
  async runAutoDeclare(targetDate?: string, operatorId: bigint = 0n) {
    const date = targetDate || this.tomorrow()
    const dayStart = new Date(`${date}T00:00:00.000Z`)
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000)

    const orders = await this.prisma.order.findMany({
      // 决策 1（修订）：下单即自动拆单，此时订单可能仍为待核单(10)或备货中(30)，均属兜底范围
      where: {
        status: { in: [OrderStatus.PENDING_CONFIRM, OrderStatus.STOCKING] },
        deliveryDate: { gte: dayStart, lt: dayEnd },
      },
      include: { items: true },
    })

    let itemsUpdated = 0
    const orderSummaries: any[] = []

    for (const order of orders) {
      const candidates = order.items.filter(
        (it) =>
          it.supplierId !== null &&
          it.qtyAccepted === null &&
          it.isAutoDeclared === 0 &&
          Number(it.qtyDeclared) === Number(it.qtyOrdered), // 供应商未做缺货调整
      )
      if (candidates.length === 0) continue

      const details: any[] = []
      await this.prisma.$transaction(async (tx) => {
        for (const it of candidates) {
          const link = await this.prisma.productSupplierLink.findUnique({
            where: {
              productId_supplierId: { productId: it.productId, supplierId: it.supplierId! },
            },
          })
          const dailySupply = link ? Number(link.dailySupply) : Number(it.qtyOrdered)
          const autoQty = Math.min(Number(it.qtyOrdered), dailySupply)
          const shortage = autoQty < Number(it.qtyOrdered)
          const updated = await this.fulfill.applyDeclareUpdate(
            tx,
            it.id,
            autoQty,
            shortage ? '22:00 申报截止未收到申报，系统按当日可供量自动兜底' : null,
            1,
          )
          if (updated > 0) {
            itemsUpdated += updated
            details.push({
              orderItemId: Number(it.id),
              supplierId: Number(it.supplierId),
              qtyOrdered: Number(it.qtyOrdered),
              qtyAutoDeclared: autoQty,
              shortage,
            })
          }
        }
      })

      if (details.length > 0) {
        orderSummaries.push({ orderId: Number(order.id), items: details })
        await this.audit.log({
          operatorId,
          action: 'AUTO_DECLARE_FALLBACK',
          entity: 'order',
          entityId: Number(order.id),
          before: null,
          after: { date, autoDeclaredItems: details.length, details },
        })
      }
    }

    this.logger.log(
      `[auto-declare] date=${date} ordersScanned=${orders.length} itemsUpdated=${itemsUpdated}`,
    )
    return { date, ordersScanned: orders.length, itemsUpdated, orders: orderSummaries }
  }

  /// 明天日期（服务器本地时区），即今晚 22:00 申报截止对应的配送日
  private tomorrow(): string {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  }
}
