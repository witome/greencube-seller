import { Module } from '@nestjs/common'
import { RegisterController } from './register.controller'
import { RegisterService } from './register.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [RegisterController],
  providers: [RegisterService],
})
export class RegisterModule {}
