import { Module } from '@nestjs/common'
import { SupplierFinanceController } from './supplier-finance.controller'
import { SupplierFinanceService } from './supplier-finance.service'

@Module({
  controllers: [SupplierFinanceController],
  providers: [SupplierFinanceService],
  exports: [SupplierFinanceService],
})
export class SupplierFinanceModule {}
