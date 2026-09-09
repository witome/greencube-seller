import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, AccountStatus, OrderStatus } from '../../common/constants/error-codes'
import { RegisterDto } from './dto/register.dto'
import { AppealDto } from './dto/appeal.dto'
import { AftersaleDto } from './dto/aftersale.dto'

@Injectable()
export class BuyerService {
  constructor(private prisma: PrismaService) {}

  // ────────────────────────────────────────
  // 注册提交 → accountStatus=1 待审核
  // 契约《开发配套-API接口字段契约》第 2 节
  // ────────────────────────────────────────
  async register(userId: bigint, dto: RegisterDto) {
    // ① 手机号 30 天内注册次数校验（决策：防羊毛）
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const phoneCount = await this.prisma.purchaser.count({
      where: { phone: dto.phone, registeredAt: { gte: thirtyDaysAgo } },
    })
    if (phoneCount >= 2) throw new BizException(ErrorCode.PHONE_REGIST_TOO_OFTEN)

    // ② 营业执照唯一校验
    if (dto.businessLicenseNo) {
      const dup = await this.prisma.purchaser.findUnique({
        where: { businessLicenseNo: dto.businessLicenseNo },
      })
      if (dup) throw new BizException(ErrorCode.LICENSE_DUPLICATED)
    }

    // ③ 已存在采购方身份则不允许重复注册
    const existing = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (existing) throw new BizException(ErrorCode.PARAM_ERROR, '已注册，请勿重复提交')

    const purchaser = await this.prisma.purchaser.create({
      data: {
        userId,
        shopName: dto.shopName,
        contact: dto.contact,
        phone: dto.phone,
        address: dto.address,
        deliveryWindows: dto.deliveryWindows ?? ['中 10-13'],
        // 空字符串统一转 null，避免 business_license_no 唯一约束冲突（前端会传 ''）
        businessLicenseNo: dto.businessLicenseNo || null,
        businessLicenseImg: dto.licenseImg || null,
        foodPermitImg: dto.permitImg || null,
        accountStatus: AccountStatus.PENDING,
      },
    })

    // 同步手机号到 user（首填）；roles 由 auth 登录时的 resolveRoles 依据 purchaser 关联自动补齐
    await this.prisma.user.update({
      where: { id: userId },
      data: { phone: dto.phone },
    })

    return {
      purchaserId: Number(purchaser.id),
      accountStatus: purchaser.accountStatus,
      estimatedHours: 24,
    }
  }

  // ────────────────────────────────────────
  // 待审核状态与进度步骤条
  // ────────────────────────────────────────
  async pending(userId: bigint) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    const submittedAt = purchaser.registeredAt
    const overdue = Date.now() - submittedAt.getTime() > 24 * 3600 * 1000

    let steps
    if (purchaser.accountStatus === AccountStatus.PENDING) {
      steps = [
        { key: 'submit', label: '资料提交', status: 'done', time: submittedAt.toISOString() },
        { key: 'verify', label: '业务员核实中', status: 'active', time: null },
        { key: 'active', label: '账号激活', status: 'todo', time: null },
      ]
    } else if (purchaser.accountStatus === AccountStatus.REJECTED) {
      steps = [
        { key: 'submit', label: '资料提交', status: 'done', time: submittedAt.toISOString() },
        { key: 'verify', label: '业务员核实', status: 'done', time: purchaser.verifiedAt?.toISOString() ?? null },
        { key: 'active', label: '账号激活', status: 'rejected', time: null },
      ]
    } else {
      steps = [
        { key: 'submit', label: '资料提交', status: 'done', time: submittedAt.toISOString() },
        { key: 'verify', label: '业务员核实', status: 'done', time: purchaser.verifiedAt?.toISOString() ?? null },
        { key: 'active', label: '账号激活', status: 'done', time: purchaser.verifiedAt?.toISOString() ?? null },
      ]
    }

