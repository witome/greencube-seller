import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common'
import { AdminUserService } from './admin-user.service'
import { VerifyDto } from './dto/verify.dto'
import { AppealReviewDto } from './dto/appeal-review.dto'
import { AssignDto } from './dto/assign.dto'
import { CategoryDto } from './dto/category.dto'
import { SupplierCategoriesDto } from './dto/supplier-categories.dto'
import { UpdateBuyerDto, UpdateSupplierDto, UpdateCourierDto } from './dto/update-profile.dto'
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

  /// 申诉记录列表（决策 6 · 2026-09-19）：运营/业务员查看申诉正文与附件
  /// 只读；采购方走 GET /buyer/appeals 只能看自己的
  @Get('appeals')
  @Roles(Role.ADMIN, Role.BUSINESS_AGENT)
  async appeals(@Query() query: any) {
    return this.service.appeals(query)
  }

  /// 分配业务员
  @Post('buyers/:id/assign')
  @Roles(Role.ADMIN, Role.BUSINESS_AGENT)
  async assignAgent(@Param('id') id: string, @CurrentUser('userId') userId: bigint, @Body() dto: AssignDto) {
    return this.service.assignAgent(Number(id), dto, userId)
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
  async createCategory(@CurrentUser('userId') userId: bigint, @Body() dto: CategoryDto) {
    return this.service.createCategory(dto, userId)
  }

  /// 修改分类
  @Put('categories/:id')
  @Roles(Role.ADMIN)
  async updateCategory(@Param('id') id: string, @CurrentUser('userId') userId: bigint, @Body() dto: CategoryDto) {
    return this.service.updateCategory(Number(id), dto, userId)
  }

  /// 删除分类
  @Delete('categories/:id')
  @Roles(Role.ADMIN)
  async deleteCategory(@Param('id') id: string, @CurrentUser('userId') userId: bigint) {
    return this.service.deleteCategory(Number(id), userId)
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
  async setSupplierCategories(
    @Param('id') id: string,
    @CurrentUser('userId') userId: bigint,
    @Body() dto: SupplierCategoriesDto,
  ) {
    return this.service.setSupplierCategories(Number(id), dto, userId)
  }

  /// 审核供应商（0 待审核 / 1 合作中 / 2 停合作）
  @Put('suppliers/:id/status')
  @Roles(Role.ADMIN)
  async updateSupplierStatus(@Param('id') id: string, @CurrentUser('userId') userId: bigint, @Body() body: any) {
    return this.service.updateSupplierStatus(Number(id), Number(body?.status), userId)
  }

  /// 审核配送员（0 待审核 / 1 正常 / 2 停用 / 9 黑名单）
  @Put('couriers/:id/status')
  @Roles(Role.ADMIN)
  async updateCourierStatus(@Param('id') id: string, @CurrentUser('userId') userId: bigint, @Body() body: any) {
    return this.service.updateCourierStatus(Number(id), Number(body?.status), userId)
  }

  /// 编辑采购方信息
  @Put('buyers/:id')
  @Roles(Role.ADMIN)
  async updateBuyer(@Param('id') id: string, @CurrentUser('userId') userId: bigint, @Body() dto: UpdateBuyerDto) {
    return this.service.updateBuyer(Number(id), userId, dto)
  }

  /// 编辑供应商信息
  @Put('suppliers/:id')
  @Roles(Role.ADMIN)
  async updateSupplier(@Param('id') id: string, @CurrentUser('userId') userId: bigint, @Body() dto: UpdateSupplierDto) {
    return this.service.updateSupplier(Number(id), userId, dto)
  }

  /// 编辑配送员信息
  @Put('couriers/:id')
  @Roles(Role.ADMIN)
  async updateCourier(@Param('id') id: string, @CurrentUser('userId') userId: bigint, @Body() dto: UpdateCourierDto) {
    return this.service.updateCourier(Number(id), userId, dto)
  }
}
