import { Module } from '@nestjs/common'
import { AdminPricingController } from './admin-pricing.controller'
import { AdminPricingService } from './admin-pricing.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [AdminPricingController],
  providers: [AdminPricingService],
})
export class AdminPricingModule {}
