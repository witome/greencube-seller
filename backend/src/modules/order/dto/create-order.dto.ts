import { IsNotEmpty, IsString, IsArray, IsOptional, IsInt, IsNumber, ArrayMinSize, ValidateNested, IsIn, MaxLength } from 'class-validator'
import { Type } from 'class-transformer'

class OrderItemInput {
  @IsInt({ message: 'productId 必须为整数' })
  productId: number

  @IsNumber({}, { message: 'qty 必须为数字' })
  qty: number
}

/// 下单（契约《开发配套-API接口字段契约》第 5 节）
export class CreateOrderDto {
  @IsNotEmpty({ message: '配送日期不能为空' })
  @IsString()
  deliveryDate: string // YYYY-MM-DD

  @IsIn([1, 2, 3], { message: '配送时段非法' })
  timeWindow: number // 1早 2中 3晚

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string

  @IsOptional()
  @IsIn(['auto_replace', 'partial', 'cancel_all'], { message: '缺货偏好非法' })
  shortagePolicy?: string

  @IsArray()
  @ArrayMinSize(1, { message: '至少一个商品' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemInput)
  items: OrderItemInput[]
}
