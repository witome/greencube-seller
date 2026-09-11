import { IsString, IsNotEmpty, MaxLength } from 'class-validator'

/// AI 客服下单：解析客户自然语言 → 订单草稿
export class ParseDto {
  @IsNotEmpty({ message: '内容不能为空' })
  @IsString()
  @MaxLength(500, { message: '内容过长' })
  text: string
}
