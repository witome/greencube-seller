import { Controller, Get, Post, Body, Param } from '@nestjs/common'
import { AdminOrderService } from './admin-order.service'
import { SplitDto } from './dto/split.dto'
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

  /// 决策 1：核单拆单
  @Post(':id/split')
  @Roles(Role.ADMIN)
  async split(@Param('id') id: string, @Body() dto: SplitDto) {
    return this.service.split(Number(id), dto)
  }
}
