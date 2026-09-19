import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common'
import { AdminDispatchService } from './admin-dispatch.service'
import { DispatchDto } from './dto/dispatch.dto'
import { CourierSettingDto } from './dto/courier-setting.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 运营·派送调度（契约《开发配套-API接口字段契约》第 9 节）
@Controller('admin/dispatch')
export class AdminDispatchController {
  constructor(private readonly service: AdminDispatchService) {}

  /// 配送异常工单列表
  @Get('exceptions')
  @Roles(Role.ADMIN)
  async exceptions(@Query() query: any) {
    return this.service.exceptions(query)
  }

  /// 处理异常工单（标记已处理）
  @Put('exceptions/:id')
  @Roles(Role.ADMIN)
  async handleException(@Param('id') id: string, @CurrentUser('userId') userId: bigint) {
    return this.service.handleException(Number(id), userId)
  }

  /// 配送员列表（含接单状态/优先级/单量限制）
  @Get('couriers')
  @Roles(Role.ADMIN)
  async couriers() {
    return this.service.couriers()
  }

  /// 待派送订单
  @Get()
  @Roles(Role.ADMIN)
  async list() {
    return this.service.list()
  }

  /// 配送任务（近期 20 条，含交付留证 proof，只读查看，2026-09-19 拍板卡）
  @Get('tasks')
  @Roles(Role.ADMIN)
  async recentTasks() {
    return this.service.recentTasks()
  }

  /// 指派/改派配送员（创建派送任务）
  @Post()
  @Roles(Role.ADMIN)
  async assign(@CurrentUser('userId') userId: bigint, @Body() dto: DispatchDto) {
    return this.service.assign(userId, dto)
  }

  /// 自动派单（按优先级 + 在线 + 自动接单）
  @Post('auto-assign')
  @Roles(Role.ADMIN)
  async autoAssign(@CurrentUser('userId') userId: bigint) {
    return this.service.autoAssign(userId)
  }

  /// 设置配送员优先级 / 单量限制
  @Put('couriers/:id/settings')
  @Roles(Role.ADMIN)
  async updateSettings(@CurrentUser('userId') userId: bigint, @Param('id') id: string, @Body() dto: CourierSettingDto) {
    return this.service.updateSettings(userId, Number(id), dto)
  }
}
