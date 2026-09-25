import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

/**
 * 采购需求 · DTO
 *
 * ⚠️ `whitelist: true`（main.ts 的全局 ValidationPipe）会把**未声明的字段直接剥掉**，
 *    所以前端要传的每个字段都必须在这里显式声明，否则会「传了但服务端看不到」。
 */

/** 单条需求明细（前端从 AI 解析结果的 unmatched 里取出菜名段后上报） */
export class DemandReportItemDto {
  /**
   * ⚠️ **只传被识别成菜名的那一段**，不许塞整句对话。
   *    服务端还会再 sanitize 一次（见 demand.util.ts），两边都拦——
   *    因为客户原话里常带电话/地址，一旦进了清单就会被导出成 CSV 发出去。
   */
  @IsString()
  @MaxLength(64)
  rawText: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  qtyText?: string

  @IsOptional()
  @IsString()
  @MaxLength(10)
  unit?: string

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  qty?: number
}

/** 买家侧：上报客户要了但没收录的菜 */
export class DemandReportDto {
  @IsArray()
  @ArrayMaxSize(20, { message: '一次最多上报 20 条' })
  @ValidateNested({ each: true })
  @Type(() => DemandReportItemDto)
  items: DemandReportItemDto[]

  /** 1 AI 对话（默认）/ 2 后台手填。买家侧只可能是 1，保留字段便于将来扩展 */
  @IsOptional()
  @IsInt()
  @IsIn([1, 2])
  source?: number
}

/** 买家侧：上报 wx.requestSubscribeMessage 的结果 */
export class DemandSubscribeDto {
  @IsString()
  @MaxLength(64)
  templateId: string

  /** 用户在授权弹窗点了「允许」的模板 id 列表 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accepted?: string[]

  /** 用户点了「拒绝」或「总是保持以上选择」拒绝的模板 id 列表 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rejected?: string[]
}

/** 运营侧：改状态 / 备注 / 显示名 */
export class DemandUpdateDto {
  @IsOptional()
  @IsInt()
  @IsIn([0, 1, 2, 3], { message: 'status 只能为 0待采购/1已下单采购中/2已到货/3已放弃' })
  status?: number

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string

  /** ⚠️ 只改显示名，**不动 demandKey**（键是聚合与幂等的依据，改键会把历史明细拆散） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string
}

/** 运营侧：合并到另一条 */
export class DemandMergeDto {
  @IsInt({ message: 'targetId 必须为整数' })
  @Min(1)
  targetId: number
}

/** 运营侧：手动新增（电话/微信来的需求） */
export class DemandCreateDto {
  @IsString()
  @MaxLength(64)
  name: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  qtyText?: string

  @IsOptional()
  @IsString()
  @MaxLength(10)
  unit?: string

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  qty?: number

  /**
   * 对应的采购方档案 id。**可空**——电话/微信来的需求往往还没对应到账号。
   * 不传时落 `purchaser_id = 0` 哨兵值（= 运营代录）：
   * 计入「共几次」，但**不计入「几人在要」**（否则「人在要」会被运营自己刷高）。
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  purchaserId?: number

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string
}
