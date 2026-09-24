import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

/**
 * 当前草稿行（多轮上下文，2026-09-24）
 * ⚠️ 纯新增可选入参：**不传 draft = 空草稿 = 老前端行为完全不变**（字段/入参只增不改）
 */
export class DraftLineDto {
  @IsInt({ message: 'productId 必须是整数' })
  @Min(1)
  productId: number

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'qty 必须是数字' })
  @Min(0.01)
  @Max(100000)
  qty: number

  @IsOptional()
  @IsString()
  @MaxLength(10)
  unit?: string

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string
}

/// AI 客服下单：解析客户自然语言 → 订单草稿
export class ParseDto {
  @IsNotEmpty({ message: '内容不能为空' })
  @IsString()
  @MaxLength(500, { message: '内容过长' })
  text: string

  /** 当前草稿行（不传 = 老前端 = 单句口径） */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DraftLineDto)
  draft?: DraftLineDto[]

  /** 当前草稿的配送日期（ISO yyyy-MM-dd）；新句子没提时间时用于沿用 */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  draftDeliveryDate?: string

  /** 当前草稿的备注；新句子没提备注时用于沿用 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  draftRemark?: string
}
