import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
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
 * 供应商端「语音报量 / 改价」解析（2026-09-25 卡U）
 *
 * ⚠️ 这是**新接口** POST /ai/supplier-parse 的入参，与采购方 /ai/parse 完全独立：
 *    采购方那条的 DTO（parse.dto.ts）/ 调度 / 响应一个字节都不许动（已上生产）。
 */

/** 草稿行（多轮口径）：一个对话 = 一张「待提交变更」草稿，后面每句话作用在它上面 */
export class SupplierDraftLineDto {
  @IsInt({ message: 'productId 必须是整数' })
  @Min(1)
  productId: number

  /** 本轮要改的供货价（审核制，最终以用户在确认页认过的数为准） */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'setPrice 必须是数字' })
  @Min(0.01)
  @Max(99999)
  setPrice?: number

  /** 本轮要改的日可供量（免审即时生效） */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'setSupply 必须是数字' })
  @Min(0)
  @Max(999999)
  setSupply?: number
}

export class SupplierParseDto {
  @IsNotEmpty({ message: '内容不能为空' })
  @IsString()
  @MaxLength(500, { message: '内容过长' })
  text: string

  /** 当前草稿（不传 = 空草稿 = 首句） */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SupplierDraftLineDto)
  draft?: SupplierDraftLineDto[]
}

/** 语音报量留痕（卡U ④：识别原文 + 提交值 写进现有审计日志，不新增表不改 schema） */
export class SupplierAuditEntryDto {
  @IsInt({ message: 'productId 必须是整数' })
  @Min(1)
  productId: number

  @IsIn(['setPrice', 'setSupply'], { message: 'op 只能是 setPrice / setSupply' })
  op: 'setPrice' | 'setSupply'

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'value 必须是数字' })
  @Min(0)
  @Max(999999)
  value: number
}

export class SupplierAuditTrailDto {
  @IsNotEmpty({ message: '识别原文不能为空' })
  @IsString()
  @MaxLength(500)
  rawText: string

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SupplierAuditEntryDto)
  entries: SupplierAuditEntryDto[]
}
