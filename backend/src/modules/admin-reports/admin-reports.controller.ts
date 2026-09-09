import { Controller, Get, Query } from '@nestjs/common'
import { AdminReportsService } from './admin-reports.service'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 运营·报表（经营总览 + 分类销售）
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly service: AdminReportsService) {}

  /// 经营总览
  @Get('overview')
  @Roles(Role.ADMIN)
  async overview() {
    return this.service.overview()
  }

  /// 分类销售
  @Get('category-sales')
  @Roles(Role.ADMIN)
  async categorySales(@Query() query: any) {
    return this.service.categorySales(query)
  }
}
