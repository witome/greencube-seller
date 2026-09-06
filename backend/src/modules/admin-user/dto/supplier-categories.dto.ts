import { IsArray, IsInt } from 'class-validator'

/// 供应商分类授权（设置供应商可发布的分类）
export class SupplierCategoriesDto {
  @IsArray({ message: 'categoryIds 必须为数组' })
  @IsInt({ each: true, message: 'categoryId 必须为整数' })
  categoryIds: number[]
}
