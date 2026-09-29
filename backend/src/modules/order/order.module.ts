import { Module } from '@nestjs/common'
import { OrderController } from './order.controller'
import { OrderService } from './order.service'
import { OrderTimeoutService } from './order-timeout.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [OrderController],
  providers: [OrderService, OrderTimeoutService],
  exports: [OrderService],
})
export class OrderModule {}
