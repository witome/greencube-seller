import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common'
import { MeasureUnitService } from './measure-unit.service'
import { CreateUnitDto } from './dto/create-unit.dto'
import { UpdateUnitDto } from './dto/update-unit.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 计量单位字典（卡BV-1 2026-10-03；原型「商品管理 / 计量单位」+ 供应商端单位 chip）
///
/// ⚠️⚠️ **本控制器只声明 GET / POST / PATCH，绝不提供 DELETE。**
/// 口径（大辉拍板）：单位一旦被商品 / 历史订单引用，删掉会让老数据显示成空白 ——
/// 用过的单位一律**停用**（status=0），不真删。后人不要在这里加 @Delete()。
@Controller()
export class MeasureUnitController {
  constructor(private readonly service: MeasureUnitService) {}

  /// 启用中的单位（供应商端单位 chip + 后台商品表单下拉共用）
  /// 「登录即可调」：这里必须显式声明 @Roles —— 全局 RolesGuard 只在**声明了 @Roles** 的接口上
  /// 解析 Bearer token 并把 payload 挂到 req.user；不声明 = 完全公开（连登录都不用）。
  @Get('units')
  @Roles(Role.PURCHASER, Role.SUPPLIER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT)
  async listEnabled() {
    return this.service.listEnabled()
  }

  /// 后台「计量单位」维护页：全部（含停用）+ statusText
  @Get('admin/units')
  @Roles(Role.ADMIN)
  async listAll() {
    return this.service.listAll()
  }

  /// 新增单位（重名 → 1001「该单位已存在，请换一个」）
  @Post('admin/units')
  @Roles(Role.ADMIN)
  async create(@CurrentUser('userId') userId: bigint, @Body() dto: CreateUnitDto) {
    return this.service.create(userId, dto)
  }

  /// 改名 / 排序 / 启停
  @Patch('admin/units/:id')
  @Roles(Role.ADMIN)
  async update(
    @Param('id') id: string,
    @CurrentUser('userId') userId: bigint,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.service.update(Number(id), userId, dto)
  }
}
