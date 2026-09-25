import { Body, Controller, Get, Post } from '@nestjs/common'
import { DemandService } from './demand.service'
import { DemandReportDto, DemandSubscribeDto } from './dto/demand.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/**
 * 买家侧 · 采购需求（采购方身份）
 *
 * ⚠️ 这里的 `POST report` 是**唯一**把「客户要了但没有的菜」写进库的入口。
 *    `/ai/parse` 保持只读（口径 2），前端拿到 parse 结果后单独调本接口上报。
 *    为什么这么拆：所有生产只读探针都依赖「打 /ai/parse 不产生写」这条前提。
 */
@Controller('buyer/demand')
export class BuyerDemandController {
  constructor(private readonly service: DemandService) {}

  /** 授权配置：前端据此决定「到货通知我」按钮显示还是隐藏（未配置时不显示） */
  @Get('subscribe-config')
  @Roles(Role.PURCHASER)
  async subscribeConfig() {
    return this.service.subscribeConfig()
  }

  /**
   * 上报需求（幂等：同一人 + 同一需求 + 同样的话 5 分钟内只记一条）
   * 语义 = 明细 +1、汇总计数重算
   */
  @Post('report')
  @Roles(Role.PURCHASER)
  async report(@CurrentUser('userId') userId: bigint, @Body() dto: DemandReportDto) {
    return this.service.report(userId, dto)
  }

  /** 我的需求（名称 / 状态 / 最后时间 / 是否已通知） */
  @Get('mine')
  @Roles(Role.PURCHASER)
  async mine(@CurrentUser('userId') userId: bigint) {
    return this.service.mine(userId)
  }

  /**
   * 上报 wx.requestSubscribeMessage 的结果 → 落授权额度
   * ⚠️ 授权只在客户端发生，服务端只能靠这个接口知道能不能发
   */
  @Post('subscribe')
  @Roles(Role.PURCHASER)
  async subscribe(@CurrentUser('userId') userId: bigint, @Body() dto: DemandSubscribeDto) {
    return this.service.subscribe(userId, dto)
  }
}
