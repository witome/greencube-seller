import { IsString, IsInt, IsOptional, IsNumber, Min } from 'class-validator'

/// 运营直接新增商品（归属供应商 + 供货价 + 加价比例 + 规格）
export class CreateProductDto {
  @IsString()
  name: string

  @IsInt()
  categoryId: number

  /// 1 称重 / 2 固定规格
  @IsInt()
  weighType: number

  @IsOptional()
  @IsString()
  unit?: string

  @IsOptional()
  @IsString()
  specText?: string

  @IsInt()
  supplierId: number

  @IsNumber()
  @Min(0)
  supplyPrice: number

  @IsNumber()
  @Min(0)
  dailySupply: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  markupRate?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number
}
