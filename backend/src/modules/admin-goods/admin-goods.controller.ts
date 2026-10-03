import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common'
import { AdminGoodsService } from './admin-goods.service'
import { ReviewApplyDto } from './dto/review-apply.dto'
import { ReviewChangeDto } from './dto/review-change.dto'
import { SetPriorityDto } from './dto/set-priority.dto'
import { CreateProductDto } from './dto/create-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { BatchReviewDto } from './dto/batch-review.dto'
import { BatchChangeReviewDto } from './dto/batch-change-review.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 运营·商品（契约《开发配套-API接口字段契约》第 9 节）
@Controller('admin/goods')
export class AdminGoodsController {
  constructor(private readonly service: AdminGoodsService) {}

  /// 待审核新品
  @Get('pending')
  @Roles(Role.ADMIN)
  async pending() {
    return this.service.pending()
  }

  /// 待审核变更（新旧对照）
  @Get('change-pending')
  @Roles(Role.ADMIN)
  async changePending() {
    return this.service.changePending()
  }

  /// 商品管理：在售/下架商品列表（搜索/分类/状态筛选）
  @Get('list')
  @Roles(Role.ADMIN)
  async listProducts(@Query() query: any) {
    return this.service.listProducts(query)
  }

  /// 新增商品（运营直接添加，归属供应商 + 供货价 + 加价比例）
  @Post()
  @Roles(Role.ADMIN)
  async createProduct(@CurrentUser('userId') userId: bigint, @Body() dto: CreateProductDto) {
    return this.service.createProduct(userId, dto)
  }

  /// 编辑商品
  @Put(':id')
  @Roles(Role.ADMIN)
  async updateProduct(@Param('id') id: string, @CurrentUser('userId') userId: bigint, @Body() dto: UpdateProductDto) {
    return this.service.updateProduct(Number(id), userId, dto)
  }

  /// 上下架（0 下架 / 1 上架）
  @Put(':id/status')
  @Roles(Role.ADMIN)
  async updateProductStatus(@Param('id') id: string, @CurrentUser('userId') userId: bigint, @Body() body: any) {
    return this.service.updateProductStatus(Number(id), Number(body?.status), userId)
  }

  /// 卡BS（2026-10-03）：新品批量通过（逐条复用 reviewApply，单条失败不中断整批）
  /// 返回 { total, approved, failed: [{ id, name, reason }] }
  @Post('pending/batch-review')
  @Roles(Role.ADMIN)
  async batchReviewApply(@CurrentUser('userId') userId: bigint, @Body() dto: BatchReviewDto) {
    return this.service.batchReviewApply(userId, dto)
  }

  /// 卡BS（2026-10-03）：变更批量通过（逐条复用 reviewChange，单条失败不中断整批）
  @Post('change/batch-review')
  @Roles(Role.ADMIN)
  async batchReviewChange(@CurrentUser('userId') userId: bigint, @Body() dto: BatchChangeReviewDto) {
    return this.service.batchReviewChange(userId, dto)
  }

  /// 新品审核（通过上架 / 驳回）
  @Post('pending/:applyId/review')
  @Roles(Role.ADMIN)
  async reviewApply(@Param('applyId') applyId: string, @CurrentUser('userId') userId: bigint, @Body() dto: ReviewApplyDto) {
    return this.service.reviewApply(Number(applyId), userId, dto)
  }

  /// 变更审核（通过应用变更 / 驳回）
  @Post('change/:changeId/review')
  @Roles(Role.ADMIN)
  async reviewChange(@Param('changeId') changeId: string, @CurrentUser('userId') userId: bigint, @Body() dto: ReviewChangeDto) {
    return this.service.reviewChange(Number(changeId), userId, dto)
  }

  /// 供货优先级查询
  @Get(':productId/priority')
  @Roles(Role.ADMIN)
  async priority(@Param('productId') productId: string) {
    return this.service.priority(Number(productId))
  }

  /// 设置供货优先级（同一商品多供应商排序）
  @Put(':productId/priority')
  @Roles(Role.ADMIN)
  async setPriority(@Param('productId') productId: string, @CurrentUser('userId') userId: bigint, @Body() dto: SetPriorityDto) {
    return this.service.setPriority(Number(productId), userId, dto)
  }
}