    return {
      accountStatus: purchaser.accountStatus,
      submittedAt: submittedAt.toISOString(),
      overdue,
      steps,
      rejectInfo:
        purchaser.accountStatus === AccountStatus.REJECTED
          ? {
              reason: purchaser.rejectReasonText,
              reasonCode: purchaser.rejectReasonCode,
            }
          : null,
    }
  }

  // ────────────────────────────────────────
  // 提交申诉（30 天内仅 1 次）
  // ────────────────────────────────────────
  async appeal(userId: bigint, dto: AppealDto) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    if (purchaser.accountStatus !== AccountStatus.REJECTED) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '当前状态不可申诉')
    }
    if (purchaser.appealCount30d >= 1) throw new BizException(ErrorCode.APPEAL_LIMIT)

    // 记录申诉内容（可写入备注字段或单独表；此处简化：留痕到 rejectReasonText 前的 audit）
    await this.prisma.purchaser.update({
      where: { id: purchaser.id },
      data: {
        accountStatus: AccountStatus.PENDING,
        appealCount30d: { increment: 1 },
      },
    })

    return { appealId: 0, accountStatus: AccountStatus.PENDING }
  }

  // ────────────────────────────────────────
  // 催办
  // ────────────────────────────────────────
  async urgeVerify(userId: bigint) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND)
    if (purchaser.accountStatus !== AccountStatus.PENDING) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '当前状态无需催办')
    }
    // 真实实现：发通知给运营/业务员（短信、站内信、企业微信），此处占位
    return { urged: true, nextFollowHours: 1 }
  }

  // ────────────────────────────────────────
  // 月度对账单（契约第 2 节补充）
  // 按 deliveryDate 汇总当月订单；拒收部分已剔除（amountFinal 已扣减）
  // ────────────────────────────────────────
  async bill(userId: bigint, period: string) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    // period 形如 "2026-09"
    const [y, m] = period.split('-').map((n) => Number(n))
    if (!y || !m) throw new BizException(ErrorCode.PARAM_ERROR, '账期格式错误，应为 YYYY-MM')
    const start = new Date(y, m - 1, 1)
    const end = new Date(y, m, 1) // 下月 1 号

    const orders = await this.prisma.order.findMany({
      where: { purchaserId: purchaser.id, deliveryDate: { gte: start, lt: end } },
      orderBy: { deliveryDate: 'asc' },
      include: { _count: { select: { items: true } } },
    })

    const grossAmount = orders.reduce(
      (s, o) => s + (o.amountFinal ? Number(o.amountFinal) : 0),
      0,
    )
    const round = (n: number) => Math.round(n * 100) / 100

    return {
      period,
      orderCount: orders.length,
      grossAmount: round(grossAmount),
      paidAmount: 0, // 账期/COD 已付金额，MVP 先占位 0
      unpaidAmount: round(grossAmount),
      orders: orders.map((o) => ({
        orderId: Number(o.id),
        deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
        itemCount: o._count.items,
        amountFinal: o.amountFinal ? Number(o.amountFinal) : null,
        status: o.status,
        statusText: this.orderStatusText(o.status),
      })),
    }
  }

  // ────────────────────────────────────────
  // 售后申请（创建工单，决策3）
  // ────────────────────────────────────────
  async submitAftersale(userId: bigint, dto: AftersaleDto) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    // 校验订单属于该采购方
    const order = await this.prisma.order.findUnique({ where: { id: BigInt(dto.orderId) } })
    if (!order || order.purchaserId !== purchaser.id) {
      throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    }

    const aftersale = await this.prisma.aftersaleOrder.create({
      data: {
        orderId: BigInt(dto.orderId),
        orderItemId: dto.orderItemId ? BigInt(dto.orderItemId) : BigInt(0),
        type: dto.type,
        reason: dto.reason,
        qtyDiff: dto.qtyDiff ?? 0,
        amountDiff: dto.amountDiff ?? 0,
        status: 0,
      },
    })

    return { aftersaleId: Number(aftersale.id), status: 'pending' }
  }

  private orderStatusText(status: number): string {
    const map: Record<number, string> = {
      [OrderStatus.PENDING_CONFIRM]: '待确认',
      [OrderStatus.SPLITTED]: '已拆单',
      [OrderStatus.STOCKING]: '备货中',
      [OrderStatus.WAIT_DELIVERY]: '待配送',
      [OrderStatus.ASSIGNED]: '已派单',
      [OrderStatus.DELIVERING]: '配送中',
      [OrderStatus.DELIVERED]: '已送达',
      [OrderStatus.COMPLETED]: '已完成',
      [OrderStatus.SETTLED]: '已结算',
      [OrderStatus.CANCELLED]: '已取消',
    }
    return map[status] ?? '未知'
  }
}
