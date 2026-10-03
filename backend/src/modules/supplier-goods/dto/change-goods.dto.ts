import { IsNotEmptyObject, IsOptional, IsString, IsNumber, IsInt, IsIn, MaxLength, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

/// 变更字段（可空的都是「本次不修改」）
class ChangesDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string

  @IsOptional()
  @IsInt()
  categoryId?: number

  @IsOptional()
  @IsIn([1, 2])
  weighType?: number

  @IsOptional()
  @IsString()
  @MaxLength(100)
  specText?: string

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  supplyPrice?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  dailySupply?: number

  /// 卡BV-1（2026-10-03）：单位进变更（原型口径：改了单位 → 随变更一起走运营审核）。
  /// 可选：不传 = 不改；传了由 service 校验「启用中 ∪ 商品当前单位」。
  /// ⚠️ 必须在这里显式声明 —— 全局 ValidationPipe 开了 whitelist，
  /// 没装饰器的字段会被静默丢弃（前端传了 unit 也进不到 changes 里）。
  @IsOptional()
  @IsString()
  @MaxLength(10, { message: '计量单位最多 10 字' })
  unit?: string

  /// 商品备注（2026-10-02 卡BP）：挂 product_supplier_link.remark，审核通过后写入
  /// 卡BU（2026-10-03）：30 → 12 字（与新品申请同口径）
  @IsOptional()
  @IsString()
  @MaxLength(12, { message: '商品备注最多 12 字' })
  remark?: string
}

/// 提交变更申请（走审核，原版本在售至新版本生效）
export class ChangeGoodsDto {
  @IsNotEmptyObject({}, { message: '变更内容不能为空' })
  @ValidateNested()
  @Type(() => ChangesDto)
  changes: ChangesDto

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string
}
