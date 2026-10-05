import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { BizException, ErrorCode } from '../constants/error-codes'

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
    if (!required || required.length === 0) {
      // 卡CF（2026-10-05）浏览优先整改：公开接口改为「可选鉴权」——
      // 本项目没有独立 JWT 守卫，req.user 原本只在 @Roles 分支里赋值；
      // 浏览类接口（product/list、product/:id、buyer/home-content）放开后
      // 仍需 @CurrentUser('userId') 来区分「匿名=脱敏 / 激活采购方=真价」（卡AA 口径不变）。
      // 故这里尽力解析 Bearer token（合法则挂 req.user，非法/缺失一律静默放行，绝不拦截）。
      // ⚠️ @Roles 分支的鉴权与角色校验逻辑一行未动，写操作与个人数据接口安全性不变。
      const req = context.switchToHttp().getRequest()
      const auth = req.headers.authorization
      if (auth?.startsWith('Bearer ')) {
        try {
          req.user = this.jwtService.verify(auth.slice(7))
        } catch {
          /* 无效 token：按匿名处理，不拦截 */
        }
      }
      return true
    }

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

    // 业务员是运营子账号（决策5）：其权限**仅在接口显式声明** Role.BUSINESS_AGENT 时生效。
    // ⚠️ 禁止在此对 BUSINESS_AGENT 做「ADMIN 兜底放行」——
    //    那会让业务员越权访问全部 @Roles(Role.ADMIN) 接口（资金/派单/商品/审计/支付流水），违反权限铁律 3。
    //    铁律 3：业务员仅限采购方审核（对应 5 个接口已显式声明 @Roles(Role.ADMIN, Role.BUSINESS_AGENT)）。
    const currentRole = payload.currentRole
    const allRoles: string[] = payload.roles ?? []

    const allowed = required.includes(currentRole)

    if (!allowed) throw new BizException(ErrorCode.FORBIDDEN)

    req.user = payload
    return true
  }
}
