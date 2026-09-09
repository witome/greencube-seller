import { Controller, Get, Post, Body, Param } from '@nestjs/common'
import { AdminOrderService } from './admin-order.service'
import { SplitDto } from './dto/split.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 运营·订单履约（契约《开发配套-API接口字段契约》第 9 节）
@Controller('admin/order')
export class AdminOrderController {
  constructor(private readonly service: AdminOrderService) {}

  /// 待处理订单（待核单 + 待称重）
  @Get('pending')
  @Roles(Role.ADMIN)
  async pendingList() {
    return this.service.pendingList()
  }

  /// 拆单建议：按优先级自动分配
  @Get(':id/split-preview')
  @Roles(Role.ADMIN)
  async splitPreview(@Param('id') id: string) {
    return this.service.splitPreview(Number(id))
  }

  /// 决策 1：核单拆单 / 改拆单
  @Post(':id/split')
  @Roles(Role.ADMIN)
  async split(@Param('id') id: string, @CurrentUser('userId') userId: bigint, @Body() dto: SplitDto) {
    return this.service.split(Number(id), dto, userId)
  }

  /// 一键自动拆单：按供应商优先级 + 可供量自动分配并应用
  @Post(':id/auto-split')
  @Roles(Role.ADMIN)
  async autoSplit(@Param('id') id: string, @CurrentUser('userId') userId: bigint) {
    return this.service.autoSplit(Number(id), userId)
  }

  /// 一键拆单：把所有待确认订单批量自动拆单
  @Post('auto-split-all')
  @Roles(Role.ADMIN)
  async autoSplitAll(@CurrentUser('userId') userId: bigint) {
    return this.service.autoSplitAll(userId)
  }

  /// 缺货二次拆单：对无法交付订单重新分配供应商，恢复为备货中
  @Post(':id/re-split-shortage')
  @Roles(Role.ADMIN)
  async reSplitShortage(@Param('id') id: string, @CurrentUser('userId') userId: bigint) {
    return this.service.reSplitShortage(Number(id), userId)
  }
}
