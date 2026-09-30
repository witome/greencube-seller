import { IsIn, IsInt } from 'class-validator'

/// 采购方启用/停用（卡AA 2026-09-30）
/// 只允许在 2（启用）与 5（运营停用）之间切换；其它值一律拒绝，
/// 不许借本接口触碰 待审核(1)/驳回(3)/终态驳回(4) 流程（那些走各自的审核接口）
export class BuyerStatusDto {
  @IsInt({ message: 'status 必须为整数' })
  @IsIn([2, 5], { message: 'status 只能为 2(启用) 或 5(运营停用)' })
  status: number
}
