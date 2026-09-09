import { Module } from '@nestjs/common'
import { SupplierFulfillController } from './supplier-fulfill.controller'
import { SupplierFulfillService } from './supplier-fulfill.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [SupplierFulfillController],
  providers: [SupplierFulfillService],
  exports: [SupplierFulfillService],
})
export class SupplierFulfillModule {}
