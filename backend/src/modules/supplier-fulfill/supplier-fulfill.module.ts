import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { SupplierFulfillController } from './supplier-fulfill.controller'
import { AdminAutoDeclareController } from './admin-auto-declare.controller'
import { SupplierFulfillService } from './supplier-fulfill.service'
import { AutoDeclareService } from './auto-declare.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  // 决策 2 · 申报超时兜底：定时注册放在本模块（AppModule 含未提交的 AI 半成品改动，避免触碰）
  imports: [ScheduleModule.forRoot(), AuditModule],
  controllers: [SupplierFulfillController, AdminAutoDeclareController],
  providers: [SupplierFulfillService, AutoDeclareService],
  exports: [SupplierFulfillService],
})
export class SupplierFulfillModule {}
