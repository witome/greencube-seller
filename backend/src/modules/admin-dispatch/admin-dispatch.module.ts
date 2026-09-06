import { Module } from '@nestjs/common'
import { AdminDispatchController } from './admin-dispatch.controller'
import { AdminDispatchService } from './admin-dispatch.service'

@Module({
  controllers: [AdminDispatchController],
  providers: [AdminDispatchService],
  exports: [AdminDispatchService],
})
export class AdminDispatchModule {}
