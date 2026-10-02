import { IsNotEmpty, IsString, IsInt, IsNumber, IsOptional, IsArray, MaxLength, Min, IsIn } from 'class-validator'

/// 提交新品（审核制，主计划 4.7）
export class ApplyGoodsDto {
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

  /// 封面图（2026-09-25 卡Z1）：可选；地址合法性（/uploads/ 或生产域名白名单）在 service 层校验，
  /// 与 PUT :productId/cover 用同一套规则
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: '封面地址过长' })
  cover?: string

  /// 商品备注（2026-10-02 卡BP）：可选，≤30 字，随申请走运营审核，
  /// 通过后写入 product_supplier_link.remark（挂在 link 上，多供应商互不覆盖）
  @IsOptional()
  @IsString()
  @MaxLength(30, { message: '商品备注最多 30 字' })
  remark?: string
}
