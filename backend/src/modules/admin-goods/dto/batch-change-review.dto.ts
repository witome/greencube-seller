import { IsArray, IsInt, ArrayNotEmpty, ArrayMaxSize } from 'class-validator'

/// 卡BS（2026-10-03）：变更申请「批量通过」
/// - changeIds：变更申请 id 列表（1~50 条，后端去重后逐条复用 reviewChange）
/// - 无比例/价格入参：涉价变更一律按该商品既有加价比例重算（与单条通过同一套逻辑）
export class BatchChangeReviewDto {
  @IsArray({ message: 'changeIds 必须是数组' })
  @ArrayNotEmpty({ message: 'changeIds 不能为空' })
  @ArrayMaxSize(50, { message: '一次最多批量通过 50 条，请分批' })
  @IsInt({ each: true, message: 'changeIds 必须是整数 id' })
  changeIds: number[]
}
