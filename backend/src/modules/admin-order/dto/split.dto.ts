import { IsArray, ArrayMinSize, ValidateNested, IsInt, IsNumber, Min } from 'class-validator'
import { Type } from 'class-transformer'

class SplitAllocation {
  @IsInt({ message: 'supplierId 必须为整数' })
  supplierId: number

  @IsNumber({}, { message: 'qty 必须为数字' })
  @Min(0.01, { message: '分配数量必须大于 0' })
  qty: number
}

class SplitItem {
  @IsInt({ message: 'productId 必须为整数' })
  productId: number

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SplitAllocation)
  allocations: SplitAllocation[]
}

/// 核单拆单（决策 1：按供货优先级 + 当日可供量分配，按商品维度）
/// 支持：待确认订单首次拆单 + 已自动拆单订单的「改拆单」（重新分配供应商）
export class SplitDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SplitItem)
  items: SplitItem[]
}
