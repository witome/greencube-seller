import { Controller, Get, Post, Body, Param } from '@nestjs/common'
import { OrderShippingService } from './order-shipping.service'
import { Roles, Role } from '../../common/decorators/roles.decorator'
import { BizException, ErrorCode } from '../../common/constants/error-codes'

/**
 * 运营 · 发货信息管理（卡S1 · 2026-09-29）
 *
 * 为什么要有后台入口：微信侧的发货录入是**合规动作**（不录 = 钱冻结、超时发货还会触发支付风险提示），
 * 出问题时运营必须能自己看「这单到底录没录、报什么错、能不能重试」，而不是拿日志去猜。
 * 报备入口对应官方 `opspecialorder`：测试单报备后无需发货，也不会被判超时发货。
 */
@Controller('admin/order-shipping')
export class OrderShippingController {
  constructor(private readonly service: OrderShippingService) {}

  /// 平台侧总状态：是否已开通发货管理 + 是否已完成交易结算管理确认
  @Get('platform-status')
  @Roles(Role.ADMIN)
  async platformStatus() {
    return this.service.platformStatus()
  }

  /// 某订单的发货录入台账（status/attempts/lastError/uploadedAt）
  @Get(':orderId')
  @Roles(Role.ADMIN)
  async status(@Param('orderId') orderId: string) {
    return this.service.status(Number(orderId))
  }

  /// 手动补录/重试（幂等：已录入的直接返回，不会重复占微信的"重新发货"机会）
  @Post(':orderId/upload')
  @Roles(Role.ADMIN)
  async upload(@Param('orderId') orderId: string) {
    return this.service.uploadForOrder(Number(orderId))
  }

  /// 测试单/预售单特殊报备：type 1 预售（必带 delayTo 秒级时间戳）/ 2 测试单
  @Post(':orderId/special-report')
  @Roles(Role.ADMIN)
  async specialReport(@Param('orderId') orderId: string, @Body() body: any) {
    const type = Number(body?.type)
    if (type !== 1 && type !== 2) {
      throw new BizException(ErrorCode.PARAM_ERROR, 'type 只能是 1（预售订单）或 2（测试订单）')
    }
    const delayTo = body?.delayTo != null ? Number(body.delayTo) : undefined
    if (type === 1 && (!delayTo || !Number.isFinite(delayTo))) {
      throw new BizException(ErrorCode.PARAM_ERROR, '预售报备必须给出预计发货时间 delayTo（秒级时间戳）')
    }
    return this.service.reportSpecialOrder(Number(orderId), type as 1 | 2, delayTo)
  }

  /// 立即跑一轮补偿（平时由定时任务自动跑，这里给运营一个"现在就重试"的按钮）
  @Post('retry-pending')
  @Roles(Role.ADMIN)
  async retryPending() {
    return this.service.retryPending()
  }
}
