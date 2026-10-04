import { IsString, IsInt, IsOptional, IsNumber, Min } from 'class-validator'

/// 运营编辑商品（名称/规格/供货价/加价比例/销售价/可供量，均可选）
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string

  /// 卡BZ（2026-10-04）：运营编辑商品可改分类。
  /// 此前 DTO 里没有这个字段，前端发来的 categoryId 被 ValidationPipe({whitelist:true})
  /// 静默丢掉 → 接口回 200「已保存」但分类永不落库（假成功）。
  @IsOptional()
  @IsInt()
  categoryId?: number

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
