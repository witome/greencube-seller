import { Module } from '@nestjs/common'
import { WxService } from './wx.service'

/// 微信服务端接口（发送能力）—— 采购需求的「到货通知」用它
@Module({
  providers: [WxService],
  exports: [WxService],
})
export class WxModule {}
