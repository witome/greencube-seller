import { Controller, Get, Query } from '@nestjs/common'
import { AuditService } from './audit.service'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 审计日志（契约《开发配套-API接口字段契约》第 9 节）
@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  /// 日志查询（分页 + 过滤）
  @Get()
  @Roles(Role.ADMIN)
  async list(@Query() query: any) {
    return this.service.list(query)
  }
}
