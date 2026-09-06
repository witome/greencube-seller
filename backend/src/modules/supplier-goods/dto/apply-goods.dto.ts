import { IsNotEmpty, IsString, IsInt, IsNumber, IsOptional, IsArray, MaxLength, Min, IsIn } from 'class-validator'

/// 提交新品（审核制，主计划 4.7）
export class ApplyGoodsDto {
  @IsNotEmpty({ message: '商品名称不能为空' })
  @IsString()
  @MaxLength(100)
  name: string

  @IsInt({ message: 'categoryId 必须为整数' })
  categoryId: number

  /// 1 称重 / 2 固定规格
  @IsIn([1, 2], { message: 'weighType 只能为 1(称重) 或 2(固定规格)' })
  weighType: number

  @IsOptional()
  @IsString()
  @MaxLength(100)
  specText?: string

  @IsOptional()
  @IsString()
  @MaxLength(10)
  unit?: string

  @IsNumber({}, { message: '供货价必须为数字' })
  @Min(0.01, { message: '供货价必须大于 0' })
  supplyPrice: number

  @IsNumber({}, { message: '日可供量必须为数字' })
  @Min(0, { message: '日可供量不能为负' })
  dailySupply: number

  @IsOptional()
  @IsArray()
  images?: string[]

  @IsOptional()
  @IsArray()
  qualification?: string[]
}
