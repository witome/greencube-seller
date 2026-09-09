import { IsString, IsOptional, IsInt, IsArray, Min, Max, Matches, MaxLength } from 'class-validator'

/// 编辑采购方（运营后台）
export class UpdateBuyerDto {
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
  @IsString()
  businessLicenseNo?: string

  @IsOptional()
  @IsArray()
  deliveryWindows?: string[]
}

/// 编辑供应商（运营后台）
export class UpdateSupplierDto {
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

/// 编辑配送员（运营后台）
export class UpdateCourierDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  name?: string

  @IsOptional()
  @Matches(/^1\d{10}$/, { message: '手机号格式错误' })
  phone?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  idCardNo?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  vehicleType?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  ownVehicle?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  hasDriverLicense?: number

  @IsOptional()
  @IsString()
  @MaxLength(20)
  licenseType?: string

  @IsOptional()
  @IsString()
  healthCertExpiry?: string
}
