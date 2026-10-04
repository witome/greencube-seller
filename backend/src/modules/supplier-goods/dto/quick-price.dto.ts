import { IsNumber, IsOptional, Min } from 'class-validator'

/// ⚡ 供应商自改「供货价 + 日可供量」（免审核，即时生效，卡CB 2026-10-04）
/// 大辉拍板：只对「供货价 + 日可供量」免审；品名/单位/备注仍走审核；不建 ProductApplication
/// ⚠️ 全局 ValidationPipe { whitelist: true } 会把未声明字段静默丢掉 —— 两个字段都必须声明
export class QuickPriceDto {
  @IsOptional()
  @IsNumber({}, { message: 'supplyPrice 必须为数字' })
  @Min(0.01, { message: '供货价必须大于 0' })
  supplyPrice?: number

  @IsOptional()
  @IsNumber({}, { message: 'dailySupply 必须为数字' })
  @Min(0, { message: '日可供量不能为负' })
  dailySupply?: number
}
