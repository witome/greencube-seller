import { IsIn } from 'class-validator'

/// 设置加急：0 取消加急 / 1 加急
export class SetUrgentDto {
  @IsIn([0, 1], { message: '加急标记非法' })
  urgent: number
}
