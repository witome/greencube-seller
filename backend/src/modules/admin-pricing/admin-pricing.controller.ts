import { Controller, Get, Put, Body, Param } from '@nestjs/common'
import { AdminPricingService } from './admin-pricing.service'
import { UpdatePricingDto } from './dto/update-pricing.dto'
import { BatchMarkupDto } from './dto/batch-markup.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 运营·价格与加价（销售价 = 供货价 × (1+加价比例)，运营维护）
@Controller('admin/pricing')
export class AdminPricingController {
  constructor(private readonly service: AdminPricingService) {}

  /// 在售商品定价列表
  @Get()
  @Roles(Role.ADMIN)
  async list() {
    return this.service.list()
  }

  /// 批量加价（按分类/全部）
  @Put('batch')
  @Roles(Role.ADMIN)
  async batch(@CurrentUser('userId') userId: bigint, @Body() dto: BatchMarkupDto) {
    return this.service.batchMarkup(userId, dto)
  }

  /// 改价（加价比例 / 销售价）
  @Put(':productId')
  @Roles(Role.ADMIN)
  async update(@Param('productId') productId: string, @CurrentUser('userId') userId: bigint, @Body() dto: UpdatePricingDto) {
    return this.service.updatePricing(Number(productId), userId, dto)
  }
}
