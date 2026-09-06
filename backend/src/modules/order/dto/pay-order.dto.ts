import { IsInt, IsIn } from 'class-validator'

/// 选择支付方式（1 微信支付 / 2 货到付款 COD）
export class PayOrderDto {
  @IsInt()
  @IsIn([1, 2])
  payMethod: number
}
