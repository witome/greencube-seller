import { Module } from '@nestjs/common'
import { CourierController } from './courier.controller'
import { CourierService } from './courier.service'
import { AuditModule } from '../audit/audit.module'
import { WxModule } from '../wx/wx.module'
// 卡AG（2026-09-30）：收款凭证落库后要推进订单 60→70（completeOrderOnPayment）
import { OrderModule } from '../order/order.module'

@Module({
  imports: [AuditModule, WxModule, OrderModule],
  controllers: [CourierController],
  providers: [CourierService],
  exports: [CourierService],
})
export class CourierModule {}
