import { IsNumber, Min } from 'class-validator'

/// ⚡ 快速改日可供量（免审核，即时生效）
export class QuickStockDto {
  @IsNumber({}, { message: 'dailySupply 必须为数字' })
  @Min(0, { message: '日可供量不能为负' })
  dailySupply: number
}
