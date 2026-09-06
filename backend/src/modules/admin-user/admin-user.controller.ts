import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common'
import { AdminUserService } from './admin-user.service'
import { VerifyDto } from './dto/verify.dto'
import { AppealReviewDto } from './dto/appeal-review.dto'
import { AssignDto } from './dto/assign.dto'
import { CategoryDto } from './dto/category.dto'
import { SupplierCategoriesDto } from './dto/supplier-categories.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 运营·用户与审核（契约《开发配套-API接口字段契约》第 9 节）
/// ⚠️ 业务员(business_agent)是运营子账号，RolesGuard 已放行其访问 admin 接口
@Controller('admin')
export class AdminUserController {
  constructor(private readonly service: AdminUserService) {}

  /// 待审核采购方队列
  @Get('buyers/pending')
  @Roles(Role.ADMIN, Role.BUSINESS_AGENT)
  async pendingBuyers(@Query() query: any) {
    return this.service.pendingBuyers(query)
  }

  /// 核实详情（含系统风险预检）
  @Get('buyers/:id/verify-detail')
  @Roles(Role.ADMIN, Role.BUSINESS_AGENT)
  async verifyDetail(@Param('id') id: string) {
    return this.service.verifyDetail(Number(id))
  }

  /// 提交线下核实结论（通过/驳回）
  @Post('buyers/:id/verify')
  @Roles(Role.ADMIN, Role.BUSINESS_AGENT)
  async submitVerification(
    @Param('id') id: string,
    @CurrentUser('userId') userId: bigint,
    @Body() dto: VerifyDto,
  ) {
    return this.service.submitVerification(Number(id), userId, dto)
  }

  /// 申诉复核
  @Post('buyers/:id/appeal-review')
  @Roles(Role.ADMIN, Role.BUSINESS_AGENT)
  async reviewAppeal(
    @Param('id') id: string,
    @CurrentUser('userId') userId: bigint,
    @Body() dto: AppealReviewDto,
  ) {
    return this.service.reviewAppeal(Number(id), userId, dto)
  }

  /// 分配业务员
  @Post('buyers/:id/assign')
  @Roles(Role.ADMIN, Role.BUSINESS_AGENT)
  async assignAgent(@Param('id') id: string, @Body() dto: AssignDto) {
    return this.service.assignAgent(Number(id), dto)
  }

  /// 供应商列表
  @Get('suppliers')
  @Roles(Role.ADMIN)
  async suppliers() {
    return this.service.suppliers()
  }

  /// 配送员列表
  @Get('couriers')
  @Roles(Role.ADMIN)
  async couriers() {
    return this.service.couriers()
  }

  /// 分类树
  @Get('categories')
  @Roles(Role.ADMIN)
  async listCategories() {
    return this.service.listCategories()
  }

  /// 新增分类
  @Post('categories')
  @Roles(Role.ADMIN)
  async createCategory(@Body() dto: CategoryDto) {
    return this.service.createCategory(dto)
  }

  /// 修改分类
  @Put('categories/:id')
  @Roles(Role.ADMIN)
  async updateCategory(@Param('id') id: string, @Body() dto: CategoryDto) {
    return this.service.updateCategory(Number(id), dto)
  }

  /// 删除分类
  @Delete('categories/:id')
  @Roles(Role.ADMIN)
  async deleteCategory(@Param('id') id: string) {
    return this.service.deleteCategory(Number(id))
  }

  /// 查看供应商授权分类
  @Get('suppliers/:id/categories')
  @Roles(Role.ADMIN)
  async getSupplierCategories(@Param('id') id: string) {
    return this.service.getSupplierCategories(Number(id))
  }

  /// 设置供应商授权分类
  @Put('suppliers/:id/categories')
  @Roles(Role.ADMIN)
  async setSupplierCategories(@Param('id') id: string, @Body() dto: SupplierCategoriesDto) {
    return this.service.setSupplierCategories(Number(id), dto)
  }
}
