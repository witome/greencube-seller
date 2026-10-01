import { IsArray, ValidateNested, IsInt, IsNumber, ArrayMaxSize } from 'class-validator'
import { Type } from 'class-transformer'

/// 整体替换草稿的一行（卡AQ 2026-10-01）
export class SyncCartItemDto {
  @IsInt({ message: 'productId 必须为整数' })
  productId: number

  /// ⚠️ 已是「斤」——AI 侧 parse 已换算好，这里**绝不二次换算**
  /// ⚠️ 刻意**不加 @Min**：非正数/脏数据由 CartService.sync 统一「跳过并忽略」，
  ///    在 DTO 层直接 400 会把整份草稿的写入一起拒绝（一次说一句话里有一行脏数据就整单写不进去）。
  @IsNumber({}, { message: 'qty 必须为数字' })
  qty: number
}

/// 整体替换购物车/草稿（PUT /cart/sync）
/// 语义：服务端把当前 userId 的 cart_item **整体替换**成这份 items
export class SyncCartDto {
  @IsArray({ message: 'items 必须为数组' })
  @ArrayMaxSize(200, { message: '一次最多同步 200 行' })
  @ValidateNested({ each: true })
  @Type(() => SyncCartItemDto)
  items: SyncCartItemDto[]
}
