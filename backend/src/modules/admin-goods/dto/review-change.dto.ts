import { IsBoolean, IsOptional, IsNumber, IsString, MaxLength, Min } from 'class-validator'

/// 变更审核（涉价时自动重算销售价，或人工指定）
export class ReviewChangeDto {
  @IsBoolean({ message: 'approved 必须为布尔值' })
  approved: boolean

  @IsOptional()
  @IsString()
  @MaxLength(255)
  comment?: string

  /// 涉价变更时可人工指定新销售价；不填则按加价比例自动重算
  @IsOptional()
  @IsNumber()
  @Min(0)
  newSalePrice?: number
}
