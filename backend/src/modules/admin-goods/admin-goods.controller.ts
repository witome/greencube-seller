import { Controller, Get, Post, Body, Param } from '@nestjs/common'
import { AdminGoodsService } from './admin-goods.service'
import { ReviewApplyDto } from './dto/review-apply.dto'
import { ReviewChangeDto } from './dto/review-change.dto'
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

  /// 供货优先级
  @Get(':productId/priority')
  @Roles(Role.ADMIN)
  async priority(@Param('productId') productId: string) {
    return this.service.priority(Number(productId))
  }
}
