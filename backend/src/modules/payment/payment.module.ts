import { Module } from '@nestjs/common'
import { OrderModule } from '../order/order.module'
import { AuditModule } from '../audit/audit.module'
import { PaymentService } from './payment.service'
import { MockPayController } from './mock-pay.controller'
import { WechatPayClient } from './wechat-pay.client'
import { WechatPayService } from './wechat-pay.service'
import { WechatPayController } from './wechat-pay.controller'

/// 模拟通道路由仅 WX_MOCK_PAY=1 时注册（拍板③=A：生产默认 404）；真实通道恒注册（卡R1）
const mockControllers = process.env.WX_MOCK_PAY === '1' ? [MockPayController] : []

@Module({
  imports: [
    OrderModule, // 回调推进需 OrderService.completePaidOrder（OrderModule 已 export）
    AuditModule, // prepay/refund 写审计
  ],
  controllers: [WechatPayController, ...mockControllers],
  providers: [WechatPayClient, WechatPayService, PaymentService],
})
export class PaymentModule {}
