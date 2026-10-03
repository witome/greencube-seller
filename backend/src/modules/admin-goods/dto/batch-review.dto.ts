import { IsArray, IsInt, IsNumber, IsOptional, Min, Max, ArrayNotEmpty, ArrayMaxSize } from 'class-validator'

/// 卡BS（2026-10-03）：新品申请「批量通过」
/// - applyIds：申请 id 列表（1~50 条，后端去重后逐条复用 reviewApply）
/// - markupRate：可选。留空 = 按 供应商>分类>全局 自动解析（markupOverridden=0）；
///   填写 = 这批商品统一固定为「单品」比例（markupOverridden=1）
export class BatchReviewDto {
  @IsArray({ message: 'applyIds 必须是数组' })
  @ArrayNotEmpty({ message: 'applyIds 不能为空' })
  @ArrayMaxSize(50, { message: '一次最多批量通过 50 条，请分批' })
  @IsInt({ each: true, message: 'applyIds 必须是整数 id' })
  applyIds: number[]

  @IsOptional()
  @IsNumber({}, { message: 'markupRate 必须为数字' })
  @Min(0, { message: '加价比例不能为负' })
  @Max(2, { message: '加价比例不能超过 2' })
  markupRate?: number
}
