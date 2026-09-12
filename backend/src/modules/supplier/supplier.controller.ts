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

  /// 店铺资料修改（档口名/地址/联系人/电话；资质与状态不可改，见 DTO 注释）
  @Put('profile')
  @Roles(Role.SUPPLIER)
  async updateMyProfile(@CurrentUser('userId') userId: bigint, @Body() dto: UpdateSupplierProfileDto) {
    return this.service.updateSelfProfile(userId, dto)
  }
}
