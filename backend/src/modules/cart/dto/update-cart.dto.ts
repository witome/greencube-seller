import { IsNumber, Min } from 'class-validator'

/// 改数量（qty=0 即删除）
export class UpdateCartDto {
  @IsNumber({}, { message: 'qty 必须为数字' })
  @Min(0, { message: '数量不能为负' })
  qty: number
}
