import { IsArray, ArrayMinSize, IsInt } from 'class-validator'

/// 派送调度：把一批待配送订单指派给某配送员
export class DispatchDto {
  @IsInt({ message: 'courierId 必须为整数' })
  courierId: number

  @IsArray()
  @ArrayMinSize(1, { message: '至少一个订单' })
  @IsInt({ each: true })
  orderIds: number[]
}
