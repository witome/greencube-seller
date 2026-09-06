import { IsArray, ArrayMinSize, ValidateNested, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { Type } from 'class-transformer'

class DeclareItem {
  @IsInt({ message: 'orderItemId 必须为整数' })
  orderItemId: number

  /// ② 申报数量（交货量）
  @IsNumber({}, { message: 'qtyDeclared 必须为数字' })
  @Min(0, { message: '申报数量不能为负' })
  qtyDeclared: number

  /// ⚠️ 少交（qtyDeclared < qtyOrdered）时必填原因
  @IsOptional()
  @IsString()
  @MaxLength(255)
  shortageReason?: string
}

/// 申报备货（决策 2：少交必填原因；超时自动兜底）
export class DeclareDto {
  @IsInt({ message: 'orderId 必须为整数' })
  orderId: number

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeclareItem)
  items: DeclareItem[]
}
