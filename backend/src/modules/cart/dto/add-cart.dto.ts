import { IsInt, Min, IsNumber } from 'class-validator'

/// 加购
export class AddCartDto {
  @IsInt({ message: 'productId 必须为整数' })
  productId: number

  @IsNumber({}, { message: 'qty 必须为数字' })
  @Min(0.01, { message: '数量必须大于 0' })
  qty: number
}
