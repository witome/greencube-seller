import { Controller, Get, Post, Body } from '@nestjs/common'
import { AuthService } from './auth.service'
import { WxLoginDto } from './dto/wx-login.dto'
import { SwitchRoleDto } from './dto/switch-role.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 全部身份都需登录态（触发 RolesGuard 解析 JWT → 填充 req.user）
const ALL_ROLES = [Role.PURCHASER, Role.SUPPLIER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT]

/// 认证与身份（契约《开发配套-API接口字段契约》第 1 节）
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  /// 微信登录：返回 token + roles + currentRole + accountStatus + needRegister
  @Post('wx-login')
  async wxLogin(@Body() dto: WxLoginDto) {
    return this.service.wxLogin(dto)
  }

  /// 决策4：切换身份重签 token，旧 token 失效
  @Post('switch-role')
  @Roles(...ALL_ROLES)
  async switchRole(@CurrentUser('userId') userId: bigint, @Body() dto: SwitchRoleDto) {
    return this.service.switchRole(userId, dto)
  }

  /// 当前用户资料与全部身份
  @Get('profile')
  @Roles(...ALL_ROLES)
  async profile(@CurrentUser('userId') userId: bigint, @CurrentUser('currentRole') currentRole: string) {
    return this.service.profile(userId, currentRole)
  }
}
