import { IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'

/// 运营处理售后工单（修复单缺陷 3，2026-09-10）
export class AftersaleHandleDto {
  /// compensate 同意补偿 / reject 驳回 / close 关闭
  @IsIn(['compensate', 'reject', 'close'], { message: 'action 只能为 compensate(同意补偿)/reject(驳回)/close(关闭)' })
  action: string

  /// 补偿金额（compensate 必填）
  @IsOptional()
  @IsNumber({}, { message: 'compensateAmount 必须为数字' })
  @Min(0, { message: 'compensateAmount 不能为负' })
  compensateAmount?: number

  /// 补偿方式 1 退款 / 2 补货 / 3 下次账单抵扣（compensate 必填）
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3], { message: 'compensateMethod 只能为 1(退款)/2(补货)/3(下次账单抵扣)' })
  compensateMethod?: number

  /// 处理备注 / 驳回原因（reject 必填）
  @IsOptional()
  @IsString()
  @MaxLength(255)
  handleRemark?: string
}
