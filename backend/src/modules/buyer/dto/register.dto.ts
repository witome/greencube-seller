import { IsNotEmpty, IsString, IsArray, IsOptional, MaxLength, Matches } from 'class-validator'

/// 采购方注册（主计划 4.1）
export class RegisterDto {
  @IsNotEmpty({ message: '餐馆名称不能为空' })
  @IsString()
  @MaxLength(100)
  shopName: string

  @IsNotEmpty({ message: '联系人不能为空' })
  @IsString()
  @MaxLength(32)
  contact: string

  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1\d{10}$/, { message: '手机号格式错误' })
  phone: string

  @IsNotEmpty({ message: '收货地址不能为空' })
  @IsString()
  @MaxLength(255)
  address: string

  @IsOptional()
  @IsArray()
  deliveryWindows?: string[]

  @IsOptional()
  @IsString()
  businessLicenseNo?: string

  @IsOptional()
  @IsString()
  licenseImg?: string

  @IsOptional()
  @IsString()
  permitImg?: string
}
