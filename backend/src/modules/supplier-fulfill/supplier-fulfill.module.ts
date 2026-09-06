import { Module } from '@nestjs/common'
import { SupplierFulfillController } from './supplier-fulfill.controller'
import { SupplierFulfillService } from './supplier-fulfill.service'

@Module({
  controllers: [SupplierFulfillController],
  providers: [SupplierFulfillService],
  exports: [SupplierFulfillService],
})
export class SupplierFulfillModule {}
