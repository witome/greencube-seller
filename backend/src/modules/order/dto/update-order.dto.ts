import { IsArray, ArrayMinSize, ValidateNested, IsInt, IsNumber, Min, IsOptional, IsString, Matches } from 'class-validator'
import { Type } from 'class-transformer'

class UpdateOrderItem {
  @IsInt()
  productId: number

  @IsNumber()
  @Min(0.1)
  qty: number
}

/// 编辑待确认订单（覆盖式：提交新商品清单重算金额；可同时改配送日期/时间段）
export class UpdateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateOrderItem)
  items: UpdateOrderItem[]

  /// 配送日期（可选，YYYY-MM-DD）
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '配送日期格式应为 YYYY-MM-DD' })
  deliveryDate?: string

  /// 配送时间段（可选，1 早 / 2 中 / 3 晚）
  @IsOptional()
  @IsInt()
  timeWindow?: number
}
