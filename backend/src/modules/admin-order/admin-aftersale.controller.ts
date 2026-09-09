import { Controller, Get, Body, Param, Query, Post } from '@nestjs/common'
import { AdminAftersaleService } from './admin-aftersale.service'
import { AftersaleHandleDto } from './dto/aftersale-handle.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 运营 · 售后管理（修复单缺陷 3，2026-09-10 新增）
@Controller('admin/aftersale')
export class AdminAftersaleController {
  constructor(private service: AdminAftersaleService) {}

  /// 售后工单列表（分页 + 状态/类型筛选）
  @Get()
  @Roles(Role.ADMIN)
  async list(@Query() query: any) {
    return this.service.list(query)
  }

  /// 售后工单详情
  @Get(':id')
  @Roles(Role.ADMIN)
  async detail(@Param('id') id: string) {
    return this.service.detail(Number(id))
  }

  /// 处理工单（同意补偿 / 驳回 / 关闭）
  @Post(':id/handle')
  @Roles(Role.ADMIN)
  async handle(@Param('id') id: string, @CurrentUser('userId') userId: bigint, @Body() dto: AftersaleHandleDto) {
    return this.service.handle(Number(id), userId, dto)
  }
}
