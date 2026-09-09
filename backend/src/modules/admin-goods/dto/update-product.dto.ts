import { IsString, IsInt, IsOptional, IsNumber, Min } from 'class-validator'

/// 运营编辑商品（名称/规格/供货价/加价比例/销售价/可供量，均可选）
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsInt()
  weighType?: number

  @IsOptional()
  @IsString()
  unit?: string

  @IsOptional()
  @IsString()
  specText?: string

  @IsOptional()
  @IsNumber()
  @Min(0)
  supplyPrice?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  dailySupply?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  markupRate?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number
}
