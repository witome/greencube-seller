import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { OrderStatus } from '../../common/constants/error-codes'
import { PrismaService } from '../../prisma/prisma.service'
import { AdminDispatchService } from './admin-dispatch.service'

/**
 * 派单积压定时重试（2026-09-12 派单积压卡，大辉拍板）
 *
 * 背景：autoAssignOrder 只在「备货完成那一刻」跑一次，候选配送员须 status=1+online=1+onRoute=0，
 *       无候选人时静默 return——不报警、不通知、不重试；配送员点「出发」即 onRoute=1 直到送完，
 *       高峰期新备好的单会静默堆在「待配送」。
 *
 * 修法：默认每 5 分钟（DISPATCH_RETRY_CRON 环境变量可覆盖，6 段 cron）扫出 status=WAIT_DELIVERY
 *       的订单自动重试派单。派单规则完全复用 AdminDispatchService.autoAssign（不另立一套）。
 *
 * 幂等（硬要求）：autoAssign 内置双重防线——①未完成任务引用集合过滤（activeTaskOrderRefs）；
 *       ②事务内按 status=WAIT_DELIVERY 条件认领（认领失败即放弃）。绝不重复派单。
 *       已取消(91)等非 40 状态天然不在扫描范围（含「配送前取消」的订单）。
 *
 * 审计：沿用 AUTO_ASSIGN_DISPATCH（operatorId=0 表示系统触发），仅 assigned>0 时写一条，
 *       避免每 5 分钟刷噪音。积压但派不出去（assigned=0）只记本服务日志 + 运营调度页横幅提示。
 */
@Injectable()
export class AutoDispatchRetryService {
  private readonly logger = new Logger(AutoDispatchRetryService.name)

  constructor(
    private prisma: PrismaService,
    private dispatch: AdminDispatchService,
  ) {}

  /// 定时入口：cron 可用 env DISPATCH_RETRY_CRON 覆盖（默认每 5 分钟）
  @Cron(process.env.DISPATCH_RETRY_CRON || '0 */5 * * * *', { timeZone: 'Asia/Shanghai' })
  async handleCron() {
    await this.runRetry()
  }

  /**
   * 重试核心逻辑（公开方法，便于脚本触发验证）
   * 返回 { backlog 积压单数, assigned 本次派出数, skipped 跳过单号 }
   */
  async runRetry() {
    const backlog = await this.prisma.order.count({ where: { status: OrderStatus.WAIT_DELIVERY } })
    if (!backlog) return { backlog: 0, assigned: 0, skipped: [] }
    const r = await this.dispatch.autoAssign(0n)
    this.logger.log(`[dispatch-retry] backlog=${backlog} assigned=${r.assigned} skipped=${(r.skipped || []).length}`)
    return { backlog, assigned: r.assigned, skipped: r.skipped }
  }
}
