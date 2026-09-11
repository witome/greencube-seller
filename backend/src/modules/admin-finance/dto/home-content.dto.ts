import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested, ArrayMaxSize, IsArray } from 'class-validator'

export class DeliveryNoteDto {
  @IsString({ message: '横幅主文案必须为字符串' })
  @MaxLength(30, { message: '横幅主文案最长 30 字' })
  title: string

  @IsOptional()
  @IsString({ message: '横幅副文案必须为字符串' })
  @MaxLength(60, { message: '横幅副文案最长 60 字' })
  subtitle?: string
}

export class NoticeDto {
  @IsBoolean({ message: '公告启用开关必须为布尔' })
  enabled: boolean

  @IsOptional()
  @IsString({ message: '公告内容必须为字符串' })
  @MaxLength(100, { message: '公告内容最长 100 字' })
  text?: string
}

/// 首页内容（KV 三个 key，见 service）：横幅 / 公告 / 今日推荐位
export class HomeContentDto {
  @ValidateNested()
  @Type(() => DeliveryNoteDto)
  deliveryNote: DeliveryNoteDto

  @ValidateNested()
  @Type(() => NoticeDto)
  notice: NoticeDto

  /// 商品 id 有序数组（展示顺序即数组顺序）；空数组 = 前台显示空态
  @IsArray({ message: '推荐位必须为数组' })
  @ArrayMaxSize(10, { message: '推荐位最多 10 个商品' })
  @IsInt({ each: true, message: '推荐位商品 id 必须为整数' })
  @Min(1, { each: true, message: '推荐位商品 id 非法' })
  recommendationIds: number[]
}
