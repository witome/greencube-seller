import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common'
import { CartService } from './cart.service'
import { AddCartDto } from './dto/add-cart.dto'
import { UpdateCartDto } from './dto/update-cart.dto'
import { SyncCartDto } from './dto/sync-cart.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 购物车（契约《开发配套-API接口字段契约》第 4 节）
@Controller('cart')
export class CartController {
  constructor(private readonly service: CartService) {}

  /// 购物车列表
  @Get()
  @Roles(Role.PURCHASER)
  async list(@CurrentUser('userId') userId: bigint) {
    return this.service.list(userId)
  }

  /// 加购
  @Post()
  @Roles(Role.PURCHASER)
  async add(@CurrentUser('userId') userId: bigint, @Body() dto: AddCartDto) {
    return this.service.add(userId, dto)
  }

  /// 整体替换草稿（卡AQ：AI 说话 / 前端合并后的完整 items 落库；/ai/parse 只读，写只走这里）
  /// ⚠️ 必须声明在 `@Put(':id')` **之前**：Nest 按声明顺序匹配，':id' 会把 'sync' 当 id 吃掉
  @Put('sync')
  @Roles(Role.PURCHASER)
  async sync(@CurrentUser('userId') userId: bigint, @Body() dto: SyncCartDto) {
    return this.service.sync(userId, dto)
  }

  /// 改数量（qty=0 即删除）
  @Put(':id')
  @Roles(Role.PURCHASER)
  async update(@CurrentUser('userId') userId: bigint, @Param('id') id: string, @Body() dto: UpdateCartDto) {
    return this.service.update(userId, Number(id), dto)
  }

  /// 删除
  @Delete(':id')
  @Roles(Role.PURCHASER)
  async remove(@CurrentUser('userId') userId: bigint, @Param('id') id: string) {
    return this.service.remove(userId, Number(id))
  }
}
