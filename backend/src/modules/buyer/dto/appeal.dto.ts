import { IsNotEmpty, IsString, IsArray, IsOptional, MaxLength } from 'class-validator'

/// 申诉（主计划 4.1：30 天内仅可申诉 1 次）
export class AppealDto {
  @IsNotEmpty({ message: '申诉说明不能为空' })
  @IsString()
  @MaxLength(500)
  text: string

  @IsOptional()
  @IsArray()
  attachments?: string[]
}
