import { IsNotEmpty, IsString, IsInt, IsNumber, IsOptional, IsArray, MaxLength, Min, IsIn } from 'class-validator'

/// 卡BQ（2026-10-03）：就地编辑待审核/已驳回的新品申请（PUT /supplier-goods/apply/:applyId）
/// 字段与 ApplyGoodsDto 同口径；编辑是「整体替换」语义 —— 前端把 7 个可改字段全量回传，
/// 未传的可选字段（specText/images/qualification/cover/remark）保留原值不覆盖。
export class EditPendingApplyDto {
  @IsNotEmpty({ message: '商品名称不能为空' })
  @IsString()
  @MaxLength(100)
  name: string

  @IsInt({ message: 'categoryId 必须为整数' })
  categoryId: number

  /// 1 称重 / 2 固定规格
  @IsIn([1, 2], { message: 'weighType 只能为 1(称重) 或 2(固定规格)' })
  weighType: number

  @IsOptional()
  @IsString()
  @MaxLength(100)
  specText?: string

  @IsOptional()
  @IsString()
  @MaxLength(10)
  unit?: string

  @IsNumber({}, { message: '供货价必须为数字' })
  @Min(0.01, { message: '供货价必须大于 0' })
  supplyPrice: number

  @IsNumber({}, { message: '日可供量必须为数字' })
  @Min(0, { message: '日可供量不能为负' })
  dailySupply: number

  @IsOptional()
  @IsArray()
  images?: string[]

  @IsOptional()
  @IsArray()
  qualification?: string[]

  /// 封面图：可选；地址合法性（/uploads/ 或生产域名白名单）在 service 层校验，与 apply 同一套规则
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: '封面地址过长' })
  cover?: string

  /// 商品备注：可选，≤12 字（卡BU 2026-10-03，与 ApplyGoodsDto 同口径）；传空串 = 清空备注
  @IsOptional()
  @IsString()
  @MaxLength(12, { message: '商品备注最多 12 字' })
  remark?: string
}
