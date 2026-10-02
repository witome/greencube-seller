import { IsNumber, IsOptional, IsBoolean, Min, Max } from 'class-validator'

/// 批量加价：范围 = 全部 / 按分类 / 按供应商，统一设置加价比例并写配置
export class BatchMarkupDto {
  @IsNumber({}, { message: '加价比例必须为数字' })
  @Min(0, { message: '加价比例不能为负' })
  @Max(9.99, { message: '加价比例过大' })
  markupRate: number

  /// 可选：按分类（与 supplierId 二选一；都传时分类优先——业务上不会都传）
  @IsOptional()
  @IsNumber()
  categoryId?: number

  /// 可选：按供应商（卡BI 扩展）
  @IsOptional()
  @IsNumber()
  supplierId?: number

  /// 影响范围：false（默认）= 只影响以后新增（仅写配置，在售商品不动）；
  /// true = 同时重算在售商品（跳过单品单独设过的）
  @IsOptional()
  @IsBoolean({ message: 'applyNow 必须为布尔值' })
  applyNow?: boolean
}
