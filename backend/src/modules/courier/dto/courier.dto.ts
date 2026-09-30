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

/// 货到付款收款凭证（配送员上传客户付款拍照）
export class PayProofDto {
  @IsArray()
  photos: string[]
}

/// 卡AH（2026-09-30）：配送员标记「客户未付款」
/// ⚠️ 只标「没收到钱」，**不带金额**、不做催收动作（大辉拍板 2e：第一版不做）
export class UnpaidMarkDto {
  /// 备注（选填，如「客户说下午转」）；≤255 字
  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string
}
