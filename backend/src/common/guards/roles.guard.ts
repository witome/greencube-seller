import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { BizException, ErrorCode, Role } from '../constants/error-codes'

/**
 * 全局角色守卫
 * 决策 4：JWT payload 含 userId / roles[] / currentRole
 *        身份由服务端签发，客户端无法伪造；切换身份 = 重签 token
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    // 未标记 @Roles 的接口不拦截（如登录、健康检查）
    if (!required || required.length === 0) return true

    const req = context.switchToHttp().getRequest()
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) throw new BizException(ErrorCode.UNAUTHORIZED)

    const token = auth.slice(7)
    let payload: any
    try {
      payload = this.jwtService.verify(token)
    } catch {
      throw new BizException(ErrorCode.UNAUTHORIZED)
    }

    // 业务员是运营子账号（决策5）：拥有 admin 权限的子集
    const currentRole = payload.currentRole
    const allRoles: string[] = payload.roles ?? []

    const allowed =
      required.includes(currentRole) ||
      (currentRole === Role.BUSINESS_AGENT && required.includes(Role.ADMIN))

    if (!allowed) throw new BizException(ErrorCode.FORBIDDEN)

    req.user = payload
    return true
  }
}
