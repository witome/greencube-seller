import { IsArray, ArrayMinSize, ValidateNested, IsInt, IsNumber, Min } from 'class-validator'
import { Type } from 'class-transformer'

class WeighingItem {
  @IsInt({ message: 'orderItemId 必须为整数' })
  orderItemId: number

  /// ③ 验收数量（运营称重，对账基数）
  @IsNumber({}, { message: 'qtyAccepted 必须为数字' })
  @Min(0, { message: '验收数量不能为负' })
  qtyAccepted: number
}

/// 验收称重（写 qty_accepted，决策 3 的对账基数）
export class WeighingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WeighingItem)
  items: WeighingItem[]
}
