import { Module } from '@nestjs/common'
import { BuyerController } from './buyer.controller'
import { BuyerService } from './buyer.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [BuyerController],
  providers: [BuyerService],
  exports: [BuyerService],
})
export class BuyerModule {}
