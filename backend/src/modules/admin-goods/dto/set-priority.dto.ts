import { IsArray, IsInt, Min, ValidateNested, ArrayNotEmpty } from 'class-validator'
import { Type } from 'class-transformer'

class PriorityItemDto {
  @IsInt()
  supplierId: number

  /// 供货优先级（越小越优先）
  @IsInt()
  @Min(1)
  priority: number
}

/// 设置某商品多供应商的供货优先级
export class SetPriorityDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PriorityItemDto)
  items: PriorityItemDto[]
}
