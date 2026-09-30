import { Controller, Get, Put, Body } from '@nestjs/common'
import { SupplierService } from './supplier.service'
import { UpdateSupplierProfileDto } from './dto/update-profile.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 供应商·店铺资料自助（2026-09-11 深夜卡第二部分）
/// 只按 token 的 userId 读写自己的档案，不接受任何 targetId/id 参数
@Controller('supplier')
export class SupplierController {
  constructor(private readonly service: SupplierService) {}

  /// 店铺资料读取（含资质只读展示字段）
  @Get('profile')
  @Roles(Role.SUPPLIER)
  async myProfile(@CurrentUser('userId') userId: bigint) {
    return this.service.getSelfProfile(userId)
  }

  /// 审核状态查询（审核中页轮询用；角色放行与 /buyer/pending 同款宽松口径——
  /// 注册后旧 token 的 roles 可能为空，靠 userId 行级隔离保证只读自己）
  @Get('pending')
  @Roles(Role.SUPPLIER, Role.PURCHASER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT)
  async pending(@CurrentUser('userId') userId: bigint) {
    return this.service.pending(userId)
  }

  /// 店铺资料修改（档口名/地址/联系人/电话；资质与状态不可改，见 DTO 注释）
  @Put('profile')
  @Roles(Role.SUPPLIER)
  async updateMyProfile(@CurrentUser('userId') userId: bigint, @Body() dto: UpdateSupplierProfileDto) {
    return this.service.updateSelfProfile(userId, dto)
  }

  /// 售后台账（卡AE 2026-09-30）—— **只读**：只看归属本档口的工单 + 待处理条数（首页红点）
  /// 只按 token 的 userId 取自己的 supplier 档案，代码里没有任何 supplierId 入参，杜绝越权读别家
  @Get('aftersale')
  @Roles(Role.SUPPLIER)
  async myAftersales(@CurrentUser('userId') userId: bigint) {
    return this.service.myAftersales(userId)
  }
}
