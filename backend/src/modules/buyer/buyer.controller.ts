import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common'
import { BuyerService } from './buyer.service'
import { RegisterDto } from './dto/register.dto'
import { AppealDto } from './dto/appeal.dto'
import { AftersaleDto } from './dto/aftersale.dto'
import { UpdateBuyerProfileDto } from './dto/update-profile.dto'
import { CancelAccountDto } from './dto/cancel-account.dto'
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

  /// 我的申诉记录（决策 6 · 2026-09-19：采购方只能看自己的）
  /// 与 /buyer/appeal、/buyer/pending 同属「账号激活前」链路，故用同一组 ALL_ROLES
  @Get('appeals')
  @Roles(Role.PURCHASER, Role.SUPPLIER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT)
  async myAppeals(@CurrentUser('userId') userId: bigint) {
    return this.service.myAppeals(userId)
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

  /// 自助资料读取（2026-09-11 任务卡 A：只读自己的档案，含执照号展示）
  /// 采购方声明「我已付款」（货到付款订单送达后）
  /// ⚠️ 仅声明、非核销：是否真收到钱仍以 order.payProof（配送员凭证）为准
  /// ⚠️ 卡S2（2026-09-29）起**采购方侧已停用**：新前端不再调用（「我已付款」按钮已下线，
  ///     「已付款」只认线上到账/配送员凭证 —— 见 common/utils/pay-status.util.ts）。
  ///     接口保留只为兼容还在用户手机上的老版本小程序包，等新版发布后再清理（后续欠账）。
  @Post('order/:orderId/claim-paid')
  @Roles(Role.PURCHASER)
  async claimPaid(@CurrentUser('userId') userId: bigint, @Param('orderId') orderId: string) {
    return this.service.claimPaid(userId, Number(orderId))
  }

  @Get('profile')
  @Roles(Role.PURCHASER)
  async myProfile(@CurrentUser('userId') userId: bigint) {
    return this.service.getSelfProfile(userId)
  }

  /// 自助改资料（只按 token 的 userId 改自己；资质/执照/状态不可改，见 DTO 注释）
  @Put('profile')
  @Roles(Role.PURCHASER)
  async updateMyProfile(@CurrentUser('userId') userId: bigint, @Body() dto: UpdateBuyerProfileDto) {
    return this.service.updateSelfProfile(userId, dto)
  }

  /// 首页内容一次取全（横幅/公告/今日特价位，2026-09-11 首页接口化卡）
  /// 卡AA（2026-09-30）：今日特价价格按审核状态脱敏（accountStatus=2 才可见）
  @Get('home-content')
  @Roles(Role.PURCHASER)
  async homeContent(@CurrentUser('userId') userId: bigint) {
    return this.service.getHomeContent(userId)
  }

  /// 卡AC（2026-09-30）：能不能自助注销 —— 返回 { canCancel, blockers }
  /// 门槛：① 进行中订单清空 ② 未结清账款清空（支付状态复用既有四档判定）
  @Get('account/cancel-eligibility')
  @Roles(Role.PURCHASER)
  async cancelEligibility(@CurrentUser('userId') userId: bigint) {
    return this.service.cancelEligibility(userId)
  }

  /// 卡AC：自助注销（只作用于**采购方身份**；账号本身保留，其它身份不受影响）
  /// body 必须显式 { confirm: true }；不满足门槛 → 业务错（文案里带上卡在哪儿）
  @Post('account/cancel')
  @Roles(Role.PURCHASER)
  async cancelAccount(@CurrentUser('userId') userId: bigint, @Body() dto: CancelAccountDto) {
    return this.service.cancelAccount(userId, dto)
  }
}
