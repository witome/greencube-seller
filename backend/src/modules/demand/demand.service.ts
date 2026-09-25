import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { WxService } from '../wx/wx.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { normalizeDemandKey, cleanDemandName, sanitizeRawText } from './demand.util'
import {
  DemandCreateDto,
  DemandMergeDto,
  DemandReportDto,
  DemandSubscribeDto,
  DemandUpdateDto,
} from './dto/demand.dto'

/**
 * 采购需求登记 + 到货主动通知
 *
 * ⚠️ 口径边界（务必保持）——这条线**不是**「下单后供应商缺货」那条线：
 *   本域 = 客户还没下单、商品库里压根没有这个菜（或该菜已下架）；
 *   `order_item.qty_accepted` 那套 = 已经下单了、到货不够。
 *   两条线完全独立：不共用表、不共用页面、不互相回写。
 *
 * ⚠️ 只读语义护栏（口径 2）：`/api/v1/ai/parse` **永远不写库**。
 *   上报走前端单独调本模块的 `POST /buyer/demand/report`。
 *   为什么必须这样：巡检脚本、冒烟、Hermes 复核这些**生产只读探针**都依赖
 *   「打 /ai/parse 不产生任何写」这条前提；一旦在里面插写库，只读探针就开始偷偷改生产数据。
 */

/** 0 待采购 / 1 已下单采购中 / 2 已到货 / 3 已放弃 */
export const DemandStatus = { PENDING: 0, ORDERED: 1, ARRIVED: 2, ABANDONED: 3 } as const

export const DEMAND_STATUS_TEXT: Record<number, string> = {
  0: '待采购',
  1: '已下单采购中',
  2: '已到货',
  3: '已放弃',
}

/** 1 订阅消息 / 2 客服消息 / 3 仅站内列表（没发出去，只登记原因） */
export const DemandChannel = { SUBSCRIBE: 1, CUSTOM: 2, LIST_ONLY: 3 } as const

/** 幂等窗口：同一人 + 同一需求 + **同样的话**，5 分钟内只记一条（防前端重试翻倍） */
const IDEMPOTENT_WINDOW_MS = 5 * 60 * 1000

/** 客服消息窗口：用户最近一次与小程序交互后 48 小时内可发（微信口径） */
const CUSTOM_WINDOW_MS = 48 * 60 * 60 * 1000

/**
 * 「后台代录」哨兵 purchaserId。
 * 电话/微信来的需求往往还没对应到采购方账号；这类明细计入「共几次」，
 * 但**不计入「几人在要」**（否则「人在要」会被运营自己刷高，采购判断失真）。
 */
export const ADMIN_ENTERED_PURCHASER_ID = 0

/** 订阅消息字段映射兜底（公众平台模板字段名若不同，用 .env 覆盖，页面/代码都不写死） */
const DEFAULT_TMPL_FIELDS = { thing1: '{name}', time2: '{time}', thing3: '{note}' }

