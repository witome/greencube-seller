import { Module } from '@nestjs/common'
import { DemandService } from './demand.service'
import { BuyerDemandController } from './buyer-demand.controller'
import { AdminDemandController } from './admin-demand.controller'
import { AuditModule } from '../audit/audit.module'
import { WxModule } from '../wx/wx.module'

/**
 * 采购需求登记 + 到货主动通知
 *
 * 两个 controller 分买家侧 / 运营侧，**共用一个 service** ——
 * 目的是让「归一化」「计数重算」「通知名单判定」都只有一处实现，
 * 避免买家侧和运营侧各算一套、对不上。
 */
@Module({
  imports: [AuditModule, WxModule],
  controllers: [BuyerDemandController, AdminDemandController],
  providers: [DemandService],
  exports: [DemandService],
})
export class DemandModule {}
