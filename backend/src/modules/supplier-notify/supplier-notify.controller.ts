import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'
import { SupplierNotifyService } from './supplier-notify.service'
import { NotifyConfigPutDto, NotifyMePutDto, NotifyPairDto, TestCallDto } from './dto/supplier-notify.dto'

/// 卡BN-1（2026-10-02）：运营侧 · 未接单电话催办（配置 / 列表 / 台账 / 补打 / 扫描）
/// 接口契约冻结（任务书第四节），卡BN-2 后台页面按此对接。
@Controller('admin/supplier-notify')
@Roles(Role.ADMIN)
export class AdminSupplierNotifyController {
  constructor(private readonly service: SupplierNotifyService) {}

  /// 1. 读配置（含 vmsConfigured / callerNumber / templateId / todayStats；AK 不回显）
  @Get('config')
  getConfig() {
    return this.service.getAdminConfig()
  }

  /// 2. 存配置（body 为配置子集；launchAt 仅首次写入；写审计 SUPPLIER_NOTIFY_CONFIG）
  @Put('config')
  putConfig(@CurrentUser('userId') userId: bigint, @Body() dto: NotifyConfigPutDto) {
    return this.service.saveConfig(userId, dto)
  }

  /// 3. 催办列表（备货中订单 × 供应商）
  @Get('list')
  list() {
    return this.service.list()
  }

  /// 4. 拨打台账（orderId/supplierId 可选过滤）
  @Get('records')
  records(@Query() query: { orderId?: string; supplierId?: string }) {
    return this.service.records(query)
  }

  /// 5. 人工补打一通
  @Post('call')
  call(@CurrentUser('userId') userId: bigint, @Body() dto: NotifyPairDto) {
    return this.service.manualCall(dto, userId)
  }

  /// 6. 运营自测拨打（dry-run 时返回 { dryRun:true } 并写审计）
  @Post('test-call')
  testCall(@CurrentUser('userId') userId: bigint, @Body() dto: TestCallDto) {
    return this.service.testCall(dto, userId)
  }

  /// 7. 标记已处理（remindStopped=1，不再自动拨打）
  @Post('mark-handled')
  markHandled(@CurrentUser('userId') userId: bigint, @Body() dto: NotifyPairDto) {
    return this.service.markHandled(dto, userId)
  }

  /// 8. 手动触发一次扫描（自测/取证，不必等 cron）
  @Post('scan-once')
  scanOnce() {
    return this.service.scanOnce()
  }
}

/// 卡BN-1：供应商侧 · 自己的拨打开关（卡BN-3 页面按此对接）
@Controller('supplier-notify')
export class SupplierNotifyMeController {
  constructor(private readonly service: SupplierNotifyService) {}

  /// 9. 读自己的开关
  @Get('me')
  @Roles(Role.SUPPLIER)
  me(@CurrentUser('userId') userId: bigint) {
    return this.service.me(userId)
  }

  /// 10. 存自己的开关
  @Put('me')
  @Roles(Role.SUPPLIER)
  updateMe(@CurrentUser('userId') userId: bigint, @Body() dto: NotifyMePutDto) {
    return this.service.updateMe(userId, dto)
  }
}
