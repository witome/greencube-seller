import { Module } from '@nestjs/common'
import { OrderModule } from '../order/order.module'
import { PaymentService } from './payment.service'
import { MockPayController } from './mock-pay.controller'

/// 模拟通道路由仅 WX_MOCK_PAY=1 时注册（拍板③=A：生产默认 404）
const mockControllers = process.env.WX_MOCK_PAY === '1' ? [MockPayController] : []

@Module({
  imports: [OrderModule], // 回调推进需 OrderService.completePaidOrder（OrderModule 已 export）
  controllers: [...mockControllers],
  providers: [PaymentService],
})
export class PaymentModule {}
