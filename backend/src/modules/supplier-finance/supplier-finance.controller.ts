import { Controller, Get, Param } from '@nestjs/common'
import { SupplierFinanceService } from './supplier-finance.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 供应商结算（契约《开发配套-API接口字段契约》第 7 节）
@Controller('supplier-finance')
export class SupplierFinanceController {
  constructor(private readonly service: SupplierFinanceService) {}

  /// 月度结算单（含服务费扣除行）
  @Get('settlement/:period')
  @Roles(Role.SUPPLIER)
  async settlement(@CurrentUser('userId') userId: bigint, @Param('period') period: string) {
    return this.service.settlement(userId, period)
  }
}
