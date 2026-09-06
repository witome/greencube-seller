import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

/// 申诉复核（决策：通过→active；驳回→终态冻结 60 天）
export class AppealReviewDto {
  @IsBoolean({ message: 'approved 必须为布尔值' })
  approved: boolean

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string
}
