import { Controller, Get, Param, Query } from '@nestjs/common'
import { ProductService } from './product.service'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 商品（契约《开发配套-API接口字段契约》第 3 节）
/// ⚠️ 仅采购方可见销售价；供应商走 supplier-goods 模块看自己的商品
@Controller('product')
export class ProductController {
  constructor(private readonly service: ProductService) {}

  /// 分类树（采购方逛商品 + 供应商提交新品选分类，两者都需要）
  @Get('categories')
  @Roles(Role.PURCHASER, Role.SUPPLIER)
  async categories() {
    return this.service.categories()
  }

  /// 商品列表（⚠️ 仅返回销售价）
  @Get('list')
  @Roles(Role.PURCHASER)
  async list(@Query() query: any) {
    return this.service.list(query)
  }

  /// 商品详情（⚠️ supplyPrice 恒为 null）
  @Get(':id')
  @Roles(Role.PURCHASER)
  async detail(@Param('id') id: string) {
    return this.service.detail(Number(id))
  }
}
