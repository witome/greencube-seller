import { Type } from 'class-transformer'
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches,
  MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator'

/// 卡BA-2（2026-10-01）：横幅滚动图 / 常用功能宫格 / 客服电话 三处首页运营化。
/// 配置仍走 platform_config KV（home_banner_images / home_features / service_hotline），schema 零改动。

/// 横版滚动图片（替换原配送说明文字横幅；空数组 = 不渲染，回退公告）
export class BannerImagesDto {
  @IsBoolean({ message: '横幅图片启用开关必须为布尔' })
  enabled: boolean

  /// 图片 URL 数组（展示顺序即数组顺序；1~10 张，空数组=不显示）
  @IsArray({ message: '横幅图片必须为数组' })
  @ArrayMaxSize(10, { message: '横幅图片最多 10 张' })
  @IsString({ each: true, message: '横幅图片 URL 必须为字符串' })
  images: string[]
}

/// 常用功能宫格单项。type 三档：
///   tab   = tabBar 页（switchTab 跳转，仅 5 个 tab 页合法）
///   page  = 普通页面（navigateTo）
///   todo  = 前端提示「功能建设中」（占位，不跳转）
export class HomeFeatureDto {
  @IsString({ message: '功能 key 必须为字符串' })
  @MaxLength(30, { message: '功能 key 最长 30 字符' })
  key: string

  @IsString({ message: '功能名称必须为字符串' })
  @MinLength(1, { message: '功能名称不能为空' })
  @MaxLength(8, { message: '功能名称最长 8 字（宫格标签一格一行）' })
  label: string

  @IsString({ message: '功能图标必须为字符串' })
  @MaxLength(8, { message: '功能图标最长 8 字符' })
  emoji: string

  @IsIn(['tab', 'page', 'todo'], { message: '跳转类型只允许 tab / page / todo' })
  type: string

  @IsString({ message: '跳转页面必须为字符串' })
  @MaxLength(100, { message: '跳转页面路径最长 100 字符' })
  page: string
}

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

/// 首页内容（KV 五个 key，见 service）：横幅 / 公告 / 今日特价位 / 滚动图 / 常用功能
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

  /// 卡BA-2：横幅滚动图（可选项，兼容老表单不传；不传 = 保持原值不覆盖）
  @IsOptional()
  @ValidateNested()
  @Type(() => BannerImagesDto)
  bannerImages?: BannerImagesDto

  /// 卡BA-2：常用功能宫格（可选项，不传 = 保持原值；空数组 = 前台用内置默认宫格）
  @IsOptional()
  @IsArray({ message: '常用功能必须为数组' })
  @ArrayMaxSize(8, { message: '常用功能最多 8 个' })
  @ValidateNested({ each: true })
  @Type(() => HomeFeatureDto)
  features?: HomeFeatureDto[]

  /// 卡BA-2：客服电话（可选项；空字符串 = 首页不显示客服入口）
  @IsOptional()
  @Matches(/^$|^1[3-9]\d{9}$|^\d{3,4}-?\d{7,8}$/, { message: '客服电话格式不正确（手机号或座机号）' })
  serviceHotline?: string
}
