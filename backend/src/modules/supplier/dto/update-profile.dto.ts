import { IsString, IsOptional, Matches, MaxLength } from 'class-validator'

/// 供应商自助改店铺资料（2026-09-11 深夜卡第二部分，大辉拍板）
/// 字段清单与校验**照运营侧 UpdateSupplierDto**（admin-user/dto/update-profile.dto.ts L34-53，唯一权威）：
///   stallName / address → Supplier 列；contact / phone → Supplier.qualification JSON（同运营侧落点）
/// **不含** qualification（营业执照/检疫证及有效期）/ status（合作状态）——资质属准入材料、
/// 合作状态由运营管理，均不可自助改。全局 ValidationPipe whitelist:true 剥离前端夹带字段。
export class UpdateSupplierProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  stallName?: string

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  contact?: string

  @IsOptional()
  @Matches(/^1\d{10}$/, { message: '手机号格式错误' })
  phone?: string
}
