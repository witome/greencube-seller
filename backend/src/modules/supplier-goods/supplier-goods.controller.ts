import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common'
import { SupplierGoodsService } from './supplier-goods.service'
import { ApplyGoodsDto } from './dto/apply-goods.dto'
import { EditPendingApplyDto } from './dto/edit-pending-apply.dto'
import { ChangeGoodsDto } from './dto/change-goods.dto'
import { QuickStockDto } from './dto/quick-stock.dto'
import { UpdateStatusDto } from './dto/update-status.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 供应商商品（契约《开发配套-API接口字段契约》第 6 节）
@Controller('supplier-goods')
export class SupplierGoodsController {
  constructor(private readonly service: SupplierGoodsService) {}

  /// 我的授权分类（发布商品时只能选这些分类）
  @Get('categories')
  @Roles(Role.SUPPLIER)
  async myCategories(@CurrentUser('userId') userId: bigint) {
    return this.service.myCategories(userId)
  }

  /// 我的商品（搜索/状态筛选）
  @Get()
  @Roles(Role.SUPPLIER)
  async list(@CurrentUser('userId') userId: bigint, @Query() query: any) {
    return this.service.list(userId, query)
  }

  /// 提交新品（审核制）
  @Post('apply')
  @Roles(Role.SUPPLIER)
  async apply(@CurrentUser('userId') userId: bigint, @Body() dto: ApplyGoodsDto) {
    return this.service.apply(userId, dto)
  }

  /// ✏️ 就地编辑待审核/已驳回的新品申请（卡BQ：原地改不新增申请；已通过 → 业务错引导走变更申请）
  /// ⚠️ 声明在 ':productId/...' 参数路由之前
  @Put('apply/:applyId')
  @Roles(Role.SUPPLIER)
  async editPendingApply(
    @CurrentUser('userId') userId: bigint,
    @Param('applyId') applyId: string,
    @Body() dto: EditPendingApplyDto,
  ) {
    return this.service.editPendingApply(userId, Number(applyId), dto)
  }

  /// 提交变更申请（走审核，原版本在售）
  @Post(':productId/change')
  @Roles(Role.SUPPLIER)
  async change(@CurrentUser('userId') userId: bigint, @Param('productId') productId: string, @Body() dto: ChangeGoodsDto) {
    return this.service.change(userId, Number(productId), dto)
  }

  /// ⚡ 快速改可供量（免审即时生效）
  @Put(':productId/stock')
  @Roles(Role.SUPPLIER)
  async quickStock(@CurrentUser('userId') userId: bigint, @Param('productId') productId: string, @Body() dto: QuickStockDto) {
    return this.service.quickStock(userId, Number(productId), dto)
  }

  /// 📷 换封面（免审即时生效，卡Z1：照片不涉价格口径，不走审核队列）
  @Put(':productId/cover')
  @Roles(Role.SUPPLIER)
  async updateCover(@CurrentUser('userId') userId: bigint, @Param('productId') productId: string, @Body() body: { cover?: string }) {
    return this.service.updateCover(userId, Number(productId), String(body?.cover ?? ''))
  }

  /// ⬇⬆ 自助下架/重新上架（免审即时，卡Z2：0 下架 / 1 上架，不进审核队列）
  @Put(':productId/status')
  @Roles(Role.SUPPLIER)
  async updateStatus(@CurrentUser('userId') userId: bigint, @Param('productId') productId: string, @Body() dto: UpdateStatusDto) {
    return this.service.updateStatus(userId, Number(productId), dto)
  }

  /// 🗑 撤销/删除自建申请（卡Z2：仅本人、仅待审核/已驳回；新品申请零引用才真删商品）
  @Delete('apply/:applyId')
  @Roles(Role.SUPPLIER)
  async deleteApply(@CurrentUser('userId') userId: bigint, @Param('applyId') applyId: string) {
    return this.service.deleteApply(userId, Number(applyId))
  }
}
