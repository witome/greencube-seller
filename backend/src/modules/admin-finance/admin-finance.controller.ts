import { Controller, Get, Post, Put, Body, Query } from '@nestjs/common'
import { AdminFinanceService } from './admin-finance.service'
import { ServiceFeeConfigDto, GenerateSettlementDto } from './dto/finance.dto'
import { DeliveryFeeConfigDto, PayQrDto } from './dto/delivery-fee.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 运营·资金与结算（契约《开发配套-API接口字段契约》第 9 节）
@Controller('admin/finance')
export class AdminFinanceController {
  constructor(private readonly service: AdminFinanceService) {}

  /// 结算单列表
  @Get('settlements')
  @Roles(Role.ADMIN)
  async settlements(@Query() query: any) {
    return this.service.settlements(query)
  }

  /// 服务费配置列表（全局 + 分类覆盖）
  @Get('service-fee')
  @Roles(Role.ADMIN)
  async serviceFeeConfigs() {
    return this.service.serviceFeeConfigs()
  }

  /// 服务费调整试算
  @Get('service-fee/preview')
  @Roles(Role.ADMIN)
  async serviceFeePreview(@Query() query: any) {
    return this.service.serviceFeePreview(query)
  }

  /// 保存服务费配置（不追溯已生成结算单）
  @Put('service-fee')
  @Roles(Role.ADMIN)
  async serviceFeeConfig(@CurrentUser('userId') userId: bigint, @Body() dto: ServiceFeeConfigDto) {
    return this.service.serviceFeeConfig(userId, dto)
  }

  /// 生成结算单（决策 3：基数 = Σ 验收数量 × 供货价）
  @Post('generate')
  @Roles(Role.ADMIN)
  async generate(@CurrentUser('userId') userId: bigint, @Body() dto: GenerateSettlementDto) {
    return this.service.generate(dto, userId)
  }

  /// 读取运费规则
  @Get('delivery-fee')
  @Roles(Role.ADMIN)
  async getDeliveryFee() {
    return this.service.getDeliveryFeeConfig()
  }

  /// 保存运费规则（满额免运费 / 次日达免运费）
  @Put('delivery-fee')
  @Roles(Role.ADMIN)
  async updateDeliveryFee(@CurrentUser('userId') userId: bigint, @Body() dto: DeliveryFeeConfigDto) {
    return this.service.updateDeliveryFeeConfig(userId, dto)
  }

  /// 收款二维码（货到付款）
  @Get('pay-qr')
  @Roles(Role.ADMIN)
  async getPayQr() {
    return this.service.getPayQr()
  }

  /// 上传收款二维码（货到付款）
  @Put('pay-qr')
  @Roles(Role.ADMIN)
  async updatePayQr(@CurrentUser('userId') userId: bigint, @Body() dto: PayQrDto) {
    return this.service.updatePayQr(userId, dto)
  }
}
