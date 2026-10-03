import { IsOptional, IsString, IsInt, IsIn, MaxLength, Min } from 'class-validator'

/// 运营编辑计量单位（改名 / 排序 / 启停，卡BV-1）
/// 三个字段都是可选：传了才改，没传保持原值。
export class UpdateUnitDto {
  /// 上限 10 的口径同 CreateUnitDto（product.unit 是 VARCHAR(10)）
  @IsOptional()
  @IsString()
  @MaxLength(10, { message: '单位名称最多 10 字' })
  name?: string

  @IsOptional()
  @IsInt({ message: '排序必须为整数' })
  @Min(0, { message: '排序不能为负' })
  sort?: number

  @IsOptional()
  @IsIn([0, 1], { message: '状态只能为 0(停用) 或 1(启用)' })
  status?: number
}
