import { Controller, Get, Post, Body, Param } from '@nestjs/common'
import { BuyerService } from './buyer.service'
import { RegisterDto } from './dto/register.dto'
import { AppealDto } from './dto/appeal.dto'
import { AftersaleDto } from './dto/aftersale.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 采购方注册与准入（契约《开发配套-API接口字段契约》第 2 节）
/// ⚠️ 这些接口在账号激活前也需可访问，故用 ALL_ROLES（仅需登录态）
@Controller('buyer')
export class BuyerController {
  constructor(private readonly service: BuyerService) {}

  /// 注册提交 → accountStatus=1 待审核
  @Post('register')
  @Roles(Role.PURCHASER, Role.SUPPLIER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT)
  async register(@CurrentUser('userId') userId: bigint, @Body() dto: RegisterDto) {
    return this.service.register(userId, dto)
  }

  /// 待审核状态与进度步骤条
  @Get('pending')
  @Roles(Role.PURCHASER, Role.SUPPLIER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT)
  async pending(@CurrentUser('userId') userId: bigint) {
    return this.service.pending(userId)
  }

  /// 提交申诉（30 天内仅 1 次）
  @Post('appeal')
  @Roles(Role.PURCHASER, Role.SUPPLIER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT)
  async appeal(@CurrentUser('userId') userId: bigint, @Body() dto: AppealDto) {
    return this.service.appeal(userId, dto)
  }

  /// 催办
  @Post('urge-verify')
  @Roles(Role.PURCHASER, Role.SUPPLIER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT)
  async urgeVerify(@CurrentUser('userId') userId: bigint) {
    return this.service.urgeVerify(userId)
  }

  /// 月度对账单
  @Get('bill/:period')
  @Roles(Role.PURCHASER)
  async bill(@CurrentUser('userId') userId: bigint, @Param('period') period: string) {
    return this.service.bill(userId, period)
  }

  /// 售后申请
  @Post('aftersale')
  @Roles(Role.PURCHASER)
  async submitAftersale(@CurrentUser('userId') userId: bigint, @Body() dto: AftersaleDto) {
    return this.service.submitAftersale(userId, dto)
  }

  /// 我的售后工单（含处理状态，2026-09-10 补，修复单缺陷 3）
  @Get('aftersale')
  @Roles(Role.PURCHASER)
  async myAftersales(@CurrentUser('userId') userId: bigint) {
    return this.service.myAftersales(userId)
  }
}
