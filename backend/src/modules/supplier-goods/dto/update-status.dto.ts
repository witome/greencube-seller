import { IsIn, IsInt } from 'class-validator'

/// 供应商自助上下架（卡Z2，免审即时）：0 下架 / 1 重新上架
/// 与后台 admin-goods updateProductStatus 同一口径；其它值一律拒绝
export class UpdateStatusDto {
  @IsInt()
  @IsIn([0, 1], { message: '状态值不合法（0 下架 / 1 上架）' })
  status: number
}
