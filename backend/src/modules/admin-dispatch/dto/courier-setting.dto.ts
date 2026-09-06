import { IsInt, IsOptional, Min } from 'class-validator'

/// 配送员派单设置（优先级 / 单量限制）
export class CourierSettingDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  maxOrders?: number
}
