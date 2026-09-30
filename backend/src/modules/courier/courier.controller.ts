import { Controller, Get, Post, Body, Param } from '@nestjs/common'
import { CourierService } from './courier.service'
import { DeliverDto, ReportDto, PayProofDto, UnpaidMarkDto } from './dto/courier.dto'
import { SetOnlineDto, SetAutoAcceptDto } from './dto/courier-setting.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 配送员（契约《开发配套-API接口字段契约》第 8 节）
/// ⚠️ 权限铁律：配送员不碰钱，所有接口不返回金额字段
@Controller('courier')
export class CourierController {
  constructor(private readonly service: CourierService) {}

  /// 今日任务与站点序列
  @Get('today-tasks')
  @Roles(Role.COURIER)
  async todayTasks(@CurrentUser('userId') userId: bigint) {
    return this.service.todayTasks(userId)
  }

  /// 审核状态查询（审核中页轮询用；角色放行与 /buyer/pending 同款宽松口径——
  /// 注册后旧 token 的 roles 可能为空，靠 userId 行级隔离保证只读自己）
  @Get('pending')
  @Roles(Role.COURIER, Role.PURCHASER, Role.SUPPLIER, Role.ADMIN, Role.BUSINESS_AGENT)
  async pending(@CurrentUser('userId') userId: bigint) {
    return this.service.pending(userId)
  }

  /// 任务订单总金额（交付确认时供配送员与采购方核对）
  @Get('task/:taskId/amount')
  @Roles(Role.COURIER)
  async taskAmount(@CurrentUser('userId') userId: bigint, @Param('taskId') taskId: string) {
    return this.service.taskAmount(userId, Number(taskId))
  }

  /// 扫码取货
  @Post('task/:taskId/pickup')
  @Roles(Role.COURIER)
  async pickup(@CurrentUser('userId') userId: bigint, @Param('taskId') taskId: string) {
    return this.service.pickup(userId, Number(taskId))
  }

  /// 扫码取货（订单级）
  @Post('order/:orderId/pickup')
  @Roles(Role.COURIER)
  async pickupOrder(@CurrentUser('userId') userId: bigint, @Param('orderId') orderId: string) {
    return this.service.pickupOrder(userId, Number(orderId))
  }

  /// 交付确认（拍照+签名）
  @Post('task/:taskId/deliver')
  @Roles(Role.COURIER)
  async deliver(@CurrentUser('userId') userId: bigint, @Param('taskId') taskId: string, @Body() dto: DeliverDto) {
    return this.service.deliver(userId, Number(taskId), dto)
  }

  /// 异常上报
  @Post('report')
  @Roles(Role.COURIER)
  async report(@CurrentUser('userId') userId: bigint, @Body() dto: ReportDto) {
    return this.service.report(userId, dto)
  }

  /// 收款协助（仅支付码+标记，不作核销）
  @Post('order/:orderId/mark-paid')
  @Roles(Role.COURIER)
  async markPaid(@CurrentUser('userId') userId: bigint, @Param('orderId') orderId: string) {
    return this.service.markPaid(userId, Number(orderId))
  }

  /// 收款二维码（运营后台上传，配送员端展示）
  @Get('pay-qr')
  @Roles(Role.COURIER)
  async payQr() {
    return this.service.payQr()
  }

  /// 货到付款收款凭证（上传客户付款拍照）
  @Post('order/:orderId/pay-proof')
  @Roles(Role.COURIER)
  async payProof(@CurrentUser('userId') userId: bigint, @Param('orderId') orderId: string, @Body() dto: PayProofDto) {
    return this.service.payProof(userId, Number(orderId), dto)
  }

  /// 卡AH（2026-09-30）：标记「客户未付款」（配送员显式声明这单没收到钱）
  /// ⚠️ 不动钱：不改金额 / 不进结算 / 不进账单；**不推进订单状态**（仍停在 60 已送达）。
  ///    客户之后线上付款 → 标记自动失效（线上到账永远优先）；配送员补交收款凭证 → 标记被清除。
  @Post('order/:orderId/unpaid-mark')
  @Roles(Role.COURIER)
  async unpaidMark(
    @CurrentUser('userId') userId: bigint,
    @Param('orderId') orderId: string,
    @Body() dto: UnpaidMarkDto,
  ) {
    return this.service.unpaidMark(userId, Number(orderId), dto)
  }

  /// 接单状态查询（上下线 / 接单模式 / 配送中 / 任务数）
  @Get('status')
  @Roles(Role.COURIER)
  async status(@CurrentUser('userId') userId: bigint) {
    return this.service.getStatus(userId)
  }

  /// 上下线
  @Post('online')
  @Roles(Role.COURIER)
  async setOnline(@CurrentUser('userId') userId: bigint, @Body() dto: SetOnlineDto) {
    return this.service.setOnline(userId, dto.online)
  }

  /// 接单模式
  @Post('auto-accept')
  @Roles(Role.COURIER)
  async setAutoAccept(@CurrentUser('userId') userId: bigint, @Body() dto: SetAutoAcceptDto) {
    return this.service.setAutoAccept(userId, dto.autoAccept)
  }

  /// 出发（进入配送中，无法接新单）
  @Post('depart')
  @Roles(Role.COURIER)
  async depart(@CurrentUser('userId') userId: bigint) {
    return this.service.depart(userId)
  }
}
