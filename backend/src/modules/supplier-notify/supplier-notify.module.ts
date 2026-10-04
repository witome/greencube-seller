import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AdminSupplierNotifyController, SupplierNotifyMeController } from './supplier-notify.controller'
import { SupplierNotifyGatewayController } from './supplier-notify-gateway.controller'
import { SupplierNotifyService } from './supplier-notify.service'
import { AuditModule } from '../audit/audit.module'

/// 卡BN-1（2026-10-02）：未接单电话催办（扫描 + 拨打 + 配置 + 台账）
/// 后端专属模块；后台页面 = 卡BN-2、供应商端 = 卡BN-3，文件不重叠。
/// 卡BP-1（2026-10-04）：注册手机专线网关 controller（派发 / 回报 / 心跳，令牌守卫在 controller 文件内）。
@Module({
  imports: [ScheduleModule.forRoot(), AuditModule],
  controllers: [AdminSupplierNotifyController, SupplierNotifyMeController, SupplierNotifyGatewayController],
  providers: [SupplierNotifyService],
})
export class SupplierNotifyModule {}
