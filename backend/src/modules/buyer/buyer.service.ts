import { Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { BizException, ErrorCode, AccountStatus, OrderStatus } from '../../common/constants/error-codes'
import { RegisterDto } from './dto/register.dto'
import { AppealDto } from './dto/appeal.dto'
import { AftersaleDto } from './dto/aftersale.dto'
import { UpdateBuyerProfileDto } from './dto/update-profile.dto'
import { CancelAccountDto } from './dto/cancel-account.dto'
import { payStatusOf, hasPayProof, hasWechatPaidRecord } from '../../common/utils/pay-status.util'
import { AFTERSALE_STATUS, resolveAftersaleSuppliers, AFTERSALE_UNASSIGNED_TEXT } from '../../common/utils/aftersale.util'

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

    // ①b 收货地址维度（卡BL 2026-10-02）：同一收货地址 30 天内最多 3 个联系人 —— 把注册页文案落到后端。
    // 归一化口径：去掉**首尾与中间所有空白**（半角空格/制表符/换行 + 全角空格 U+3000）后比对，
    //   防「验收路 2 号」vs「验收路2号」绕过；**不做**门牌号/同义词归一（「1 号」与「一号」仍是两个地址）。
    // 窗口口径：registeredAt >= now-30d（与①手机号校验同源，UTC 口径）。
    // 计数口径：窗口内该地址**不同 phone 的条数**（Set 去重；不限 account_status —— 已驳回/停用/已注销的
    //   注册行为本身也要拦；address 为空的行不参与，天然排除注销匿名化后 address='' 的历史行）。
    // 判据：已存在 ≥3 个不同手机号 → 第 4 个拒绝（「最多 3 个联系人」）。
    // 代价：purchaser.address 无索引，本查询全表扫（现 792 行，毫秒级）；上万行再考虑归一化列 + 索引（本卡不加）。
    // 只拦新注册：不改任何既有采购方数据；运营后台改地址、采购方自助改地址均不受此校验约束。
    if (dto.address) {
      const normAddr = (s: string) => s.replace(/[\s\u3000]/g, '')
      const target = normAddr(dto.address)
      const recent = await this.prisma.purchaser.findMany({
        where: { registeredAt: { gte: thirtyDaysAgo } },
        select: { address: true, phone: true },
      })
      const sameAddrPhones = new Set(
        recent
          .filter((p) => p.address && normAddr(p.address) === target && p.phone)
          .map((p) => p.phone),
      )
      if (sameAddrPhones.size >= 3) throw new BizException(ErrorCode.ADDRESS_CONTACT_TOO_MANY)
    }

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
  // 卡AA（2026-09-30）：今日特价价格按审核状态脱敏 —— 只有 purchaser 存在且
  //   accountStatus=2 才返回真实 salePrice（priceVisible=true），否则 salePrice=null。
  //   与 product.service 同一口径（各自 service 内小私有函数，口径文字对齐）。
  // ────────────────────────────────────────
  private async priceVisibleFor(userId: bigint): Promise<boolean> {
    const p = await this.prisma.purchaser.findUnique({
      where: { userId },
      select: { accountStatus: true },
    })
    return !!p && p.accountStatus === AccountStatus.ACTIVE
  }

  async getHomeContent(userId: bigint) {
    const [keys, priceVisible] = await Promise.all([
      this.prisma.platformConfig.findMany({
        where: { key: { in: ['home_delivery_note', 'home_notice', 'home_recommendations', 'home_banner_images', 'home_features', 'service_hotline'] } },
      }),
      this.priceVisibleFor(userId),
    ])
    const map = new Map(keys.map((k) => [k.key, k.value as any]))

    const note = map.get('home_delivery_note') || {}
    const deliveryNote = {
      title: typeof note.title === 'string' && note.title ? note.title : '下单时选择配送日期，按日送达',
      subtitle: typeof note.subtitle === 'string' && note.subtitle ? note.subtitle : '鲜货直供菜市场 · 缺货自动按偏好处理',
    }

    const noticeCfg = map.get('home_notice') || {}
    const notice = noticeCfg.enabled && typeof noticeCfg.text === 'string' && noticeCfg.text.trim() ? noticeCfg.text.trim() : null

    // 卡BA-2：横幅滚动图（enabled 且 ≥1 张才下发；否则 null → 前台回退文字横幅）
    const bannerCfg = map.get('home_banner_images') || {}
    const bannerImages =
      bannerCfg.enabled && Array.isArray(bannerCfg.images) && bannerCfg.images.some((u: unknown) => typeof u === 'string' && u)
        ? { images: bannerCfg.images.filter((u: unknown) => typeof u === 'string' && u) }
        : null

    // 卡BA-2：常用功能宫格（null/空 → 前端用内置默认 8 宫格，与现状一致）
    const featsRaw = map.get('home_features')
    const features = Array.isArray(featsRaw)
      ? featsRaw.filter(
          (f: any) => f && typeof f === 'object' && typeof f.key === 'string' && typeof f.label === 'string' && typeof f.page === 'string',
        )
      : null

    // 卡BA-2：客服电话（空 → null，首页不显示客服入口）
    const hotlineRaw = map.get('service_hotline')
    const serviceHotline = typeof hotlineRaw === 'string' && hotlineRaw.trim() ? hotlineRaw.trim() : null

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
          // 卡AA：未激活账号价格服务端抹除
          salePrice: priceVisible ? Number(p.salePrice) : null,
          priceVisible,
        }
      })

    return { deliveryNote, notice, recommendations, priceVisible, bannerImages, features, serviceHotline }
  }

  // ────────────────────────────────────────
  // 卡AC（2026-09-30）：采购方自助注销账号
  // ────────────────────────────────────────
  // 两条硬门槛，**两项都得清空**才可注销（缺一不可）：
  //   ① 进行中订单：status ∈ {10,20,30,40,45,50}
  //   ② 未结清账款：已进入应收（status ∈ {60,70,90}）且**支付状态仍为未付/待收款**的订单
  //
  // ⚠️ 支付状态一律复用 common/utils/pay-status.util.ts 的既有四档判定，这里**绝不写第二份**
  //    （本项目反复出事的点）。只有 paid_wechat / paid_proof 算「已付」，
  //    cod_pending（货到付款已送达未收）必须**算未结清**——钱还没到手就注销，账就烂了。
  // ⚠️ 不许拿 bill() 当判据：那是占位实现（paidAmount 恒 0），会把买过东西的采购方全部拦住。
  //
  // 注销本体在一个事务内全部完成（详见 cancelAccount 内注释）。

  /// ① 进行中（未完结）的订单状态：这类订单还没走完，不允许注销
  private static readonly ONGOING_ORDER_STATUS = [
    OrderStatus.PENDING_CONFIRM, // 10 待确认
    OrderStatus.SPLITTED,        // 20 已拆单
    OrderStatus.STOCKING,        // 30 备货中
    OrderStatus.WAIT_DELIVERY,   // 40 待配送
    OrderStatus.ASSIGNED,        // 45 已派单
    OrderStatus.DELIVERING,      // 50 配送中
  ]

  /// ② 已进入应收的订单状态：送达/完成/结算（只有这三类才谈得上「账款结没结」）
  private static readonly RECEIVABLE_ORDER_STATUS = [
    OrderStatus.DELIVERED, // 60 已送达
    OrderStatus.COMPLETED, // 70 已完成
    OrderStatus.SETTLED,   // 90 已结算
  ]

  /// 匿名化后的店名（purchaser.shop_name 非空，故用占位串而不是 null）
  private static readonly CANCELLED_SHOP_NAME = '已注销账号'

  /// 应收金额口径：已验收定稿的看 amountFinal（已扣拒收）；尚未定稿的看下单应付额
  /// (amountOrdered + deliveryFee，与支付单额度同一口径)。不另造算法。
  private receivableAmount(o: { amountFinal?: any; amountOrdered: any; deliveryFee: any }): number {
    if (o.amountFinal != null) return Number(o.amountFinal)
    return Number(o.amountOrdered) + Number(o.deliveryFee)
  }

  /// 未结清账款明细（唯一实现：eligibility 与 cancel 都走它，两处口径不可能分叉）
  private async collectBlockers(purchaserId: bigint) {
    const blockers: Array<{ type: 'orders' | 'bill'; count: number; amount: number | null; label: string }> = []

    const ongoingCount = await this.prisma.order.count({
      where: { purchaserId, status: { in: BuyerService.ONGOING_ORDER_STATUS } },
    })
    if (ongoingCount > 0) {
      blockers.push({
        type: 'orders',
        count: ongoingCount,
        amount: null,
        label: `你还有 ${ongoingCount} 个进行中的订单`,
      })
    }

    const receivable = await this.prisma.order.findMany({
      where: { purchaserId, status: { in: BuyerService.RECEIVABLE_ORDER_STATUS } },
      select: {
        status: true,
        payMethod: true,
        payProof: true,
        amountOrdered: true,
        amountFinal: true,
        deliveryFee: true,
        payments: { select: { channel: true, status: true } },
      },
    })
    const unpaid = receivable.filter((o) => {
      const code = payStatusOf({
        payMethod: o.payMethod,
        status: o.status,
        onlinePaid: hasWechatPaidRecord(o.payments),
        hasProof: hasPayProof(o.payProof),
      }).code
      return code === 'unpaid' || code === 'cod_pending'
    })
    if (unpaid.length > 0) {
      const amount = Math.round(unpaid.reduce((s, o) => s + this.receivableAmount(o), 0) * 100) / 100
      blockers.push({
        type: 'bill',
        count: unpaid.length,
        amount,
        label: `你还有未结清账款 ¥${amount.toFixed(2)}`,
      })
    }

    return blockers
  }

  /// GET /buyer/account/cancel-eligibility —— 能不能注销、卡在哪儿
  async cancelEligibility(userId: bigint) {
    const purchaser = await this.prisma.purchaser.findUnique({
      where: { userId },
      select: { id: true, accountStatus: true },
    })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    const blockers = await this.collectBlockers(purchaser.id)
    return { canCancel: blockers.length === 0, blockers }
  }

  /// POST /buyer/account/cancel —— 注销（只作用于**采购方身份**）
  async cancelAccount(userId: bigint, dto: CancelAccountDto) {
    // 必须显式 confirm：缺了 / false / 传字符串一律参数错（前端二次确认之外的服务端兜底）
    if (dto.confirm !== true) {
      throw new BizException(ErrorCode.PARAM_ERROR, '请先确认注销后果（confirm 必须为 true）')
    }

    const purchaser = await this.prisma.purchaser.findUnique({
      where: { userId },
      select: { id: true, userId: true, accountStatus: true },
    })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')
    if (purchaser.accountStatus === AccountStatus.CANCELLED) {
      throw new BizException(ErrorCode.PARAM_ERROR, '该账号已注销')
    }

    // 服务端独立再判一次门槛：不信任前端传的任何状态（页面可能停在旧数据上）
    const blockers = await this.collectBlockers(purchaser.id)
    if (blockers.length > 0) {
      throw new BizException(
        ErrorCode.ORDER_STATUS_INVALID,
        '注销前请先处理完：' + blockers.map((b) => b.label).join('；'),
      )
    }

    const oldUserId = purchaser.userId
    const cancelledAt = new Date()

    await this.prisma.$transaction(async (tx) => {
      // ① 回收站用户：接管旧 purchaser 行的 userId（不可猜的 wx_openid、无身份、禁用态）。
      //    存在的意义：让「原微信用户」从此**没有** purchaser 档案 → 可重新注册成全新账号；
      //    历史订单仍挂在旧 purchaser 行上（对账/税务完整），但不再关联本人 ——
      //    这就是原型「历史订单与账单依规保留，但不再关联本人」的实现方式。
      //    ⚠️ 因此必须保住 Purchaser.userId 的 @unique（全仓 33 处 findUnique({ userId })）：
      //       解绑而不是去约束，正是为了不碰那 33 处。
      const trash = await tx.user.create({
        data: {
          wxOpenid: 'cancelled_' + randomBytes(16).toString('hex'),
          name: '已注销',
          roles: [],
          status: 0,
        },
      })

      // ② 清空该采购方的购物车（cart_item 挂在 user 上，按原 userId 清）
      await tx.cartItem.deleteMany({ where: { userId: oldUserId } })

      // ③ 本人 user 行的 PII 脱敏（手机号置 null 同时释放 user.phone 唯一约束，便于将来重注册）
      await tx.user.update({ where: { id: oldUserId }, data: { name: null, phone: null } })

      // ④ purchaser PII 匿名化 + 状态 6 + 解绑到回收站用户（最后一步：改完即与原微信再无关联）
      await tx.purchaser.update({
        where: { id: purchaser.id },
        data: {
          shopName: BuyerService.CANCELLED_SHOP_NAME,
          contact: '',
          phone: '',
          address: '',
          qualification: null,
          businessLicenseNo: null,
          businessLicenseImg: null,
          foodPermitImg: null,
          deliveryWindows: null,
          accountStatus: AccountStatus.CANCELLED,
          userId: trash.id,
        },
      })

      // ⑤ 审计（随事务提交/回滚）。
      //    ⚠️ 只记状态跃迁与「已匿名化」摘要：绝不能出现姓名 / 电话 / 执照号 / 地址。
      await this.audit.log(
        {
          operatorId: userId,
          action: 'BUYER_ACCOUNT_CANCEL',
          entity: 'purchaser',
          entityId: purchaser.id,
          before: { accountStatus: purchaser.accountStatus },
          after: { accountStatus: AccountStatus.CANCELLED, anonymized: true, cancelledAt: cancelledAt.toISOString() },
        },
        tx,
      )
    })

    return { cancelled: true }
  }

  // ────────────────────────────────────────
  // 售后申请（创建工单，决策3；卡AE 2026-09-30 加三道门槛 + 改落库口径）
  // ────────────────────────────────────────
  // 卡AE 口径（大辉 2026-09-30 拍板，照做别发挥）：
  //   ① 只能是「已送达 / 已完成 / 已结算」的订单 —— 发货前的单不存在售后
  //   ② 签收后 **24 小时内**（起算点 = delivery_task.completed_at = 订单接口的 deliveredAt）
  //      ⚠️ 页面那句「签收后 24 小时内可申请」原先**只是文案、后端零校验**，本卡把门槛真加上
  //   ③ **必须选到具体商品**（orderItemId 必须属于本订单）
  //   ④ 品质问题（type=2）**必须传照片**
  //   ⑤ 防重复：同一 orderItemId + 同一 type 只允许一张**未闭环**工单（status ∈ {0,1}）
  //
  // ⚠️ 落库口径：
  //   · orderId **从明细反查**（不信前端传的订单号）
  //   · qtyDiff = 客户填报的「涉及数量」，上限 = 该明细的 qtyReceived（为空时用 qtyAccepted）
  //     —— 本卡的假定：不新增字段，就用既有的 qtyDiff 承载客户填报数
  //   · amountDiff = qtyDiff × orderItem.salePrice（成交价快照），**只作参考记录、不参与任何计算**
  //   · 全程**不改订单、不动钱**（红线 1/2）
  private static readonly AFTERSALE_WINDOW_MS = 24 * 3600 * 1000

  /// 允许提售后的订单状态（口径 ①）
  private static readonly AFTERSALE_ALLOWED_ORDER_STATUS = [
    OrderStatus.DELIVERED, // 60 已送达
    OrderStatus.COMPLETED, // 70 已完成
    OrderStatus.SETTLED,   // 90 已结算
  ]

  /// 未闭环的售后状态（口径 ⑤：这两档算「还在这条线上」，不允许同明细同类型再提一张）
  private static readonly AFTERSALE_OPEN_STATUS = [
    AFTERSALE_STATUS.PENDING,    // 0 待处理
    AFTERSALE_STATUS.PROCESSING, // 1 处理中（本期无写入点，判定仍按口径保留）
  ]

  /// 交付确认时间（= 订单接口的 deliveredAt）：取本单配送任务的完成时间。
  /// 任务与订单通过 stationList（JSON 数组）里的 orderId 关联 —— 与 order.service.detail 同一口径、同一查询。
  private async deliveredAtOf(orderId: bigint): Promise<Date | null> {
    const task = await this.prisma.deliveryTask.findFirst({
      where: {
        completedAt: { not: null },
        stationList: { array_contains: { orderId: Number(orderId) } },
      },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    })
    return task?.completedAt ?? null
  }

  async submitAftersale(userId: bigint, dto: AftersaleDto) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    // ① 商品必选：orderItemId 由 DTO 强制（缺了直接 1001），这里再校验它**属于本采购方的某张订单**
    const item = await this.prisma.orderItem.findFirst({
      where: { id: BigInt(dto.orderItemId) },
      include: { order: true },
    })
    if (!item || !item.order || item.order.purchaserId !== purchaser.id) {
      throw new BizException(ErrorCode.PARAM_ERROR, '请选择订单中的具体商品')
    }
    // orderId **只用来交叉校验**（传了就必须和明细所属订单一致），
    // 业务上真正的订单号一律**从明细反查** —— 绝不信前端传的订单号（卡AE 落库口径）
    if (dto.orderId !== undefined && dto.orderId !== null && BigInt(dto.orderId) !== item.orderId) {
      throw new BizException(ErrorCode.PARAM_ERROR, '该商品不属于该订单，请重新选择')
    }
    const order = item.order

    // ② 订单状态：只有送达之后的单才谈得上售后
    if (!BuyerService.AFTERSALE_ALLOWED_ORDER_STATUS.includes(order.status as any)) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '订单还没送达，送达后才能申请售后')
    }

    // ③ 签收后 24 小时：起算点 = 交付确认时间；取不到（没交付过）也拒
    const deliveredAt = await this.deliveredAtOf(order.id)
    if (!deliveredAt) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '订单还没有交付确认时间，暂不能申请售后')
    }
    if (Date.now() - deliveredAt.getTime() > BuyerService.AFTERSALE_WINDOW_MS) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '已超过签收后 24 小时，请联系运营处理')
    }

    // ④ 品质问题必须传照片（前端也拦一道，后端必须真校验）
    const attachments = dto.attachments ?? []
    if (dto.type === 2 && attachments.length === 0) {
      throw new BizException(ErrorCode.PARAM_ERROR, '品质问题必须上传照片')
    }

    // ⑤ 涉及数量：客户填报数，上限 = 收货数量（为空时用验收数量）
    const cap = item.qtyReceived != null ? Number(item.qtyReceived) : item.qtyAccepted != null ? Number(item.qtyAccepted) : 0
    const qtyDiff = Number(dto.qtyDiff)
    if (!Number.isFinite(qtyDiff) || qtyDiff <= 0) {
      throw new BizException(ErrorCode.PARAM_ERROR, '请填写涉及数量')
    }
    if (qtyDiff > cap) {
      throw new BizException(ErrorCode.PARAM_ERROR, `涉及数量不能超过本次收货数量（最多 ${cap}）`)
    }

    // ⑥ 防重复：同明细 + 同类型 只允许一张未闭环工单（不同类型可以各提一张）
    const dup = await this.prisma.aftersaleOrder.findFirst({
      where: {
        orderItemId: item.id,
        type: dto.type,
        status: { in: [...BuyerService.AFTERSALE_OPEN_STATUS] },
      },
      select: { id: true },
    })
    if (dup) {
      throw new BizException(ErrorCode.PARAM_ERROR, '该商品已提交过同类售后，运营正在处理中')
    }

    // amountDiff 只作参考记录（qtyDiff × 成交价快照），不参与任何计算
    const amountDiff = Math.round(qtyDiff * Number(item.salePrice) * 100) / 100
    const aftersale = await this.prisma.aftersaleOrder.create({
      data: {
        orderId: order.id,
        orderItemId: item.id,
        type: dto.type,
        reason: dto.reason,
        qtyDiff,
        amountDiff,
        status: AFTERSALE_STATUS.PENDING,
        // 决策⑦（2026-09-19）：售后拍照留证。存 URL 数组；不传即 NULL
        attachments: attachments.length ? attachments : undefined,
      },
    })

    // 铁律 3：售后申请是定责/补偿的起点（含照片证据），写审计
    // action 一律 UPPER_SNAKE（2026-09-21 卡Q 起，全仓唯一的小写 action 已统一为 COURIER_REPORT）
    await this.audit.log({
      operatorId: userId,
      action: 'AFTERSALE_SUBMIT',
      entity: 'aftersale',
      entityId: aftersale.id,
      before: null,
      after: {
        orderId: Number(order.id),
        orderItemId: Number(item.id),
        type: dto.type,
        reason: dto.reason ?? null,
        qtyDiff,
        amountDiff,
        attachmentCount: attachments.length,
        attachments,
      },
    })

    return { aftersaleId: Number(aftersale.id), status: 'pending' }
  }

  // ────────────────────────────────────────
  // 采购方声明「我已付款」（货到付款订单 · 送达后）
  // 2026-09-19 卡L：原实现里采购方订单详情的支付卡片只在「待确认(10)+未选支付方式(0)」时出现，
  // 一旦选了货到付款并送达，采购方那侧就再没有任何付款入口。
  //
  // ⚠️ 本接口只记录「客户称已付」（order.buyer_paid_claim_at），**不是核销**：
  //    是否真收到钱仍以 order.pay_proof（配送员上传的收款凭证）为准 —— 二者分开显示。
  //    故这里**不写 payProof**、**不推进订单状态**，配送员既有 COD 收款流程一行未动。
  //
  // ⚠️ 卡S2（2026-09-29）起**采购方侧已停用**：新前端不再调用（「我已付款」按钮已下线，
  //    「已付款」只认线上到账/配送员凭证，判定唯一实现在 common/utils/pay-status.util.ts）。
  //    接口保留只为兼容老版本小程序包（删接口会让老包报错），新版发布后再清理（后续欠账）。
  //    该字段的唯一残留用途 = 对账页「曾称已付（历史口径）」只读标注，不参与实收/未收金额计算。
  //
  // 约束：仅本人订单；仅 payMethod=2（货到付款）；仅 已送达(60)/已完成(70)；
  //       重复声明幂等（返回既有时间，不报错、不重复写审计）。
  // ────────────────────────────────────────
  async claimPaid(userId: bigint, orderId: number) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser) throw new BizException(ErrorCode.NOT_FOUND, '未找到采购方档案')

    // 归属过滤写进 where：别人的订单直接 4001，不泄露「该订单存在但不属于你」
    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(orderId), purchaserId: purchaser.id },
      select: { id: true, status: true, payMethod: true, buyerPaidClaimAt: true },
    })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')

    if (order.payMethod !== 2) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '该订单不是货到付款，无需此操作')
    }
    const claimable: number[] = [OrderStatus.DELIVERED, OrderStatus.COMPLETED]
    if (!claimable.includes(order.status)) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '订单送达后才能声明已付款')
    }

    // 幂等：已声明过就直接返回既有时间（不报错、不刷新时间、不再写审计）
    if (order.buyerPaidClaimAt) {
      return {
        orderId: Number(order.id),
        buyerPaidClaimAt: order.buyerPaidClaimAt.toISOString(),
        alreadyClaimed: true,
      }
    }

    const now = new Date()
    // 条件更新（buyer_paid_claim_at IS NULL）防并发双写：两个并发声明只有一个真正写入
    // （与卡J 同思路：把「判存在 + 写」压成一步，不靠先查后写）
    const updated = await this.prisma.order.updateMany({
      where: { id: order.id, buyerPaidClaimAt: null },
      data: { buyerPaidClaimAt: now },
    })

    // 审计：只在真正写入时记一条（action 全大写，与全仓约定一致）
    if (updated.count > 0) {
      await this.audit.log({
        operatorId: userId,
        action: 'BUYER_CLAIM_PAID',
        entity: 'order',
        entityId: Number(order.id),
        before: { buyerPaidClaimAt: null },
        after: { buyerPaidClaimAt: now.toISOString(), payMethod: 2, status: order.status },
      })
    }

    const fresh = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { buyerPaidClaimAt: true },
    })
    return {
      orderId: Number(order.id),
      buyerPaidClaimAt: fresh?.buyerPaidClaimAt ? fresh.buyerPaidClaimAt.toISOString() : now.toISOString(),
      alreadyClaimed: updated.count === 0,
    }
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

    // 卡AE：供应商归属（不落字段，查询时推导）—— 走全仓唯一实现，与后台列表/供应商端同一份口径
    const supplierMap = await resolveAftersaleSuppliers(this.prisma, rows.map((r) => r.orderItemId))

    const statusText: Record<number, string> = { 0: '待处理', 1: '处理中', 2: '已解决', 3: '已关闭' }
    return rows.map((r) => {
      const supplier = supplierMap.get(String(r.orderItemId))
      return {
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
        // 卡AE：归属供应商（未拆单/无明细 → null，页面显示原型里的「待分派」）
        supplierId: supplier?.supplierId ?? null,
        supplierName: supplier?.supplierName ?? null,
        supplierAssigned: supplier?.assigned ?? false,
        supplierText: supplier?.supplierName ?? AFTERSALE_UNASSIGNED_TEXT,
      }
    })
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
