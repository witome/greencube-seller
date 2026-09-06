import { IsNumber, IsOptional, Min, Max, IsString, Matches } from 'class-validator'

/// 服务费配置
export class ServiceFeeConfigDto {
  @IsNumber({}, { message: 'rate 必须为数字' })
  @Min(0, { message: '费率不能为负' })
  @Max(1, { message: '费率不能超过 100%' })
  rate: number

  /// 可选：分类覆盖（不填则设全局默认）
  @IsOptional()
  @IsNumber()
  categoryId?: number
}

/// 生成结算单（period 格式 YYYY-MM）
export class GenerateSettlementDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'period 格式应为 YYYY-MM' })
  period: string
}
