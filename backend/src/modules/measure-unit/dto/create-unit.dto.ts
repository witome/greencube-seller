import { IsNotEmpty, IsOptional, IsString, IsInt, IsIn, MaxLength, Min } from 'class-validator'

/// 运营新增计量单位（卡BV-1）
export class CreateUnitDto {
  /// ⚠️ 上限取 10（不是表字段的 VARCHAR(20)）：product.unit 是 VARCHAR(10)，
  /// 超过 10 字的单位**商品侧根本存不下**（供应商 DTO 也卡 10）→ 会造出「建得出来、用不了」的单位。
  /// 表字段留 20 只是余量，接口层按 10 收口。
  @IsNotEmpty({ message: '单位名称不能为空' })
  @IsString()
  @MaxLength(10, { message: '单位名称最多 10 字' })
  name: string

  /// 留空 = 追加到末尾（service 取 max(sort)+1）
  @IsOptional()
  @IsInt({ message: '排序必须为整数' })
  @Min(0, { message: '排序不能为负' })
  sort?: number

  /// 1 启用 / 0 停用；留空 = 1
  @IsOptional()
  @IsIn([0, 1], { message: '状态只能为 0(停用) 或 1(启用)' })
  status?: number
}
