import { Module } from '@nestjs/common'
import { AdminFinanceController } from './admin-finance.controller'
import { AdminFinanceService } from './admin-finance.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [AdminFinanceController],
  providers: [AdminFinanceService],
  exports: [AdminFinanceService],
})
export class AdminFinanceModule {}
