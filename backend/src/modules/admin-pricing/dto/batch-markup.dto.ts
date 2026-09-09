import { IsNumber, IsOptional, Min, Max } from 'class-validator'

/// 批量加价：按分类（可选，不填则全部在售商品）统一设置加价比例
export class BatchMarkupDto {
  @IsNumber({}, { message: '加价比例必须为数字' })
  @Min(0, { message: '加价比例不能为负' })
  @Max(9.99, { message: '加价比例过大' })
  markupRate: number

  /// 可选：按分类批量（不填则全部在售商品）
  @IsOptional()
  @IsNumber()
  categoryId?: number
}
