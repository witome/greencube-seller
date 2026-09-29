import { Body, Controller, Logger, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { IsInt, IsNumber, Min } from 'class-validator'
import { WechatPayService } from './wechat-pay.service'
import { Roles, Role } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

class WechatPrepayDto {
  @IsNumber()
  @IsInt()
  @Min(1)
  orderId: number
}

class WechatRefundDto {
  @IsNumber()
  @IsInt()
  @Min(1)
  orderId: number
}

/**
 * 真实微信支付路由（卡R1）：
 *  - prepay：采购方 token，只收 orderId（金额服务端取数）；
 *  - notify：**无 token**（回调由微信发起）；⚠️ 必须 @Res() 直写 200 + 空体——
 *    全局 ResponseInterceptor 会把返回值包成 {code,msg,data}，微信只认空体（CODEBUDDY.md 铁律 11）；
 *    任何异常也回 200 + 留痕（避免微信重试风暴），拒绝细节记录在 payment_record.callbackPayload / 日志；
 *  - refund：管理员 token。
 */
@Controller('payment/wechat')
export class WechatPayController {
  private readonly logger = new Logger(WechatPayController.name)

  constructor(private readonly service: WechatPayService) {}

  /// 下单并返回 uni.requestPayment 参数（timeStamp/nonceStr/package/signType/paySign）
  @Post('prepay')
  @Roles(Role.PURCHASER)
  async prepay(@CurrentUser('userId') userId: bigint, @Body() dto: WechatPrepayDto) {
    return this.service.prepay(userId, dto.orderId)
  }

  /// 微信支付结果回调（原始 body 必须用于验签：main.ts 的 json() verify 已挂 req.rawBody）
  @Post('notify')
  async notify(@Req() req: Request, @Res() res: Response) {
    const rawBody = String((req as any).rawBody ?? '')
    const headers = req.headers as Record<string, string | undefined>
    try {
      const result = await this.service.confirmPayment(req.body as Record<string, any>, headers, rawBody)
      this.logger.log(`[wxpay] 回调处理完成 out_trade_no 处理结果：${JSON.stringify(result)}`)
    } catch (e: any) {
      // 一律 200 + 空体：验签/金额等拒绝已由 service 在 callbackPayload 留痕，这里只补日志
      this.logger.warn(`[wxpay] 回调拒绝：${e?.message || e}`)
    }
    res.status(200).send('')
  }

  /// 真退款（管理员）：out_refund_no = R<payNo> 幂等，金额以库为准
  @Post('refund')
  @Roles(Role.ADMIN)
  async refund(@CurrentUser('userId') userId: bigint, @Body() dto: WechatRefundDto) {
    return this.service.refund(dto.orderId, userId)
  }
}
