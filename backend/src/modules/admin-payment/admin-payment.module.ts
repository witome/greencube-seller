import { Module } from '@nestjs/common'
import { AdminPaymentController } from './admin-payment.controller'
import { AdminPaymentService } from './admin-payment.service'

@Module({
  controllers: [AdminPaymentController],
  providers: [AdminPaymentService],
  exports: [AdminPaymentService],
})
export class AdminPaymentModule {}
