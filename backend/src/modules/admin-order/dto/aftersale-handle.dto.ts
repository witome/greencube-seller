import { IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'

/// 运营处理售后工单（修复单缺陷 3，2026-09-10；卡AE 2026-09-30 改口径）
///
/// 卡AE 口径：
///   · `compensate` 的动作语义 = 「**处理完成**」（运营线下谈完点一下落结果）；
///     `reject` / `close` 保留可用，未新增动作值
///   · `handleRemark` **处理完成/驳回时必填**（空 / 纯空格都算空，服务端 trim 后判）
///   · `compensateAmount` / `compensateMethod` **选填** —— 都不传也能完成；
///     金额为空 → 落 null；方式为空 → 落 null，业务语义即「**仅致歉**」
///     （大辉 2026-09-30 确认：不新增 compensate_method=4，空就是仅致歉）
export class AftersaleHandleDto {
  /// compensate 处理完成（原「同意补偿」）/ reject 驳回 / close 关闭
  @IsIn(['compensate', 'reject', 'close'], { message: 'action 只能为 compensate(处理完成)/reject(驳回)/close(关闭)' })
  action: string

  /// 补偿金额（**选填**：卡AE 起不传也能完成，落 null）
  @IsOptional()
  @IsNumber({}, { message: 'compensateAmount 必须为数字' })
  @Min(0, { message: 'compensateAmount 不能为负' })
  compensateAmount?: number

  /// 补偿方式 1 退款 / 2 补货 / 3 下次账单抵扣（**选填**：不传 = 仅致歉，落 null）
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3], { message: 'compensateMethod 只能为 1(退款)/2(补货)/3(下次账单抵扣)' })
  compensateMethod?: number

  /// 处理说明 / 驳回原因（处理完成与驳回**必填**，服务端真校验）
  @IsOptional()
  @IsString()
  @MaxLength(255)
  handleRemark?: string
}
