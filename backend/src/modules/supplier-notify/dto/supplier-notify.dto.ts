import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'

/// 卡BN-1（2026-10-02）：电话催办接口入参校验（全局 ValidationPipe 拦非法入参 → 400）

export class NotifyConfigPutDto {
  @IsOptional() @IsBoolean({ message: 'enabled 必须为布尔' }) enabled?: boolean
  @IsOptional() @IsInt({ message: 'thresholdMinutes 必须为整数' }) thresholdMinutes?: number
  @IsOptional() @IsInt({ message: 'secondGapMinutes 必须为整数' }) secondGapMinutes?: number
  @IsOptional() @IsInt({ message: 'maxCalls 必须为整数' }) maxCalls?: number
  @IsOptional() @IsBoolean({ message: 'quietEnabled 必须为布尔' }) quietEnabled?: boolean
  @IsOptional() @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'quietStart 必须为 HH:mm' }) quietStart?: string
  @IsOptional() @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'quietEnd 必须为 HH:mm' }) quietEnd?: string
  // ── 卡BP-1（2026-10-04）新增四字段：channel / ringSeconds / hangupAfterAnswerSeconds / gatewayPhoneNo ──
  @IsOptional() @IsIn(['phone', 'aliyun', 'off'], { message: 'channel 必须为 phone | aliyun | off' }) channel?: 'phone' | 'aliyun' | 'off'
  @IsOptional() @IsInt({ message: 'ringSeconds 必须为整数' }) @Min(1, { message: 'ringSeconds 必须为 1-30 的整数' }) @Max(30, { message: 'ringSeconds 必须为 1-30 的整数' }) ringSeconds?: number
  @IsOptional() @IsInt({ message: 'hangupAfterAnswerSeconds 必须为整数' }) @Min(0, { message: 'hangupAfterAnswerSeconds 必须为 0-30 的整数' }) @Max(30, { message: 'hangupAfterAnswerSeconds 必须为 0-30 的整数' }) hangupAfterAnswerSeconds?: number
  @IsOptional() @IsString({ message: 'gatewayPhoneNo 必须为字符串' }) @MaxLength(20, { message: 'gatewayPhoneNo 不能超过 20 字符' }) gatewayPhoneNo?: string | null
}

export class NotifyPairDto {
  @IsInt({ message: 'orderId 必须为整数' }) orderId: number
  @IsInt({ message: 'supplierId 必须为整数' }) supplierId: number
}

export class TestCallDto {
  @IsString() @Matches(/^1\d{10}$/, { message: 'phone 必须为 11 位手机号' }) phone: string
}

export class NotifyMePutDto {
  @IsBoolean({ message: 'ackCallEnabled 必须为布尔' }) ackCallEnabled: boolean
}
