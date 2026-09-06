import { IsBoolean, IsOptional, IsNumber, IsString, MaxLength, Min } from 'class-validator'

/// 新品审核（通过时需定加价比例 → 计算销售价）
export class ReviewApplyDto {
  @IsBoolean({ message: 'approved 必须为布尔值' })
  approved: boolean

  /// 通过时必填：加价比例（销售价 = 供货价 × (1+rate)）
  @IsOptional()
  @IsNumber({}, { message: 'markupRate 必须为数字' })
  @Min(0, { message: '加价比例不能为负' })
  markupRate?: number

  /// 可选：直接指定销售价（不填则按 markupRate 计算）
  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number

  /// 驳回时必填
  @IsOptional()
  @IsString()
  @MaxLength(255)
  rejectReason?: string
}
