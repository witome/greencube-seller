import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { BizException, ErrorCode, AccountStatus, OrderStatus } from '../../common/constants/error-codes'
import { RegisterDto } from './dto/register.dto'
import { AppealDto } from './dto/appeal.dto'
import { AftersaleDto } from './dto/aftersale.dto'
import { UpdateBuyerProfileDto } from './dto/update-profile.dto'

@Injectable()
export class BuyerService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

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

    // ④ 手机号唯一前置校验（2026-09-12 #24：必须在建任何记录之前拦下，撞号不留半成品；修法同 #22 模式）
    // user.phone 唯一约束，仅排除本人（本人 user.phone 本就等于该号时不算撞）
    if (dto.phone) {
      const phoneOwner = await this.prisma.user.findFirst({ where: { phone: dto.phone, NOT: { id: userId } } })
      if (phoneOwner) throw new BizException(ErrorCode.PHONE_ALREADY_USED, '该手机号已被其他账号使用')
    }

    // 事务：purchaser 主表 + user 手机号同步要么都成、要么整体回滚（杜绝主表已建、user 未更新的半成品）
    const purchaser = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaser.create({
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
      await tx.user.update({
        where: { id: userId },
        data: { phone: dto.phone },
      })

      return created
    })

    return {
      purchaserId: Number(purchaser.id),
      accountStatus: purchaser.accountStatus,
      estimatedHours: 24,
    }
  }

  // ────────────────────────────────────────
  // 采购方自助资料（2026-09-11 任务卡 A，大辉拍板）
  // 只按 token 里的 userId 取自己的 purchaser 记录，绝不接受 targetId
  // 可自助改：shopName / contact / phone / address / deliveryWindows
  // 不可自助改：businessLicenseNo / 资质图片 / 账号状态（准入材料，必须运营审核）
  // 审计：action=BUYER_SELF_UPDATE（与运营侧 UPDATE_BUYER 区分自助/运营改）
  // ────────────────────────────────────────
  async getSelfProfile(userId: bigint) {
    const p = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!p) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')
    return {
      purchaserId: Number(p.id),
      shopName: p.shopName,
      contact: p.contact,
      phone: p.phone,
      address: p.address,
      deliveryWindows: p.deliveryWindows,
      businessLicenseNo: p.businessLicenseNo,
      licenseImg: p.businessLicenseImg,
      permitImg: p.foodPermitImg,
      accountStatus: p.accountStatus,
    }
  }

  async updateSelfProfile(userId: bigint, dto: UpdateBuyerProfileDto) {
    const p = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!p) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    const data: any = {}
    if (dto.shopName !== undefined) data.shopName = dto.shopName
    if (dto.contact !== undefined) data.contact = dto.contact
    if (dto.phone !== undefined) data.phone = dto.phone
    if (dto.address !== undefined) data.address = dto.address
    if (dto.deliveryWindows !== undefined) data.deliveryWindows = dto.deliveryWindows
    if (Object.keys(data).length === 0) {
      throw new BizException(ErrorCode.PARAM_ERROR, '没有可更新的字段')
    }

    // 手机号唯一前置校验（2026-09-12 补，与供应商自助接口同款修复）：
    // user.phone 唯一约束，撞号原会抛 P2002→裸 5001 且 purchaser/user 半更新。仅非空 phone 参与校验（null=清空）
    if (dto.phone) {
      const phoneOwner = await this.prisma.user.findFirst({ where: { phone: dto.phone, NOT: { id: p.userId } } })
      if (phoneOwner) throw new BizException(ErrorCode.PHONE_ALREADY_USED, '该手机号已被其他账号使用')
    }

    // 变更前后值（仅记录实际变更的字段）
    const before: any = {}
    for (const k of Object.keys(data)) before[k] = p[k]

    // 事务：purchaser 更新 + user 手机号同步要么都成、要么都不成（杜绝半更新）
    await this.prisma.$transaction([
      this.prisma.purchaser.update({ where: { id: p.id }, data }),
      ...(dto.phone !== undefined ? [this.prisma.user.update({ where: { id: p.userId }, data: { phone: dto.phone } })] : []),
    ])

    await this.audit.log({
      operatorId: userId,
      action: 'BUYER_SELF_UPDATE',
      entity: 'purchaser',
      entityId: p.id,
      before,
      after: data,
    })
    return { purchaserId: Number(p.id), updated: true }
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
  // 决策 6（2026-09-19 大辉拍板）：申诉正文与附件**必须入库**。
  // 原实现只改状态 + 计数，把 dto.text / dto.attachments 丢掉并返回假 id 0，
  // 运营看不到申诉内容 —— 现落 appeal_record 一条一行，返回真实 id。
  // ────────────────────────────────────────
  async appeal(userId: bigint, dto: AppealDto) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    if (purchaser.accountStatus !== AccountStatus.REJECTED) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '当前状态不可申诉')
    }
    if (purchaser.appealCount30d >= 1) throw new BizException(ErrorCode.APPEAL_LIMIT)

    // 事务：申诉记录落库 + 状态改回待审核 + 30 天计数 +1，要么都成、要么都不成
    const appeal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.appealRecord.create({
        data: {
          purchaserId: purchaser.id,
          userId,
          text: dto.text,
          // 附件可选：小程序端当前不传（附件入口已按上一张卡移除），为「拍照留证」卡预留
          attachments: dto.attachments ?? undefined,
          // 提交时刻的驳回原因快照（取自被驳回时的落库值，供运营对照申诉内容判断）
          reasonCode: purchaser.rejectReasonCode ?? null,
          rejectReason: purchaser.rejectReasonText ?? null,
          status: 0,
        },
      })

      await tx.purchaser.update({
        where: { id: purchaser.id },
        data: {
          accountStatus: AccountStatus.PENDING,
          appealCount30d: { increment: 1 },
        },
      })

      return created
    })

    // 铁律 3：申诉受理＝准入状态变更（驳回→待审核），写审计（action 全大写，勿新增小写）
    await this.audit.log({
      operatorId: userId,
      action: 'BUYER_APPEAL_SUBMIT',
      entity: 'purchaser',
      entityId: purchaser.id,
      before: {
        accountStatus: purchaser.accountStatus,
        appealCount30d: purchaser.appealCount30d,
      },
      after: {
        accountStatus: AccountStatus.PENDING,
        appealId: Number(appeal.id),
        textLength: (dto.text ?? '').length,
        attachmentCount: (dto.attachments ?? []).length,
      },
    })

    return { appealId: Number(appeal.id), accountStatus: AccountStatus.PENDING }
  }

  // ────────────────────────────────────────
  // 我的申诉记录（决策 6 · 采购方只能看自己的）
  // 只按 token 的 userId 取自己的 purchaser，再按 purchaserId 过滤；
  // 代码里没有任何 targetId/purchaserId 入参，杜绝越权读别人的申诉
  // ────────────────────────────────────────
  async myAppeals(userId: bigint) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    const rows = await this.prisma.appealRecord.findMany({
      where: { purchaserId: purchaser.id },
      orderBy: { createdAt: 'desc' },
    })

    return rows.map((r) => ({
      appealId: Number(r.id),
      text: r.text,
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      reasonCode: r.reasonCode != null ? Number(r.reasonCode) : null,
      rejectReason: r.rejectReason,
      status: r.status,
      statusText: r.status === 1 ? '已处理' : '待处理',
      createdAt: r.createdAt.toISOString(),
      handledAt: r.handledAt ? r.handledAt.toISOString() : null,
    }))
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
  // 首页内容（2026-09-11 任务卡：首页三处接口化，一次请求返回三项）
  // 数据源 = platform_config 三个 key（运营侧 admin/finance/home-content 维护）
  //   横幅：未配置 → 中性默认文案；公告：enabled=false 或空 → null（前台不渲染）
  //   推荐位：id 有序数组 → 按顺序取在售商品，缺失/下架/非法 id 一律跳过；空 → 前台空态
  // ────────────────────────────────────────
  async getHomeContent() {
    const keys = await this.prisma.platformConfig.findMany({
      where: { key: { in: ['home_delivery_note', 'home_notice', 'home_recommendations'] } },
    })
    const map = new Map(keys.map((k) => [k.key, k.value as any]))

    const note = map.get('home_delivery_note') || {}
    const deliveryNote = {
      title: typeof note.title === 'string' && note.title ? note.title : '下单时选择配送日期，按日送达',
      subtitle: typeof note.subtitle === 'string' && note.subtitle ? note.subtitle : '鲜货直供菜市场 · 缺货自动按偏好处理',
    }

    const noticeCfg = map.get('home_notice') || {}
    const notice = noticeCfg.enabled && typeof noticeCfg.text === 'string' && noticeCfg.text.trim() ? noticeCfg.text.trim() : null

    const rawIds = map.get('home_recommendations')
    const ids = (Array.isArray(rawIds) ? rawIds : [])
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0)
    // 保持运营配置的展示顺序；非法/已下架 id 直接跳过，绝不返回假数据
    const products = ids.length
      ? await this.prisma.product.findMany({ where: { id: { in: ids.map((n) => BigInt(n)) }, status: 1 } })
      : []
    const byId = new Map(products.map((p) => [Number(p.id), p]))
    const recommendations = ids
      .filter((n) => byId.has(n))
      .map((n) => {
        const p = byId.get(n)
        return {
          id: Number(p.id),
          name: p.name,
          cover: p.cover,
          unit: p.unit,
          weighType: p.weighType,
          specText: p.specText,
          salePrice: Number(p.salePrice),
        }
      })

    return { deliveryNote, notice, recommendations }
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

    const attachments = dto.attachments ?? []
    const aftersale = await this.prisma.aftersaleOrder.create({
      data: {
        orderId: BigInt(dto.orderId),
        orderItemId: dto.orderItemId ? BigInt(dto.orderItemId) : BigInt(0),
        type: dto.type,
        reason: dto.reason,
        qtyDiff: dto.qtyDiff ?? 0,
        amountDiff: dto.amountDiff ?? 0,
        status: 0,
        // 决策⑦（2026-09-19）：售后拍照留证。存 URL 数组；不传即 NULL（可空，兼容拒绝收自动生成的工单）
        attachments: attachments.length ? attachments : undefined,
      },
    })

    // 铁律 3：售后申请是定责/补偿的起点（含照片证据），写审计
    // action 全大写（全仓仅 courier_report 一个小写残留，不新增小写）
    await this.audit.log({
      operatorId: userId,
      action: 'AFTERSALE_SUBMIT',
      entity: 'aftersale',
      entityId: aftersale.id,
      before: null,
      after: {
        orderId: Number(dto.orderId),
        type: dto.type,
        reason: dto.reason ?? null,
        qtyDiff: dto.qtyDiff ?? 0,
        amountDiff: dto.amountDiff ?? 0,
        attachmentCount: attachments.length,
        attachments,
      },
    })

    return { aftersaleId: Number(aftersale.id), status: 'pending' }
  }

  /// 我的售后工单（含运营处理状态，2026-09-10 补，修复单缺陷 3）
  async myAftersales(userId: bigint) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    const myOrders = await this.prisma.order.findMany({
      where: { purchaserId: purchaser.id },
      select: { id: true, items: { include: { product: true } } },
    })
    const myOrderIds = myOrders.map((o) => o.id)
    if (myOrderIds.length === 0) return []

    const rows = await this.prisma.aftersaleOrder.findMany({
      where: { orderId: { in: myOrderIds } },
      orderBy: { createdAt: 'desc' },
    })
    const itemMap = new Map<bigint, string>()
    for (const o of myOrders) {
      for (const it of o.items) itemMap.set(it.id, it.product?.name ?? '')
    }

    const statusText: Record<number, string> = { 0: '待处理', 1: '处理中', 2: '已解决', 3: '已关闭' }
    return rows.map((r) => ({
      aftersaleId: Number(r.id),
      orderId: Number(r.orderId),
      orderItemId: Number(r.orderItemId),
      type: r.type,
      reason: r.reason,
      // 售后照片（2026-09-19 卡I）：申请时上传的 URL 数组，供采购方在「我的售后」回看。
      // 与 myAppeals() 同口径：null / 非数组一律归一成 []，前端据此判断是否渲染照片区。
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      qtyDiff: Number(r.qtyDiff),
      amountDiff: Number(r.amountDiff),
      status: r.status,
      statusText: statusText[r.status] ?? '未知',
      compensateAmount: r.compensateAmount != null ? Number(r.compensateAmount) : null,
      compensateMethod: r.compensateMethod ?? null,
      handleRemark: r.handleRemark,
      handledAt: r.handledAt ? r.handledAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      itemName: r.orderItemId ? itemMap.get(r.orderItemId) ?? null : null,
    }))
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
