import { Module } from '@nestjs/common'
import { AdminUserController } from './admin-user.controller'
import { AdminUserService } from './admin-user.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [AdminUserController],
  providers: [AdminUserService],
  exports: [AdminUserService],
})
export class AdminUserModule {}
