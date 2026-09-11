import { Body, Controller, Post } from '@nestjs/common'
import { IsString, MinLength } from 'class-validator'
import { PaymentService } from './payment.service'
import { Roles, Role } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { BizException, ErrorCode } from '../../common/constants/error-codes'

class MockPayDto {
  @IsString()
  @MinLength(16)
  payNo: string
}

/**
 * 模拟支付通道路由 —— 仅 WX_MOCK_PAY=1 时注册（未注册 = 路由不存在 = 404，拍板③=A）
 * 真实微信支付接入时：新增 wechat 通道 controller/service，本文件保留仅作联调演练
 */
@Controller('payment')
export class MockPayController {
  constructor(private readonly service: PaymentService) {}

  /// 模拟「拉起微信收银台并完成支付」：需采购方 token，服务端自签后走真实回调同款链路
  @Post('mock/pay')
  @Roles(Role.PURCHASER)
  async pay(@CurrentUser('userId') userId: bigint, @Body() dto: MockPayDto) {
    return this.service.mockPay(userId, dto.payNo)
  }

  /// 模拟微信服务器回调：无 token（回调本就由支付平台发起），HMAC 验签 + 全量留痕
  @Post('mock/callback')
  async callback(@Body() body: { payNo?: string; signature?: string }) {
    if (!body?.payNo || !body?.signature) throw new BizException(ErrorCode.PARAM_ERROR, 'payNo / signature 缺失')
    return this.service.confirmPayment(body.payNo, body.signature, { source: 'mock-callback', payNo: body.payNo })
  }
}
