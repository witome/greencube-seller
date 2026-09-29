import { Module } from '@nestjs/common'
import { WxService } from './wx.service'
import { WxOrderClient } from './wx-order.client'
import { OrderShippingService } from './order-shipping.service'
import { OrderShippingController } from './order-shipping.controller'
import { AuditModule } from '../audit/audit.module'

/// 微信服务端接口
/// - WxService：消息发送能力（订阅消息/客服消息）—— 采购需求的「到货通知」用它
/// - WxOrderClient / OrderShippingService：小程序「发货信息管理」（卡S1）—— 送达后录入发货信息；
///   不做的话用户的钱会被平台冻结（快递 T+10 / 自提·同城配送 T+2 确认收货后才结算）
@Module({
  imports: [AuditModule],
  controllers: [OrderShippingController],
  providers: [WxService, WxOrderClient, OrderShippingService],
  exports: [WxService, WxOrderClient, OrderShippingService],
})
export class WxModule {}
