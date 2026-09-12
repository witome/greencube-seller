import { Module } from '@nestjs/common'
import { AdminDispatchController } from './admin-dispatch.controller'
import { AdminDispatchService } from './admin-dispatch.service'
import { AutoDispatchRetryService } from './auto-dispatch-retry.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [AdminDispatchController],
  providers: [AdminDispatchService, AutoDispatchRetryService],
  exports: [AdminDispatchService],
})
export class AdminDispatchModule {}
