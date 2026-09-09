import { IsNumber, IsBoolean, Min } from 'class-validator'

/// 运费规则：满额免运费 / 次日达免运费 / 加急运费
export class DeliveryFeeConfigDto {
  @IsNumber({}, { message: '运费金额必须为数字' })
  @Min(0, { message: '运费金额不能为负' })
  fee: number

  @IsNumber({}, { message: '免运费门槛必须为数字' })
  @Min(0, { message: '免运费门槛不能为负' })
  freeThreshold: number

  @IsBoolean({ message: '次日达免运费必须为布尔' })
  freeNextDay: boolean

  @IsNumber({}, { message: '加急运费必须为数字' })
  @Min(0, { message: '加急运费不能为负' })
  urgentFee: number

  @IsNumber({}, { message: '加急满额免运费门槛必须为数字' })
  @Min(0, { message: '加急满额免运费门槛不能为负' })
  urgentFreeThreshold: number
}
