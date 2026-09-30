import { Controller, Get, Param, Query } from '@nestjs/common'
import { ProductService } from './product.service'
import { Roles, Role } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

/// 商品（契约《开发配套-API接口字段契约》第 3 节）
/// ⚠️ 仅采购方可见销售价；供应商走 supplier-goods 模块看自己的商品
/// ⚠️ 卡AA（2026-09-30）：价格按采购方审核状态脱敏 —— 只有 accountStatus=2 能看到真实价格，
///     其余（未注册/待审核/驳回/终态/运营停用）salePrice=null + priceVisible=false（服务端抹除，非前端遮挡）
@Controller('product')
export class ProductController {
  constructor(private readonly service: ProductService) {}

  /// 分类树（采购方逛商品 + 供应商提交新品选分类，两者都需要）
  @Get('categories')
  @Roles(Role.PURCHASER, Role.SUPPLIER)
  async categories() {
    return this.service.categories()
  }

  /// 商品列表（⚠️ 仅返回销售价；未激活账号价格脱敏）
  @Get('list')
  @Roles(Role.PURCHASER)
  async list(@Query() query: any, @CurrentUser('userId') userId: bigint) {
    return this.service.list(query, userId)
  }

  /// 商品详情（⚠️ supplyPrice 恒为 null；未激活账号价格脱敏）
  @Get(':id')
  @Roles(Role.PURCHASER)
  async detail(@Param('id') id: string, @CurrentUser('userId') userId: bigint) {
    return this.service.detail(Number(id), userId)
  }
}
