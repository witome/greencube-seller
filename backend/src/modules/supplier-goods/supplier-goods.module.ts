import { Module } from '@nestjs/common'
import { SupplierGoodsController } from './supplier-goods.controller'
import { SupplierGoodsService } from './supplier-goods.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [SupplierGoodsController],
  providers: [SupplierGoodsService],
  exports: [SupplierGoodsService],
})
export class SupplierGoodsModule {}
