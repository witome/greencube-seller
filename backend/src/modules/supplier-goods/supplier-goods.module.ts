import { Module } from '@nestjs/common'
import { SupplierGoodsController } from './supplier-goods.controller'
import { SupplierGoodsService } from './supplier-goods.service'

@Module({
  controllers: [SupplierGoodsController],
  providers: [SupplierGoodsService],
  exports: [SupplierGoodsService],
})
export class SupplierGoodsModule {}
