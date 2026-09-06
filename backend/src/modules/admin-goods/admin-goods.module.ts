import { Module } from '@nestjs/common'
import { AdminGoodsController } from './admin-goods.controller'
import { AdminGoodsService } from './admin-goods.service'

@Module({
  controllers: [AdminGoodsController],
  providers: [AdminGoodsService],
  exports: [AdminGoodsService],
})
export class AdminGoodsModule {}
