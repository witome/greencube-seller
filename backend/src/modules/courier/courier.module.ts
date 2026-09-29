import { Module } from '@nestjs/common'
import { CourierController } from './courier.controller'
import { CourierService } from './courier.service'
import { AuditModule } from '../audit/audit.module'
import { WxModule } from '../wx/wx.module'

@Module({
  imports: [AuditModule, WxModule],
  controllers: [CourierController],
  providers: [CourierService],
  exports: [CourierService],
})
export class CourierModule {}
