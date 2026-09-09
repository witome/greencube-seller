import { Module } from '@nestjs/common'
import { AdminOrderController } from './admin-order.controller'
import { AdminOrderService } from './admin-order.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [AdminOrderController],
  providers: [AdminOrderService],
  exports: [AdminOrderService],
})
export class AdminOrderModule {}
