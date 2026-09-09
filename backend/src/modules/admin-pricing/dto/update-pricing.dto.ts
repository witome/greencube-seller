import { IsNumber, IsOptional, Min, Max } from 'class-validator'

/// 改价：可改加价比例（联动销售价）或直接改销售价
export class UpdatePricingDto {
  @IsOptional()
  @IsNumber({}, { message: '加价比例必须为数字' })
  @Min(0, { message: '加价比例不能为负' })
  @Max(9.99, { message: '加价比例过大' })
  markupRate?: number

  @IsOptional()
  @IsNumber({}, { message: '销售价必须为数字' })
  @Min(0.01, { message: '销售价必须大于 0' })
  salePrice?: number
}
