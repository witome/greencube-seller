import { Controller, Post, Body } from '@nestjs/common'
import { RegisterService } from './register.service'
import { RegisterSupplierDto, RegisterCourierDto } from './dto/register.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 供应商 / 配送员注册（外部申请，运营后台审核）
/// 采购方注册见 buyer 模块 POST /buyer/register
/// ⚠️ 必须标记 @Roles 才会被全局守卫解析 JWT（否则 @CurrentUser 取不到 userId）
@Controller('register')
export class RegisterController {
  constructor(private readonly service: RegisterService) {}

  /// 供应商注册（任意已登录身份均可申请新身份）
  @Post('supplier')
  @Roles(Role.PURCHASER, Role.SUPPLIER, Role.COURIER)
  async registerSupplier(@CurrentUser('userId') userId: bigint, @Body() dto: RegisterSupplierDto) {
    return this.service.registerSupplier(userId, dto)
  }

  /// 配送员注册
  @Post('courier')
  @Roles(Role.PURCHASER, Role.SUPPLIER, Role.COURIER)
  async registerCourier(@CurrentUser('userId') userId: bigint, @Body() dto: RegisterCourierDto) {
    return this.service.registerCourier(userId, dto)
  }
}
