import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AdminSupplierNotifyController, SupplierNotifyMeController } from './supplier-notify.controller'
import { SupplierNotifyService } from './supplier-notify.service'
import { AuditModule } from '../audit/audit.module'

/// 卡BN-1（2026-10-02）：未接单电话催办（扫描 + 拨打 + 配置 + 台账）
/// 后端专属模块；后台页面 = 卡BN-2、供应商端 = 卡BN-3，文件不重叠。
@Module({
  imports: [ScheduleModule.forRoot(), AuditModule],
  controllers: [AdminSupplierNotifyController, SupplierNotifyMeController],
  providers: [SupplierNotifyService],
})
export class SupplierNotifyModule {}
