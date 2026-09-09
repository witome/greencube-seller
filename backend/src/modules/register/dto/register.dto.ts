import { IsString, IsOptional, IsInt, IsArray, Min, Max, Matches } from 'class-validator'

/// 供应商注册（外部申请，运营审核）
export class RegisterSupplierDto {
  @IsString()
  stallName: string

  /// 档口地址
  @IsOptional()
  @IsString()
  address?: string

  @IsString()
  contact: string

  @Matches(/^1\d{10}$/, { message: '手机号格式错误' })
  phone: string

  /// 经营品类（一级分类 ID）
  @IsOptional()
  @IsArray()
  categoryIds?: number[]

  @IsOptional()
  @IsString()
  businessLicenseNo?: string
}

/// 配送员注册（外部申请，运营审核）
export class RegisterCourierDto {
  @IsString()
  name: string

  @Matches(/^1\d{10}$/, { message: '手机号格式错误' })
  phone: string

  /// 身份证号（黑名单防重复申请）
  @IsString()
  idCardNo: string

  /// 健康证有效期（YYYY-MM-DD）
  @IsOptional()
  @IsString()
  healthCertExpiry?: string

  /// 车辆类型：1 电动自行车 / 2 三轮车 / 3 面包车 / 4 小货车 / 5 其他
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  vehicleType?: number

  /// 是否自有车辆：0 无 / 1 有
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  ownVehicle?: number

  /// 是否有驾驶证：0 无 / 1 有
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  hasDriverLicense?: number

  /// 驾驶证类型（C1/C2/B2/A1/A2/D）
  @IsOptional()
  @IsString()
  licenseType?: string
}
