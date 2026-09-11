import { IsString, IsOptional, IsArray, Matches, MaxLength } from 'class-validator'

/// 采购方自助改资料（2026-09-11 任务卡 A，大辉拍板）
/// 与运营侧 UpdateBuyerDto 同源校验，但**不含** businessLicenseNo / 资质图片 / 账号状态——
/// 资质属准入材料，必须走运营审核（安全默认，不放给自助修改）。
/// 全局 ValidationPipe whitelist:true 会剥离未声明字段，前端即使夹带执照号也会被丢弃。
export class UpdateBuyerProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  shopName?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  contact?: string

  @IsOptional()
  @Matches(/^1\d{10}$/, { message: '手机号格式错误' })
  phone?: string

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string

  @IsOptional()
  @IsArray()
  deliveryWindows?: string[]
}
