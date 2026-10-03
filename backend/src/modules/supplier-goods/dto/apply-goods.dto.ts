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

  /// 卡BV-1（2026-10-03）：**必填**（原为可选，后端兜底写死 '斤'）。
  /// 取值必须是 measure_unit 里「启用中」的单位 —— 表级校验在 service 层（查库），
  /// 这里只保证「传了、是字符串、长度合法」；空值由 @IsNotEmpty 拦成 400。
  @IsNotEmpty({ message: '请选择计量单位' })
  @IsString()
  @MaxLength(10, { message: '计量单位最多 10 字' })
  unit: string

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

  /// 商品备注（2026-10-02 卡BP）：可选，随申请走运营审核，
  /// 通过后写入 product_supplier_link.remark（挂在 link 上，多供应商互不覆盖）
  /// 卡BU（2026-10-03）：30 → 12 字（买家商品卡灰字位与规格说明抢同一行，30 字会撑乱卡片）
  @IsOptional()
  @IsString()
  @MaxLength(12, { message: '商品备注最多 12 字' })
  remark?: string
}