@Injectable()
export class DemandService {
  private readonly logger = new Logger(DemandService.name)

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private wx: WxService,
  ) {}

  // ────────────────────────────────────────
  // 公共小工具
  // ────────────────────────────────────────

  /**
   * 到货通知模板 id —— **只从配置读**（口径 8）。
   * ⚠️ 绝不写死、绝不猜测：写死的模板 id 一旦过期/换主体，报错信息是微信那边的
   *    「template_id 不合法」，运营完全看不懂，而这里的空值能给出人话提示。
   */
  subscribeTemplateId(): string {
    return (process.env.WX_SUBSCRIBE_TMPL_DEMAND || '').trim()
  }

  templateConfigured(): boolean {
    return !!this.subscribeTemplateId()
  }

  private async purchaserOf(userId: bigint) {
    const p = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!p) throw new BizException(ErrorCode.FORBIDDEN, '请先完成采购方注册')
    return p
  }

  /** 已下架商品：归一化名 → productId（口径 1②） */
  private async offShelfMap(): Promise<Map<string, bigint>> {
    const rows = await this.prisma.product.findMany({
      where: { status: 0 },
      select: { id: true, name: true },
    })
    const m = new Map<string, bigint>()
    for (const r of rows) {
      const k = normalizeDemandKey(r.name)
      if (k && !m.has(k)) m.set(k, r.id)
    }
    return m
  }

  /**
   * 汇总计数重算（唯一实现）。
   * demandCount = 明细行数；purchaserCount = 去重客户数（**排除后台代录的哨兵 0**）。
   * firstAt / lastAt 同样从明细推导 —— 这样合并、补录、删明细之后计数不会漂。
   */
  private async recompute(demandId: bigint, tx: any = this.prisma) {
    const [demandCount, purchasers, agg] = await Promise.all([
      tx.purchaseDemandItem.count({ where: { demandId } }),
      tx.purchaseDemandItem.findMany({
        where: { demandId, purchaserId: { gt: ADMIN_ENTERED_PURCHASER_ID } },
        distinct: ['purchaserId'],
        select: { purchaserId: true },
      }),
      tx.purchaseDemandItem.aggregate({
        where: { demandId },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
    ])
    const data: any = { demandCount, purchaserCount: purchasers.length }
    if (agg._min.createdAt) data.firstAt = agg._min.createdAt
    if (agg._max.createdAt) data.lastAt = agg._max.createdAt
    await tx.purchaseDemand.update({ where: { id: demandId }, data })
    return data
  }

  private toRow(d: any) {
    return {
      id: Number(d.id),
      demandKey: d.demandKey,
      name: d.name,
      status: d.status,
      statusText: DEMAND_STATUS_TEXT[d.status] ?? '未知',
      demandCount: d.demandCount,
      purchaserCount: d.purchaserCount,
      firstAt: d.firstAt?.toISOString?.() ?? null,
      lastAt: d.lastAt?.toISOString?.() ?? null,
      productId: d.productId == null ? null : Number(d.productId),
      note: d.note || '',
      updatedAt: d.updatedAt?.toISOString?.() ?? null,
    }
  }

  /** 本周（周一 00:00 起）—— 统计卡「本周新增」用，按日历周而不是「最近 7 天」 */
  private weekStart(): Date {
    const d = new Date()
    const diff = (d.getDay() + 6) % 7 // 周一 = 0
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff)
    s.setHours(0, 0, 0, 0)
    return s
  }

  // ────────────────────────────────────────
  // 买家侧
  // ────────────────────────────────────────

  /** 授权配置（前端据此决定「到货通知我」按钮显示还是隐藏） */
  subscribeConfig() {
    const tmpl = this.subscribeTemplateId()
    return { configured: !!tmpl, templateId: tmpl || null }
  }

  /**
   * 上报「客户要了但我们没有的菜」
   * 语义 = 明细 +1、汇总计数重算。幂等：同一人 + 同一需求 + 同样的话 5 分钟内只记一条。
   */
  async report(userId: bigint, dto: DemandReportDto) {
    const purchaser = await this.purchaserOf(userId)

    const incoming = (dto.items || [])
      .map((i) => ({ ...i, rawText: sanitizeRawText(i.rawText) }))
      .filter((i) => !!i.rawText)
    if (!incoming.length) return { recorded: 0, duplicated: 0, demands: [] }

    // 同一次请求里同一个归一化键只算一条（前端可能把同一菜名报两遍）
    const seen = new Set<string>()
    const prepared: Array<{
      key: string
      name: string
      rawText: string
      qtyText?: string
      unit?: string
      qty?: number
    }> = []
    for (const it of incoming) {
      const key = normalizeDemandKey(it.rawText)
      if (!key || seen.has(key)) continue
      seen.add(key)
      prepared.push({
        key,
        name: cleanDemandName(it.rawText),
        rawText: it.rawText,
        qtyText: it.qtyText,
        unit: it.unit,
        qty: it.qty,
      })
    }
    if (!prepared.length) return { recorded: 0, duplicated: 0, demands: [] }

    const offMap = await this.offShelfMap()
    const since = new Date(Date.now() - IDEMPOTENT_WINDOW_MS)
    const touched = new Map<string, bigint>()
    let recorded = 0
    let duplicated = 0

    for (const p of prepared) {
      const matchedProductId = offMap.get(p.key) || null
      const kind = matchedProductId ? 1 : 0

      let demand = await this.prisma.purchaseDemand.findUnique({ where: { demandKey: p.key } })
      if (!demand) {
        try {
          demand = await this.prisma.purchaseDemand.create({
            data: { demandKey: p.key, name: p.name, productId: matchedProductId, status: DemandStatus.PENDING },
          })
        } catch (e) {
          // 并发下另一个请求刚好建好 → 回读即可（唯一键就在 demandKey 上，库层兜得住）
          demand = await this.prisma.purchaseDemand.findUnique({ where: { demandKey: p.key } })
          if (!demand) throw e
        }
      } else if (!demand.productId && matchedProductId) {
        // 后到的上报才认出「这是已有商品但已下架」→ 补上关联（口径 1②）
        demand = await this.prisma.purchaseDemand.update({
          where: { id: demand.id },
          data: { productId: matchedProductId },
        })
      }

      // 幂等：原话与数量都相同才算「同一句话」（改口说要 5 斤是新的需求，不该被吃掉）
      const dup = await this.prisma.purchaseDemandItem.findFirst({
        where: {
          demandId: demand.id,
          purchaserId: purchaser.id,
          rawText: p.rawText,
          qtyText: p.qtyText ?? null,
          createdAt: { gte: since },
        },
      })
      touched.set(p.key, demand.id)
      if (dup) {
        duplicated++
        continue
      }

      await this.prisma.purchaseDemandItem.create({
        data: {
          demandId: demand.id,
          purchaserId: purchaser.id,
          userId,
          rawText: p.rawText,
          qtyText: p.qtyText ?? null,
          unit: p.unit ?? null,
          qty: p.qty ?? null,
          kind,
          source: 1,
        },
      })
      recorded++
    }

    const demands: any[] = []
    for (const id of touched.values()) {
      await this.recompute(id)
      const d = await this.prisma.purchaseDemand.findUnique({ where: { id } })
      if (d) demands.push(this.toRow(d))
    }
    return { recorded, duplicated, demands }
  }

  /** 我的需求（名称 / 状态 / 最后时间 / 是否已通知） */
  async mine(userId: bigint) {
    const purchaser = await this.purchaserOf(userId)
    const items = await this.prisma.purchaseDemandItem.findMany({
      where: { purchaserId: purchaser.id },
      orderBy: { createdAt: 'desc' },
    })
    const ids = [...new Set(items.map((i) => i.demandId))]
    const demands = ids.length
      ? await this.prisma.purchaseDemand.findMany({ where: { id: { in: ids } } })
      : []
    const okIds = new Set<string>()
    if (ids.length) {
      const logs = await this.prisma.demandNotifyLog.findMany({
        where: { purchaserId: purchaser.id, demandId: { in: ids }, result: 'ok' },
        select: { demandId: true },
      })
      logs.forEach((l) => okIds.add(String(l.demandId)))
    }
    // items 已按时间倒序 → 每个需求第一次出现的就是它的最近一次
    const lastMap = new Map<string, Date>()
    for (const it of items) {
      const k = String(it.demandId)
      if (!lastMap.has(k)) lastMap.set(k, it.createdAt)
    }

    const list = demands
      .map((d) => ({
        id: Number(d.id),
        name: d.name,
        status: d.status,
        statusText: DEMAND_STATUS_TEXT[d.status] ?? '未知',
        demandCount: d.demandCount,
        lastAt: (lastMap.get(String(d.id)) || d.lastAt).toISOString(),
        notified: okIds.has(String(d.id)),
      }))
      .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))

    return { list, templateConfigured: this.templateConfigured() }
  }

  /**
   * 上报 `wx.requestSubscribeMessage` 的结果 → 落授权额度
   *
   * ⚠️ 授权只发生在**客户端**：服务端不可能知道用户点了同意还是拒绝，
   *    必须靠这个接口把结果报上来，否则「能不能发订阅消息」永远判不出来。
   *    微信口径：用户每同意一次，授予**一次**发送机会（发一次扣一次）。
   */
  async subscribe(userId: bigint, dto: DemandSubscribeDto) {
    const tmpl = this.subscribeTemplateId()
    if (!tmpl) throw new BizException(ErrorCode.PARAM_ERROR, '运营还没配置到货通知模板')
    const purchaser = await this.purchaserOf(userId)

    const accepted = (dto.accepted || []).filter((t) => t === tmpl)
    if (accepted.length) {
      // 原子 upsert：同一人并发上报两次也不会丢额度、不会读改写丢更新
      // ⚠️ 时间列一律用 **UTC_TIMESTAMP(3)**，不是 NOW(3)：
      //    本机 MySQL 会话时区 = SYSTEM（+08），而 Prisma 写入/读取 DATETIME 是按 **UTC** 解释的。
      //    用 NOW(3) 写进去的值会被 Prisma 当成 UTC 读 → 整列偏 8 小时（实测踩到过，
      //    表现为「明明改成 49 小时前了，判断出来还是 41 小时前」）。
      await this.prisma.$executeRaw`
        INSERT INTO demand_subscribe_quota
          (purchaser_id, template_id, quota, accepted_at, created_at, updated_at)
        VALUES (${purchaser.id}, ${tmpl}, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE quota = quota + 1, accepted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
      `
    }
    const row = await this.prisma.demandSubscribeQuota.findUnique({
      where: { purchaserId_templateId: { purchaserId: purchaser.id, templateId: tmpl } },
    })
    return { templateId: tmpl, quota: row?.quota ?? 0, accepted: accepted.length > 0 }
  }

  // ────────────────────────────────────────
  // 运营侧 · 列表 / 下钻
  // ────────────────────────────────────────

  private buildWhere(q: any) {
    const where: any = {}
    if (q?.status !== undefined && q?.status !== '' && q?.status !== null) {
      const st = Number(q.status)
      if ([0, 1, 2, 3].includes(st)) where.status = st
    }
    const kw = String(q?.keyword || '').trim()
    if (kw) where.OR = [{ name: { contains: kw } }, { demandKey: { contains: kw } }]
    return where
  }

  /**
   * 列表 + 统计卡
   *
   * 排序口径：purchaserCount↓ → demandCount↓ → lastAt↓（要的人多的排前面，采购先买）。
   * `?sort=recent` 可切「最近优先」（运营刚补录完、想马上确认自己那条时用）。
   */
  async adminList(q: any) {
    const page = Math.max(1, parseInt(String(q?.page ?? '1'), 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(String(q?.pageSize ?? '20'), 10) || 20))
    const where = this.buildWhere(q)
    const recent = String(q?.sort || '') === 'recent'
    const orderBy: any = recent
      ? [{ lastAt: 'desc' }, { id: 'desc' }]
      : [{ purchaserCount: 'desc' }, { demandCount: 'desc' }, { lastAt: 'desc' }]

    const [total, rows, pending, newThisWeek, hot] = await Promise.all([
      this.prisma.purchaseDemand.count({ where }),
      this.prisma.purchaseDemand.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.purchaseDemand.count({ where: { status: DemandStatus.PENDING } }),
      this.prisma.purchaseDemand.count({ where: { firstAt: { gte: this.weekStart() } } }),
      this.prisma.purchaseDemand.count({
        where: { purchaserCount: { gte: 3 }, status: { not: DemandStatus.ABANDONED } },
      }),
    ])

    return {
      total,
      list: rows.map((d) => this.toRow(d)),
      sort: recent ? 'recent' : 'hot',
      templateConfigured: this.templateConfigured(),
      stats: { pending, newThisWeek, hot },
    }
  }

  async adminDetail(id: number) {
    const demand = await this.prisma.purchaseDemand.findUnique({ where: { id: BigInt(id) } })
    if (!demand) throw new BizException(ErrorCode.NOT_FOUND, '该采购需求不存在')

    const items = await this.prisma.purchaseDemandItem.findMany({
      where: { demandId: demand.id },
      orderBy: { createdAt: 'desc' },
    })
    const caps = await this.capabilities(demand.id, items)
    const logs = await this.prisma.demandNotifyLog.findMany({
      where: { demandId: demand.id },
      orderBy: { id: 'desc' },
      take: 50,
    })

    return {
      demand: this.toRow(demand),
      items: items.map((i) => ({
        id: Number(i.id),
        purchaserId: Number(i.purchaserId),
        userId: Number(i.userId),
        rawText: i.rawText,
        qtyText: i.qtyText || '',
        unit: i.unit || '',
        qty: i.qty == null ? null : Number(i.qty),
        kind: i.kind,
        kindText: i.kind === 1 ? '已有商品·已下架' : '未收录',
        source: i.source,
        sourceText: i.source === 2 ? '后台手填' : 'AI 对话',
        createdAt: i.createdAt.toISOString(),
      })),
      capability: caps.map((c) => this.publicCapability(c)),
      notifyLogs: logs.map((l) => ({
        id: Number(l.id),
        purchaserId: Number(l.purchaserId),
        channel: l.channel,
        channelText: l.channel === 1 ? '订阅消息' : l.channel === 2 ? '客服消息' : '仅站内列表',
        templateId: l.templateId || '',
        result: l.result,
        errCode: l.errCode,
        errMsg: l.errMsg || '',
        createdAt: l.createdAt.toISOString(),
      })),
      templateConfigured: this.templateConfigured(),
    }
  }

  // ────────────────────────────────────────
  // 运营侧 · 通知名单与发送
  // ────────────────────────────────────────

  /** 内部行：带 openid（发送要用），对外一律走 publicCapability() 剥掉 */
  private publicCapability(c: any) {
    const { openid, ...rest } = c
    return rest
  }

  /**
   * 逐客户判定「能不能发、走哪条通道」（预览与实发共用同一份实现，避免两边口径不一致）
   *   ① 已授权且额度 > 0            → 订阅消息
   *   ② 否则 48 小时内有过交互      → 客服消息
   *   ③ 否则                        → 发不了（带原因），进「待其主动来访」
   */
  private async capabilities(demandId: bigint, itemsIn?: any[]) {
    const items =
      itemsIn ||
      (await this.prisma.purchaseDemandItem.findMany({
        where: { demandId },
        orderBy: { createdAt: 'desc' },
      }))

    const byPurchaser = new Map<string, { purchaserId: bigint; times: number; lastAt: Date }>()
    for (const it of items) {
      const k = String(it.purchaserId)
      const cur = byPurchaser.get(k)
      if (cur) {
        cur.times++
        if (it.createdAt > cur.lastAt) cur.lastAt = it.createdAt
      } else {
        byPurchaser.set(k, { purchaserId: it.purchaserId, times: 1, lastAt: it.createdAt })
      }
    }

    const tmpl = this.subscribeTemplateId()
    const realIds = [...byPurchaser.values()]
      .map((v) => v.purchaserId)
      .filter((id) => id > BigInt(ADMIN_ENTERED_PURCHASER_ID))

    const purchasers = realIds.length
      ? await this.prisma.purchaser.findMany({
          where: { id: { in: realIds } },
          include: { user: { select: { wxOpenid: true } } },
        })
      : []
    const pmap = new Map(purchasers.map((p) => [String(p.id), p]))

    const quotas =
      tmpl && realIds.length
        ? await this.prisma.demandSubscribeQuota.findMany({
            where: { templateId: tmpl, purchaserId: { in: realIds } },
          })
        : []
    const qmap = new Map(quotas.map((q) => [String(q.purchaserId), q]))

    const rows: any[] = []
    for (const v of byPurchaser.values()) {
      const isAdminEntered = v.purchaserId === BigInt(ADMIN_ENTERED_PURCHASER_ID)
      const p = pmap.get(String(v.purchaserId))
      const base = {
        purchaserId: Number(v.purchaserId),
        times: v.times,
        lastAt: v.lastAt.toISOString(),
        shopName: isAdminEntered ? '（后台代录）' : p?.shopName || '（客户信息缺失）',
        contact: p?.contact || '',
        phone: p?.phone || '',
        openid: p?.user?.wxOpenid || '',
      }

      if (isAdminEntered) {
        rows.push({ ...base, canSend: false, channel: DemandChannel.LIST_ONLY, reason: '后台代录，没有对应客户账号' })
        continue
      }
      if (!p) {
        rows.push({ ...base, canSend: false, channel: DemandChannel.LIST_ONLY, reason: '客户账号已不存在' })
        continue
      }
      if (!p.user?.wxOpenid) {
        rows.push({ ...base, canSend: false, channel: DemandChannel.LIST_ONLY, reason: '客户没有微信 openid，发不出去' })
        continue
      }
      if (!tmpl) {
        rows.push({ ...base, canSend: false, channel: DemandChannel.LIST_ONLY, reason: '运营还没配置到货通知模板' })
        continue
      }
      const q = qmap.get(String(v.purchaserId))
      if (q && q.quota > 0) {
        rows.push({ ...base, canSend: true, channel: DemandChannel.SUBSCRIBE, reason: '' })
        continue
      }
      if (Date.now() - v.lastAt.getTime() <= CUSTOM_WINDOW_MS) {
        rows.push({ ...base, canSend: true, channel: DemandChannel.CUSTOM, reason: '' })
        continue
      }
      rows.push({
        ...base,
        canSend: false,
        channel: DemandChannel.LIST_ONLY,
        reason: '客户没授权订阅消息，且已超过 48 小时客服消息窗口，只能等其主动来访',
      })
    }
    return rows
  }

  async notifyPreview(id: number) {
    const demand = await this.prisma.purchaseDemand.findUnique({ where: { id: BigInt(id) } })
    if (!demand) throw new BizException(ErrorCode.NOT_FOUND, '该采购需求不存在')
    const rows = await this.capabilities(demand.id)
    const canSubscribe = rows.filter((r) => r.channel === DemandChannel.SUBSCRIBE)
    const canCustom = rows.filter((r) => r.channel === DemandChannel.CUSTOM)
    const cannot = rows.filter((r) => !r.canSend)
    return {
      demandId: Number(demand.id),
      name: demand.name,
      status: demand.status,
      statusText: DEMAND_STATUS_TEXT[demand.status] ?? '未知',
      templateConfigured: this.templateConfigured(),
      templateId: this.subscribeTemplateId() || null,
      canSubscribe: canSubscribe.map((c) => this.publicCapability(c)),
      canCustom: canCustom.map((c) => this.publicCapability(c)),
      cannot: cannot.map((c) => this.publicCapability(c)),
      counts: {
        total: rows.length,
        canSubscribe: canSubscribe.length,
        canCustom: canCustom.length,
        cannot: cannot.length,
      },
    }
  }

  /** 组装订阅消息字段（模板字段名走配置，避免写死/猜测） */
  private subscribeData(demand: any): Record<string, { value: string }> {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
    const vars: Record<string, string> = {
      name: demand.name,
      time,
      note: demand.note || '已到货，点开小程序即可下单',
    }

    let fields: Record<string, string> = DEFAULT_TMPL_FIELDS
    const conf = (process.env.WX_SUBSCRIBE_TMPL_DEMAND_FIELDS || '').trim()
    if (conf) {
      try {
        const parsed = JSON.parse(conf)
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) fields = parsed
      } catch {
        // 配置写坏了就退回默认，并在日志里说清（绝不让解析失败把整个通知干掉）
        this.logger.warn('WX_SUBSCRIBE_TMPL_DEMAND_FIELDS 不是合法 JSON，本次按默认字段映射发送')
      }
    }

    const out: Record<string, { value: string }> = {}
    for (const [field, tpl] of Object.entries(fields)) {
      let v = String(tpl)
      for (const [k, val] of Object.entries(vars)) v = v.split(`{${k}}`).join(val)
      // 微信 thing/time 类型字段有长度限制，统一截到 20 字（time 格式 16 字符，不受影响）
      out[field] = { value: v.slice(0, 20) }
    }
    return out
  }

  private async logNotify(
    demandId: bigint,
    purchaserId: number,
    channel: number,
    templateId: string | null,
    result: 'ok' | 'fail',
    errCode?: number | null,
    errMsg?: string | null,
  ) {
    await this.prisma.demandNotifyLog.create({
      data: {
        demandId,
        purchaserId: BigInt(purchaserId),
        channel,
        templateId: templateId || null,
        result,
        errCode: errCode == null ? null : Number(errCode),
        errMsg: errMsg ? String(errMsg).slice(0, 255) : null,
      },
    })
  }

  /**
   * 实发到货通知
   * ⚠️ 口径 5：发不出去的人**不群发、不假装发过** —— 他们没有 result='ok' 的行。
   *    这里对每个人**逐条**落 `demand_notify_log`（含发不出去的原因），
   *    返回「已通知 X 人，Y 人没发出去（原因）」。
   */
  async adminNotify(id: number, operatorId: bigint) {
    const demand = await this.prisma.purchaseDemand.findUnique({ where: { id: BigInt(id) } })
    if (!demand) throw new BizException(ErrorCode.NOT_FOUND, '该采购需求不存在')

    const tmpl = this.subscribeTemplateId()
    // 口径 8：模板没配就直接给人话提示，**绝不写死/猜测模板 id**，也绝不裸 500
    if (!tmpl) {
      throw new BizException(ErrorCode.PARAM_ERROR, '运营还没配置到货通知模板，暂时发不了到货通知')
    }

    const rows = await this.capabilities(demand.id)
    const data = this.subscribeData(demand)
    const failures: any[] = []
    let notified = 0

    for (const r of rows) {
      const who = { purchaserId: r.purchaserId, shopName: r.shopName }

      if (r.channel === DemandChannel.SUBSCRIBE) {
        const res = await this.wx.sendSubscribeMessage(r.openid, tmpl, data, 'pages/buyer/my-demands')
        if (res.ok) {
          await this.prisma.$executeRaw`
            UPDATE demand_subscribe_quota
               SET quota = GREATEST(quota - 1, 0), notified_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
             WHERE purchaser_id = ${BigInt(r.purchaserId)} AND template_id = ${tmpl}
          `
          await this.logNotify(demand.id, r.purchaserId, DemandChannel.SUBSCRIBE, tmpl, 'ok')
          notified++
        } else {
          await this.logNotify(
            demand.id,
            r.purchaserId,
            DemandChannel.SUBSCRIBE,
            tmpl,
            'fail',
            res.errcode,
            res.errmsg,
          )
          failures.push({ ...who, channel: '订阅消息', reason: `微信返回 ${res.errcode}：${res.errmsg}` })
        }
        continue
      }

      if (r.channel === DemandChannel.CUSTOM) {
        const content = `您关注的「${demand.name}」已到货，可直接下单。`
        const res = await this.wx.sendCustomText(r.openid, content)
        if (res.ok) {
          await this.logNotify(demand.id, r.purchaserId, DemandChannel.CUSTOM, tmpl, 'ok')
          notified++
        } else {
          // 45015 = 已超 48 小时窗口（口径 4：先试发、按错误码判定）
          const reason =
            res.errcode === 45015
              ? '客服消息已超 48 小时窗口'
              : `微信返回 ${res.errcode}：${res.errmsg}`
          await this.logNotify(demand.id, r.purchaserId, DemandChannel.CUSTOM, tmpl, 'fail', res.errcode, res.errmsg)
          failures.push({ ...who, channel: '客服消息', reason })
        }
        continue
      }

      // 发不出去：**也落库**，只是 channel=3 —— 后台据此标「待其主动来访」
      await this.logNotify(demand.id, r.purchaserId, DemandChannel.LIST_ONLY, null, 'fail', null, r.reason)
      failures.push({ ...who, channel: '站内列表', reason: r.reason })
    }

    await this.audit.log({
      operatorId,
      action: 'DEMAND_NOTIFY',
      entity: 'purchase_demand',
      entityId: demand.id,
      after: { notified, failed: failures.length, templateId: tmpl, demandName: demand.name },
    })

    return {
      demandId: Number(demand.id),
      name: demand.name,
      notified,
      failed: failures.length,
      failures,
      templateId: tmpl,
    }
  }

  // ────────────────────────────────────────
  // 运营侧 · 写操作
  // ────────────────────────────────────────

  async adminUpdate(id: number, dto: DemandUpdateDto, operatorId: bigint) {
    const before = await this.prisma.purchaseDemand.findUnique({ where: { id: BigInt(id) } })
    if (!before) throw new BizException(ErrorCode.NOT_FOUND, '该采购需求不存在')

    const data: any = {}
    if (dto.status !== undefined) data.status = dto.status
    if (dto.note !== undefined) data.note = dto.note
    // ⚠️ 只改显示名，不动 demandKey：键是聚合与幂等的依据，改键会把历史明细拆散
    if (dto.name !== undefined && dto.name.trim()) data.name = dto.name.trim().slice(0, 64)
    if (!Object.keys(data).length) return this.toRow(before)

    const after = await this.prisma.purchaseDemand.update({ where: { id: before.id }, data })
    await this.audit.log({
      operatorId,
      action: 'DEMAND_UPDATE',
      entity: 'purchase_demand',
      entityId: before.id,
      before: { status: before.status, note: before.note, name: before.name },
      after: { status: after.status, note: after.note, name: after.name },
    })
    return this.toRow(after)
  }

  /** 合并：明细与计数并入目标，源行删除（口径 3 的手动合并入口） */
  async adminMerge(id: number, dto: DemandMergeDto, operatorId: bigint) {
    if (Number(id) === Number(dto.targetId)) {
      throw new BizException(ErrorCode.PARAM_ERROR, '不能合并到自己')
    }
    const src = await this.prisma.purchaseDemand.findUnique({ where: { id: BigInt(id) } })
    const dst = await this.prisma.purchaseDemand.findUnique({ where: { id: BigInt(dto.targetId) } })
    if (!src) throw new BizException(ErrorCode.NOT_FOUND, '要合并的需求不存在')
    if (!dst) throw new BizException(ErrorCode.NOT_FOUND, '目标需求不存在')

    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseDemandItem.updateMany({
        where: { demandId: src.id },
        data: { demandId: dst.id },
      })
      // 目标缺下架商品关联时，从源行接过来（保留「已有商品·已下架」这个信息）
      if (!dst.productId && src.productId) {
        await tx.purchaseDemand.update({ where: { id: dst.id }, data: { productId: src.productId } })
      }
      // 备注：目标为空时接过来
      if (!dst.note && src.note) {
        await tx.purchaseDemand.update({ where: { id: dst.id }, data: { note: src.note } })
      }
      await this.recompute(dst.id, tx)
      await tx.purchaseDemand.delete({ where: { id: src.id } })
    })

    await this.audit.log({
      operatorId,
      action: 'DEMAND_MERGE',
      entity: 'purchase_demand',
      entityId: dst.id,
      before: { sourceId: Number(src.id), sourceName: src.name, sourceKey: src.demandKey },
      after: { targetId: Number(dst.id), targetName: dst.name, targetKey: dst.demandKey },
    })

    const merged = await this.prisma.purchaseDemand.findUnique({ where: { id: dst.id } })
    return this.toRow(merged)
  }

  /** 手动新增（电话/微信来的需求，source=2） */
  async adminCreate(dto: DemandCreateDto, operatorId: bigint) {
    const name = sanitizeRawText(dto.name)
    const key = normalizeDemandKey(name)
    if (!key) throw new BizException(ErrorCode.PARAM_ERROR, '菜名不能为空')

    let purchaserId = ADMIN_ENTERED_PURCHASER_ID
    if (dto.purchaserId) {
      const p = await this.prisma.purchaser.findUnique({ where: { id: BigInt(dto.purchaserId) } })
      if (!p) throw new BizException(ErrorCode.PARAM_ERROR, '指定的采购方不存在')
      purchaserId = Number(p.id)
    }

    const offMap = await this.offShelfMap()
    const matchedProductId = offMap.get(key) || null

    let demand = await this.prisma.purchaseDemand.findUnique({ where: { demandKey: key } })
    if (!demand) {
      demand = await this.prisma.purchaseDemand.create({
        data: { demandKey: key, name: cleanDemandName(name), productId: matchedProductId, status: DemandStatus.PENDING },
      })
    } else if (!demand.productId && matchedProductId) {
      demand = await this.prisma.purchaseDemand.update({
        where: { id: demand.id },
        data: { productId: matchedProductId },
      })
    }
    if (dto.note) {
      await this.prisma.purchaseDemand.update({ where: { id: demand.id }, data: { note: dto.note.slice(0, 255) } })
    }

    await this.prisma.purchaseDemandItem.create({
      data: {
        demandId: demand.id,
        purchaserId: BigInt(purchaserId),
        userId: operatorId,
        rawText: name,
        qtyText: dto.qtyText ?? null,
        unit: dto.unit ?? null,
        qty: dto.qty ?? null,
        kind: matchedProductId ? 1 : 0,
        source: 2,
      },
    })
    await this.recompute(demand.id)

    await this.audit.log({
      operatorId,
      action: 'DEMAND_CREATE',
      entity: 'purchase_demand',
      entityId: demand.id,
      after: { name, demandKey: key, purchaserId, qtyText: dto.qtyText || null, source: 2 },
    })

    const fresh = await this.prisma.purchaseDemand.findUnique({ where: { id: demand.id } })
    return this.toRow(fresh)
  }

  /**
   * CSV 导出（带 BOM，Excel 双击即可打开，中文不乱码）
   * 列：菜名 / 几人在要 / 共几次 / 首次 / 最近 / 状态 / 备注
   */
  async adminExportCsv(q: any): Promise<string> {
    const where = this.buildWhere(q)
    const rows = await this.prisma.purchaseDemand.findMany({
      where,
      orderBy: [{ purchaserCount: 'desc' }, { demandCount: 'desc' }, { lastAt: 'desc' }],
    })

    const esc = (v: any) => {
      const s = v == null ? '' : String(v)
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const fmt = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '')

    const lines = [
      ['菜名', '几人在要', '共几次', '首次', '最近', '状态', '备注'].map(esc).join(','),
      ...rows.map((d) =>
        [
          d.name,
          d.purchaserCount,
          d.demandCount,
          fmt(d.firstAt),
          fmt(d.lastAt),
          DEMAND_STATUS_TEXT[d.status] ?? '未知',
          d.note || '',
        ]
          .map(esc)
          .join(','),
      ),
    ]
    // ⚠️ BOM 必须在最前面，否则 Excel 会按 GBK 解码 → 中文全是乱码
    return `\uFEFF${lines.join('\r\n')}\r\n`
  }
}
