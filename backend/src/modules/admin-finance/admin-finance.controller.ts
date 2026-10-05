import { Controller, Get, Post, Put, Body, Query } from '@nestjs/common'
import { IsBoolean } from 'class-validator'
import { AdminFinanceService } from './admin-finance.service'
import { ServiceFeeConfigDto, GenerateSettlementDto } from './dto/finance.dto'
import { DeliveryFeeConfigDto, PayQrDto } from './dto/delivery-fee.dto'
import { HomeContentDto } from './dto/home-content.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 卡CG（2026-10-05）：注册策略 PUT 入参 —— autoApprove 必须是严格布尔。
/// （DTO 定义在 controller 文件内，不新建 dto 文件；全局 ValidationPipe 拦非法值 → 400/1001）
export class RegistrationPolicyDto {
  @IsBoolean()
  autoApprove!: boolean
}

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

  /// 读取首页内容（横幅 / 公告 / 今日特价位，platform_config KV）
  @Get('home-content')
  @Roles(Role.ADMIN)
  async getHomeContent() {
    return this.service.getHomeContent()
  }

  /// 保存首页内容（一次保存三个 KV key，审计 UPDATE_HOME_CONTENT）
  @Put('home-content')
  @Roles(Role.ADMIN)
  async updateHomeContent(@CurrentUser('userId') userId: bigint, @Body() dto: HomeContentDto) {
    return this.service.updateHomeContent(userId, dto)
  }

  /// 卡CG：注册与审核策略（审核窗口期「注册即通过」开关，默认关；仅 ADMIN 可读写）
  @Get('registration-policy')
  @Roles(Role.ADMIN)
  async getRegistrationPolicy() {
    return this.service.getRegistrationPolicy()
  }

  @Put('registration-policy')
  @Roles(Role.ADMIN)
  async updateRegistrationPolicy(@CurrentUser('userId') userId: bigint, @Body() dto: RegistrationPolicyDto) {
    return this.service.updateRegistrationPolicy(userId, dto.autoApprove)
  }

  /// 每日对账（只读：按送达日汇总应收/实收/未收/应付供应商参考值/毛利粗算）
  @Get('daily-reconciliation')
  @Roles(Role.ADMIN)
  async dailyReconciliation(@Query() query: any) {
    return this.service.dailyReconciliation(query)
  }
}
