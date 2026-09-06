import { IsArray, ArrayMinSize, ValidateNested, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator'
import { Type } from 'class-transformer'

class ReceiveItemInput {
  @IsInt({ message: 'orderItemId 必须为整数' })
  orderItemId: number

  @IsNumber({}, { message: 'qtyReceived 必须为数字' })
  @Min(0)
  qtyReceived: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  rejectQty?: number

  @IsOptional()
  @IsString()
  rejectReason?: string
}

/// 逐项接受/拒收（决策 3：拒收部分自动生成售后工单）
export class ReceiveOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemInput)
  items: ReceiveItemInput[]

  @IsOptional()
  @IsString()
  signImage?: string
}
