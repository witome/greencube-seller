import { IsNotEmpty, IsString, IsOptional, IsInt, MaxLength, Min } from 'class-validator'

/// 分类管理（运营增删改一级分类）
export class CategoryDto {
  @IsNotEmpty({ message: '分类名称不能为空' })
  @IsString()
  @MaxLength(50)
  name: string

  /// 可选：父分类（二级分类时用），空则一级
  @IsOptional()
  @IsInt()
  parentId?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number
}
