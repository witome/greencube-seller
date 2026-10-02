import { IsNumber, IsOptional, IsInt, Min, Max } from 'class-validator'

/// 加价比例配置写入（卡BI）：scope 1 全局 / 2 分类 / 3 供应商；rate 传小数（0.35 = 35%）
export class PutMarkupConfigDto {
  @IsInt({ message: 'scope 必须为 1/2/3' })
  scope: number

  /// 全局不传；分类传 categoryId；供应商传 supplierId
  @IsOptional()
  @IsNumber({}, { message: 'refId 必须为数字' })
  refId?: number

  @IsNumber({}, { message: '加价比例必须为数字' })
  @Min(0, { message: '加价比例不能为负' })
  @Max(9.99, { message: '加价比例过大' })
  rate: number
}

/// 把当前配置重算到在售商品（跳过 markupOverridden=1）
export class ApplyMarkupConfigDto {
  @IsInt({ message: 'scope 必须为 1/2/3' })
  scope: number

  @IsOptional()
  @IsNumber({}, { message: 'refId 必须为数字' })
  refId?: number
}
