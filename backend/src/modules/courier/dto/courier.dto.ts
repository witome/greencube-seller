import { IsArray, IsOptional, IsString, IsInt, MaxLength } from 'class-validator'

/// 交付确认（拍照 + 电子签名）
export class DeliverDto {
  @IsOptional()
  @IsArray()
  photos?: string[]

  @IsOptional()
  @IsString()
  signature?: string

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string
}

/// 异常上报
export class ReportDto {
  @IsOptional()
  @IsInt()
  taskId?: number

  @IsOptional()
  @IsInt()
  orderId?: number

  /// 缺货/拒收/客户不在/车辆故障 等
  @IsString()
  @MaxLength(255)
  reason: string

  @IsOptional()
  @IsArray()
  photos?: string[]
}
