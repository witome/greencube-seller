import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, Role } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { verifyPassword } from '../../common/utils/password.util'
import { WxLoginDto } from './dto/wx-login.dto'
import { SwitchRoleDto } from './dto/switch-role.dto'
import { AdminLoginDto } from './dto/admin-login.dto'

/// 微信 code2session 返回结构
interface WxSession {
  openid: string
  unionid?: string
  session_key?: string
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
  ) {}

  // ────────────────────────────────────────
  // 微信登录（契约《开发配套-API接口字段契约》第 1 节）
  // ────────────────────────────────────────
  async wxLogin(dto: WxLoginDto) {
    const session = await this.code2session(dto.code)
    if (!session?.openid) throw new BizException(ErrorCode.PARAM_ERROR, '微信登录失败：无效的 code')

    let user = await this.prisma.user.findUnique({
      where: { wxOpenid: session.openid },
      include: { purchaser: true, supplier: true, courier: true },
    })

    let isNew = false
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          wxOpenid: session.openid,
          wxUnionid: session.unionid,
          // phone 留空，采购方注册流程中补齐
          roles: [],
          status: 1,
        },
        include: { purchaser: true, supplier: true, courier: true },
      })
      isNew = true
    }

    if (user.status === 0) throw new BizException(ErrorCode.FORBIDDEN, '账号已被禁用')

    const roles = await this.resolveRoles(user.id, user)
    const currentRole = this.pickRole(dto.code, roles)

    return {
      token: this.signToken(user.id, roles, currentRole),
      userId: Number(user.id),
      roles,
      currentRole,
      accountStatus: user.purchaser ? user.purchaser.accountStatus : null,
      needRegister: isNew || roles.length === 0,
    }
  }

  // ────────────────────────────────────────
  // 后台「账号+密码」登录（拍板 1A，2026-09-19）
  // ────────────────────────────────────────
  // 限流：同一 账号+IP 连续失败 5 次 → 锁定 15 分钟（内存态，适用于单实例部署）
  private static readonly LOCK_THRESHOLD = 5
  private static readonly LOCK_MS = 15 * 60 * 1000
  /** 统一失败文案：绝不区分「账号不存在」与「密码错误」（防账号枚举） */
  private static readonly ADMIN_LOGIN_UNIFIED_MSG = '账号或密码错误'
  private loginFails = new Map<string, { count: number; lockedUntil: number }>()

  async adminLogin(dto: AdminLoginDto, ip: string) {
    const username = String(dto.username || '').trim()
    const key = `${username}|${ip || 'unknown'}`
    const now = Date.now()

    // 内存超限则清理已过锁期的记录（防长期运行膨胀；锁已过期，下次尝试重新计数）
    if (this.loginFails.size > 1000) {
      for (const [k, v] of this.loginFails) {
        if (v.lockedUntil && v.lockedUntil <= now) this.loginFails.delete(k)
      }
    }

    // 失败统一出口：统一文案 + 审计（记录 username + 失败类别 + ip；绝不记录密码）
    const fail = async (reason: string) => {
      const prev = this.loginFails.get(key)
      const count = (prev?.count || 0) + 1
      const lockedUntil = count >= AuthService.LOCK_THRESHOLD ? now + AuthService.LOCK_MS : 0
      this.loginFails.set(key, { count, lockedUntil })
      await this.audit.log({
        operatorId: 0n,
        action: 'ADMIN_LOGIN_FAILED',
        entity: 'user',
        entityId: 0,
        after: { username, reason, ip: ip || 'unknown' },
      })
      throw new BizException(ErrorCode.FORBIDDEN, AuthService.ADMIN_LOGIN_UNIFIED_MSG)
    }

    // 锁定期直接拒绝（文案不含账号有效性信息，锁的是「尝试的账号+IP」组合）
    const rec = this.loginFails.get(key)
    if (rec && rec.lockedUntil > now) {
      await this.audit.log({
        operatorId: 0n,
        action: 'ADMIN_LOGIN_FAILED',
        entity: 'user',
        entityId: 0,
        after: { username, reason: 'locked', ip: ip || 'unknown' },
      })
      throw new BizException(ErrorCode.FORBIDDEN, '失败次数过多，已临时锁定，请15分钟后再试')
    }

    // 用户存在 + passwordHash 非空（name 非唯一约束，可能多条，逐一恒定时间比对，任一通过即可）
    const candidates = await this.prisma.user.findMany({
      where: { name: username, passwordHash: { not: null } },
      select: { id: true, passwordHash: true, roles: true, status: true },
    })
    if (candidates.length === 0) await fail('bad_credentials')

    let matched: { id: bigint; passwordHash: string; roles: any; status: number } | null = null
    for (const c of candidates) {
      if (await verifyPassword(dto.password, c.passwordHash!)) {
        matched = c as any
        break
      }
    }
    if (!matched) await fail('bad_credentials')
    if (matched.status !== 1) await fail('account_disabled')
    const roles: string[] = Array.isArray(matched.roles) ? matched.roles : []
    if (!roles.includes(Role.ADMIN)) await fail('not_admin')

    // 成功：清失败计数 + 审计
    this.loginFails.delete(key)
    await this.audit.log({
      operatorId: matched.id,
      action: 'ADMIN_LOGIN_SUCCESS',
      entity: 'user',
      entityId: matched.id,
      after: { username, ip: ip || 'unknown' },
    })

    // 与 /auth/wx-login 同款 JWT：现有路由守卫 / RolesGuard 零改动即可工作
    return {
      token: this.signToken(matched.id, roles, Role.ADMIN),
      userId: Number(matched.id),
      roles,
      currentRole: Role.ADMIN,
    }
  }

  // ────────────────────────────────────────
  // 决策 4：切换身份 → 重签 token，旧 token 失效
  // ────────────────────────────────────────
  async switchRole(userId: bigint, dto: SwitchRoleDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { purchaser: true, supplier: true, courier: true },
    })
    if (!user) throw new BizException(ErrorCode.NOT_FOUND, '用户不存在')

    const roles = await this.resolveRoles(user.id, user)

    // ⚠️ 服务端校验：只能切到已拥有的身份，防止客户端伪造
    if (!roles.includes(dto.role)) {
      throw new BizException(ErrorCode.FORBIDDEN, '该账号不具备此身份')
    }

    return {
      token: this.signToken(user.id, roles, dto.role),
      currentRole: dto.role,
    }
  }

  // ────────────────────────────────────────
  // 当前用户资料
  // ────────────────────────────────────────
  async profile(userId: bigint, currentRole: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { purchaser: true, supplier: true, courier: true },
    })
    if (!user) throw new BizException(ErrorCode.NOT_FOUND, '用户不存在')

    return {
      userId: Number(user.id),
      phone: user.phone,
      name: user.name,
      roles: await this.resolveRoles(user.id, user),
      currentRole,
      purchaser: user.purchaser
        ? {
            id: Number(user.purchaser.id),
            shopName: user.purchaser.shopName,
            contact: user.purchaser.contact,
            phone: user.purchaser.phone,
            payMode: user.purchaser.payMode,
            creditLimit: Number(user.purchaser.creditLimit),
            qualification: user.purchaser.qualification,
            accountStatus: user.purchaser.accountStatus,
          }
        : null,
      supplier: user.supplier
        ? { id: Number(user.supplier.id), stallName: user.supplier.stallName, status: user.supplier.status }
        : null,
      courier: user.courier
        ? { id: Number(user.courier.id), source: user.courier.source, status: user.courier.status }
        : null,
    }
  }

  // ────────────────────────────────────────
  // 内部方法
  // ────────────────────────────────────────

  /** 解析用户全部身份：存储值 ∪ 关联表推导值 */
  private async resolveRoles(userId: bigint, user?: any): Promise<string[]> {
    const u = user || (await this.prisma.user.findUnique({
      where: { id: userId },
      include: { purchaser: true, supplier: true, courier: true },
    }))
    if (!u) return []

    const stored: string[] = Array.isArray(u.roles) ? u.roles : []
    const derived: string[] = []
    if (u.purchaser) derived.push(Role.PURCHASER)
    if (u.supplier) derived.push(Role.SUPPLIER)
    if (u.courier) derived.push(Role.COURIER)

    const all = Array.from(new Set([...stored, ...derived]))

    // 有变化时回写，保持 roles 字段与实际关联一致
    if (all.length !== stored.length || all.some((r) => !stored.includes(r))) {
      await this.prisma.user.update({ where: { id: userId }, data: { roles: all } })
    }
    return all
  }

  /** 默认身份选取顺序 */
  private pickDefaultRole(roles: string[]): string {
    const order = [Role.PURCHASER, Role.SUPPLIER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT]
    return order.find((r) => roles.includes(r)) ?? Role.PURCHASER
  }

  /**
   * 登录时选择当前身份：
   * 开发 mock 登录（WX_MOCK_LOGIN=1）时，code 即角色意图（buyer/demo_supplier/courier/admin），
   * 优先选 code 对应角色，避免 pickDefaultRole 总是优先 purchaser 导致切换角色时 currentRole 错乱。
   */
  private pickRole(code: string, roles: string[]): string {
    const roleMap: Record<string, string> = {
      buyer: Role.PURCHASER,
      demo_supplier: Role.SUPPLIER,
      courier: Role.COURIER,
      admin: Role.ADMIN,
      business_agent: Role.BUSINESS_AGENT,
    }
    const intended = roleMap[code]
    if (intended && roles.includes(intended)) return intended
    return this.pickDefaultRole(roles)
  }

  /** 决策 4：JWT payload 内嵌 currentRole */
  private signToken(userId: bigint, roles: string[], currentRole: string): string {
    return this.jwt.sign({
      sub: Number(userId),
      userId: Number(userId),
      roles,
      currentRole,
    })
  }

  /**
   * 微信 code2session
   * ⚠️ 未配置 WX_APPID/WX_SECRET 时进入开发 mock：用 code 直接当 openid，
   *    便于本地无凭证调试（AppID 下来后自动走真实接口）
   */
  private async code2session(code: string): Promise<WxSession> {
    const appid = process.env.WX_APPID
    const secret = process.env.WX_SECRET
    // 开发 mock 开关：WX_MOCK_LOGIN=1 时用 code 直接当 openid（H5 无 wx.login），
    // 否则走真实 code2session（小程序端需设置 WX_MOCK_LOGIN=0）
    const mockLogin = process.env.WX_MOCK_LOGIN === '1'

    if (mockLogin || !appid || !secret) {
      console.warn('[auth] 使用开发 mock 登录')
      return { openid: `dev_${code}` }
    }

    const url =
      `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}` +
      `&secret=${secret}&js_code=${code}&grant_type=authorization_code`

    const res = await fetch(url)
    const data: any = await res.json()

    if (data.errcode) {
      throw new BizException(ErrorCode.PARAM_ERROR, `微信登录失败：${data.errmsg || data.errcode}`)
    }
    return { openid: data.openid, unionid: data.unionid, session_key: data.session_key }
  }
}
