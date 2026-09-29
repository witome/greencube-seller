import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common'
import { OrderService } from './order.service'
import { CreateOrderDto } from './dto/create-order.dto'
import { ReceiveOrderDto } from './dto/receive-order.dto'
import { UpdateOrderDto } from './dto/update-order.dto'
import { PayOrderDto } from './dto/pay-order.dto'
import { SetUrgentDto } from './dto/set-urgent.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 订单（契约《开发配套-API接口字段契约》第 5 节）
@Controller('order')
export class OrderController {
  constructor(private readonly service: OrderService) {}

  /// 下单 → status=10（⚠️ 决策 1：此时不拆单）
  @Post()
  @Roles(Role.PURCHASER)
  async create(@CurrentUser('userId') userId: bigint, @Body() dto: CreateOrderDto) {
    return this.service.create(userId, dto)
  }

  /// 订单列表
  @Get()
  @Roles(Role.PURCHASER)
  async list(@CurrentUser('userId') userId: bigint, @Query() query: any) {
    return this.service.list(userId, query)
  }

  /// 订单详情（按**支付单号**直达）—— 卡S1：微信「小程序购物订单」/发货通知跳转用
  /// ⚠️ 微信把 path 里的 `${商品订单号}` 换成下单接口的 out_trade_no（= 我们的 payment_record.payNo）
  @Get('by-pay-no/:payNo')
  @Roles(Role.PURCHASER)
  async detailByPayNo(@CurrentUser('userId') userId: bigint, @Param('payNo') payNo: string) {
    return this.service.detailByPayNo(userId, payNo)
  }

  /// 订单详情（五数量）
  @Get(':id')
  @Roles(Role.PURCHASER)
  async detail(@CurrentUser('userId') userId: bigint, @Param('id') id: string) {
    return this.service.detail(userId, Number(id))
  }

  /// 取消订单（仅待确认）
  @Post(':id/cancel')
  @Roles(Role.PURCHASER)
  async cancel(@CurrentUser('userId') userId: bigint, @Param('id') id: string) {
    return this.service.cancel(userId, Number(id))
  }

  /// 逐项接受/拒收 → 决策 3 自动生成售后工单
  @Post(':id/receive')
  @Roles(Role.PURCHASER)
  async receive(@CurrentUser('userId') userId: bigint, @Param('id') id: string, @Body() dto: ReceiveOrderDto) {
    return this.service.receive(userId, Number(id), dto)
  }

  /// 编辑待确认订单（覆盖式商品清单）
  @Post(':id/update')
  @Roles(Role.PURCHASER)
  async update(@CurrentUser('userId') userId: bigint, @Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.service.update(userId, Number(id), dto)
  }

  /// 选择支付方式（1 微信支付 / 2 货到付款）
  @Post(':id/pay')
  @Roles(Role.PURCHASER)
  async pay(@CurrentUser('userId') userId: bigint, @Param('id') id: string, @Body() dto: PayOrderDto) {
    return this.service.pay(userId, Number(id), dto)
  }

  /// 加急 / 取消加急（仅待确认未支付）
  @Post(':id/urgent')
  @Roles(Role.PURCHASER)
  async setUrgent(@CurrentUser('userId') userId: bigint, @Param('id') id: string, @Body() dto: SetUrgentDto) {
    return this.service.setUrgent(userId, Number(id), dto.urgent)
  }
}
