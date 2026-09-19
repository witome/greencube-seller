import { IsInt, IsOptional, IsString, IsNumber, IsArray, IsIn, MaxLength, Min } from 'class-validator'

/// 采购方售后申请（主计划 4.5，决策3：拒收差额可主动发起售后）
export class AftersaleDto {
  @IsInt({ message: 'orderId 必须为整数' })
  orderId: number

  @IsOptional()
  @IsInt({ message: 'orderItemId 必须为整数' })
  orderItemId?: number

  /// 1 少货 / 2 品质问题 / 3 错货 / 4 其他
  @IsIn([1, 2, 3, 4], { message: 'type 只能为 1(少货)/2(品质)/3(错货)/4(其他)' })
  type: number

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string

  @IsOptional()
  @IsNumber()
  @Min(0)
  qtyDiff?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  amountDiff?: number

  /// 申请照片 URL 数组（2026-09-19 决策⑦：售后拍照留证）。
  /// ⚠️ 可选 —— 不传即无照片；存 URL（/uploads/xxx），绝不收 base64。
  /// 校验白名单：本字段必须在此声明，否则 whitelist:true 会把它剥掉
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[]
}
