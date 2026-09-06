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
