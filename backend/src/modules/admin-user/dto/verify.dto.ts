import { IsArray, IsIn, IsInt, IsOptional, IsString, ArrayMinSize, MaxLength } from 'class-validator'

/// 提交线下核实结论（主计划 4.1）
export class VerifyDto {
  /// 核实方式：1电话 2上门 3视频（可多选）
  @IsArray()
  @ArrayMinSize(1, { message: '至少一种核实方式' })
  @IsInt({ each: true })
  methods: number[]

  /// 1 通过 / 2 驳回
  @IsIn([1, 2], { message: 'result 只能为 1(通过) 或 2(驳回)' })
  result: number

  /// 驳回时必填：1执照不符 2电话无人接 3地址不实 4非餐饮 5重复申请 6资料不全 9其他
  @IsOptional()
  @IsInt()
  reasonCode?: number

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonText?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string

  @IsOptional()
  @IsArray()
  attachments?: string[]

  @IsOptional()
  @IsInt()
  durationMin?: number

  @IsOptional()
  @IsString()
  signature?: string
}
