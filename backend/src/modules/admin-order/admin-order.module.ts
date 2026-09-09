import { Module } from '@nestjs/common'
import { AdminOrderController } from './admin-order.controller'
import { AdminAftersaleController } from './admin-aftersale.controller'
import { AdminOrderService } from './admin-order.service'
import { AdminAftersaleService } from './admin-aftersale.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [AdminOrderController, AdminAftersaleController],
  providers: [AdminOrderService, AdminAftersaleService],
  exports: [AdminOrderService],
})
export class AdminOrderModule {}
