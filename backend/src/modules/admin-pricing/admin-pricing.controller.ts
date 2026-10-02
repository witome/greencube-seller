import { Controller, Get, Put, Post, Body, Param } from '@nestjs/common'
import { AdminPricingService } from './admin-pricing.service'
import { UpdatePricingDto } from './dto/update-pricing.dto'
import { BatchMarkupDto } from './dto/batch-markup.dto'
import { PutMarkupConfigDto, ApplyMarkupConfigDto } from './dto/markup-config.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 运营·价格与加价（销售价 = 供货价 × (1+加价比例)，运营维护）
/// 卡BI：加价比例体系 = 单品 > 供应商 > 分类 > 全局默认（配置见 markup-config 三个接口）
@Controller('admin/pricing')
export class AdminPricingController {
  constructor(private readonly service: AdminPricingService) {}

  /// 在售商品定价列表
  @Get()
  @Roles(Role.ADMIN)
  async list() {
    return this.service.list()
  }

  /// 加价配置：读取（全局/按分类/按供应商，未配的 rate 为 null）
  /// ⚠️ 静态路由必须声明在 ':productId' 之前，否则被参数路由吞掉
  @Get('markup-config')
  @Roles(Role.ADMIN)
  async getMarkupConfig() {
    return this.service.getMarkupConfig()
  }

  /// 加价配置：写入（upsert，只写配置；重算在售商品走下面的 apply）
  @Put('markup-config')
  @Roles(Role.ADMIN)
  async putMarkupConfig(@CurrentUser('userId') userId: bigint, @Body() dto: PutMarkupConfigDto) {
    return this.service.putMarkupConfig(userId, dto)
  }

  /// 加价配置：把当前配置重算到在售商品（跳过单品单独设过的），返回 { updated, skipped }
  @Post('markup-config/apply')
  @Roles(Role.ADMIN)
  async applyMarkupConfig(@CurrentUser('userId') userId: bigint, @Body() dto: ApplyMarkupConfigDto) {
    return this.service.applyMarkupConfig(userId, dto)
  }

  /// 批量加价（全部 / 按分类 / 按供应商 + 影响范围 applyNow）
  @Put('batch')
  @Roles(Role.ADMIN)
  async batch(@CurrentUser('userId') userId: bigint, @Body() dto: BatchMarkupDto) {
    return this.service.batchMarkup(userId, dto)
  }

  /// 改价（加价比例 / 销售价）；改比例 = 单品单独设过（markupOverridden=1）
  @Put(':productId')
  @Roles(Role.ADMIN)
  async update(@Param('productId') productId: string, @CurrentUser('userId') userId: bigint, @Body() dto: UpdatePricingDto) {
    return this.service.updatePricing(Number(productId), userId, dto)
  }
}
