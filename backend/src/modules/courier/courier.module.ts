import { Module } from '@nestjs/common'
import { CourierController } from './courier.controller'
import { CourierService } from './courier.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [CourierController],
  providers: [CourierService],
  exports: [CourierService],
})
export class CourierModule {}
