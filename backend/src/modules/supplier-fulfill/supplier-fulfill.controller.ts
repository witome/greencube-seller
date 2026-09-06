import { Controller, Get, Post, Body, Query } from '@nestjs/common'
import { SupplierFulfillService } from './supplier-fulfill.service'
import { DeclareDto } from './dto/declare.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 供应商履约（契约《开发配套-API接口字段契约》第 7 节）
@Controller('supplier-fulfill')
export class SupplierFulfillController {
  constructor(private readonly service: SupplierFulfillService) {}

  /// 备货单列表
  @Get('stock-list')
  @Roles(Role.SUPPLIER)
  async stockList(@CurrentUser('userId') userId: bigint, @Query() query: any) {
    return this.service.stockList(userId, query)
  }

  /// 申报备货（少交必填原因）
  @Post('declare')
  @Roles(Role.SUPPLIER)
  async declare(@CurrentUser('userId') userId: bigint, @Body() dto: DeclareDto) {
    return this.service.declare(userId, dto)
  }

  /// 交接确认
  @Post('handover')
  @Roles(Role.SUPPLIER)
  async handover(@CurrentUser('userId') userId: bigint, @Body() dto: { orderId: number }) {
    return this.service.handover(userId, dto)
  }
}
