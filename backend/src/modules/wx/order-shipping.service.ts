import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, OrderStatus } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { WxOrderClient } from './wx-order.client'

/**
 * 小程序发货信息管理 · 业务层（卡S1 · 2026-09-29）
 *
 * 为什么必须做：官方《实物电商类小程序运营规范》要求卖实物+配送（含同城配送）的小程序
 * 接入平台订单发货管理。**不接入 = 限制支付**（我们真机撞过 errno 102 / wxa_trade_controlled）；
 * **接入后不录入发货信息 = 钱一直冻结**（快递 T+10、自提/同城配送 T+2 自动确认收货后才结算）。
 *
 * 口径（写死，别改）：
 *   - 只对「已通过微信支付（payment_record.channel='wechat' && status=1）」的订单录入。
 *     COD 现金单、未支付单**一律不调**（它们没走线上结算，微信侧也没有可录入的支付单）。
 *   - 触发点 = 配送任务「交付确认」（订单置已送达 60）。**旁路副作用**：
 *     录入失败绝不影响送达，失败落台账 + 由补偿任务重试。
 *   - 幂等靠台账 `order_shipping`：status=1 直接返回，不再打微信
 *     （微信侧**一笔支付单只有一次「重新发货」机会**，改模式也算 → 重复调用是真实损失）。
 *   - 10060002「支付单已完成发货」→ 视为幂等成功（微信侧已完成，我们补记）；
 *     10060003「已使用重新发货机会」→ **不再重试**（终态，否则每次补偿都白打一次微信）。
 */

/** 台账状态：0 待录入 / 1 已录入 / 2 失败可重试 / 3 终态失败（不再重试） */
const ShipStatus = { PENDING: 0, DONE: 1, RETRY: 2, DEAD: 3 } as const

/** 同一订单最多尝试次数（超过进终态，避免无脑重试把微信接口打爆） */
const MAX_ATTEMPTS = 8

/** 物流模式：2 同城配送（本项目默认）/ 4 用户自提 */
const LOGISTICS_SAME_CITY = 2
const LOGISTICS_SELF_PICKUP = 4

/** 商品描述上限（微信限制 120 字，留余量） */
const ITEM_DESC_MAX = 110

@Injectable()
export class OrderShippingService {
  private readonly logger = new Logger(OrderShippingService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly wxOrder: WxOrderClient,
    private readonly audit: AuditService,
  ) {}

  /// 让前端/后台能给人话提示（「还没开通发货管理」vs「已开通但录入失败」）
  async status(orderId: number) {
    const ledger = await this.prisma.orderShipping.findUnique({ where: { orderId: BigInt(orderId) } })
    return {
      orderId,
      uploaded: ledger?.status === ShipStatus.DONE,
      status: ledger?.status ?? null,
      logisticsType: ledger?.logisticsType ?? null,
      attempts: ledger?.attempts ?? 0,
      lastError: ledger?.lastError ?? null,
      uploadedAt: ledger?.uploadedAt ? ledger.uploadedAt.toISOString() : null,
    }
  }

  /// 该订单**当前有效**的微信已支付流水（退款后会被置 2，故这里天然只认"现在真的收了钱"）
  private async wechatPaidRecord(orderId: bigint) {
    return this.prisma.paymentRecord.findFirst({
      where: { orderId, channel: 'wechat', status: 1 },
      orderBy: { id: 'desc' },
    })
  }

  /** 商品汇总（微信必填字段，不许写死占位文本）：`土豆 5斤、猪肉 3斤`，超长截断 */
  private buildItemDesc(items: Array<{ name: string; qty: number; unit: string }>): string {
    const parts = items.map((i) => `${i.name} ${i.qty}${i.unit || ''}`.trim())
    let s = parts.join('、')
    if (s.length > ITEM_DESC_MAX) s = `${s.slice(0, ITEM_DESC_MAX - 1)}…`
    return s || '生鲜商品'
  }

  /// 自提还是同城配送：配送任务里 stationList 无「自提」标记 → 本项目默认同城配送
  private async logisticsTypeOf(orderId: bigint): Promise<number> {
    const task = await this.prisma.deliveryTask.findFirst({
      where: { stationList: { array_contains: { orderId: Number(orderId) } } },
      orderBy: { id: 'desc' },
      select: { stationList: true },
    })
    const stations: any[] = Array.isArray(task?.stationList) ? (task!.stationList as any[]) : []
    const station = stations.find((s) => s?.type === 'deliver' && Number(s?.orderId) === Number(orderId))
    return station?.selfPickup ? LOGISTICS_SELF_PICKUP : LOGISTICS_SAME_CITY
  }

  /**
   * 录入某订单的发货信息（幂等，可被补偿任务重复调用）
   * 返回 { ok, skipped?, code?, msg? }：ok=true 覆盖「成功」与「微信侧已完成（幂等）」两种情况。
   */
  async uploadForOrder(
    orderId: number,
    opts: { force?: boolean } = {},
  ): Promise<{ ok: boolean; skipped?: string; code?: number; msg?: string }> {
    const oid = BigInt(orderId)
    const order = await this.prisma.order.findUnique({
      where: { id: oid },
      include: { items: { include: { product: { select: { name: true, unit: true } } } }, purchaser: { include: { user: { select: { wxOpenid: true } } } } },
    })
    if (!order) return { ok: false, skipped: '订单不存在' }

    // 只有已送达/已完成（钱已按平台规则进入"待录入发货信息"状态）才录
    if (order.status !== OrderStatus.DELIVERED && order.status !== OrderStatus.COMPLETED) {
      return { ok: false, skipped: `订单状态 ${order.status} 不是已送达/已完成` }
    }

    const ledger = await this.prisma.orderShipping.findUnique({ where: { orderId: oid } })
    if (ledger?.status === ShipStatus.DONE) return { ok: true, skipped: 'already-uploaded' }
    if (ledger?.status === ShipStatus.DEAD && !opts.force) return { ok: false, skipped: 'dead' }

    // 只录「真的走了微信支付」的单：COD 现金/未支付不调微信（调了也只会回 10060001 支付单不存在）
    const rec = await this.wechatPaidRecord(oid)
    if (!rec) return { ok: false, skipped: 'no-wechat-payment' }

    const openid = order.purchaser?.user?.wxOpenid
    if (!openid) {
      await this.markRetry(oid, rec.payNo, '', ledger, '买家 openid 缺失（无法录入发货信息）')
      return { ok: false, code: -1, msg: '买家 openid 缺失' }
    }
    const mchid = process.env.WXPAY_MCHID
    if (!mchid) {
      await this.markRetry(oid, rec.payNo, '', ledger, 'WXPAY_MCHID 未配置')
      return { ok: false, code: -1, msg: 'WXPAY_MCHID 未配置' }
    }
    if (!this.wxOrder.isConfigured()) {
      return { ok: false, skipped: 'wx-not-configured' }
    }

    const logisticsType = await this.logisticsTypeOf(oid)
    const itemDesc = this.buildItemDesc(
      order.items.map((it) => ({ name: it.product?.name ?? '商品', qty: Number(it.qtyAccepted ?? it.qtyOrdered), unit: it.product?.unit ?? '' })),
    )
    // upload_time 必须 RFC 3339 且带时区（本项目业务时区 Asia/Shanghai）
    const uploadTime = this.nowRfc3339()

    let resp: { errcode: number; errmsg: string }
    try {
      resp = await this.wxOrder.uploadShippingInfo({
        outTradeNo: rec.payNo,
        mchid,
        logisticsType,
        deliveryMode: 1, // 统一发货
        itemDesc,
        openid,
        uploadTime,
      })
    } catch (e: any) {
      await this.markRetry(oid, rec.payNo, itemDesc, ledger, `调用失败：${e?.message || e}`, logisticsType)
      return { ok: false, code: -1, msg: String(e?.message || e) }
    }

    // 10060002：微信侧已完成发货（可能我们上次写入后没记台账）→ 幂等成功，补记
    if (resp.errcode === 0 || resp.errcode === 10060002) {
      await this.markDone(oid, rec.payNo, itemDesc, logisticsType, resp.errcode === 0 ? null : `微信侧已完成发货（${resp.errcode}），台账补记`)
      return { ok: true, code: resp.errcode }
    }

    // 10060003：重新发货机会已用掉 → 终态，不再重试
    if (resp.errcode === 10060003) {
      await this.markDead(oid, rec.payNo, itemDesc, logisticsType, `重新发货机会已用掉（${resp.errcode}）：${resp.errmsg}`)
      return { ok: false, code: resp.errcode, msg: resp.errmsg }
    }

    await this.markRetry(oid, rec.payNo, itemDesc, ledger, `${resp.errcode} ${resp.errmsg}`.trim(), logisticsType)
    return { ok: false, code: resp.errcode, msg: resp.errmsg }
  }

  /** RFC 3339（上海时区）——微信 upload_time 的硬格式要求 */
  private nowRfc3339(d = new Date()): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, '0')
    const offMin = -d.getTimezoneOffset()
    const sign = offMin >= 0 ? '+' : '-'
    const abs = Math.abs(offMin)
    // ⚠️ 服务器时区可能是 UTC —— 业务口径固定按 +08:00 上报，避免"看起来早 8 小时"
    const sh = new Date(d.getTime() + 8 * 3600 * 1000)
    return (
      `${sh.getUTCFullYear()}-${pad(sh.getUTCMonth() + 1)}-${pad(sh.getUTCDate())}` +
      `T${pad(sh.getUTCHours())}:${pad(sh.getUTCMinutes())}:${pad(sh.getUTCSeconds())}.${pad(sh.getUTCMilliseconds(), 3)}+08:00`
    )
  }

  private async markDone(orderId: bigint, payNo: string, itemDesc: string, logisticsType: number, note: string | null) {
    await this.prisma.orderShipping.upsert({
      where: { orderId },
      create: {
        orderId, payNo, itemDesc: itemDesc || null, logisticsType,
        status: ShipStatus.DONE, attempts: 1, uploadedAt: new Date(),
        lastError: note,
      },
      update: { payNo, itemDesc: itemDesc || null, logisticsType, status: ShipStatus.DONE, uploadedAt: new Date(), lastError: note },
    })
    await this.audit.log({
      operatorId: 0n, // 0 = 系统触发（同超时关单口径）
      action: 'ORDER_SHIPPING_UPLOAD',
      entity: 'order',
      entityId: Number(orderId),
      before: { shipping: 'pending' },
      after: { shipping: 'uploaded', payNoLen: payNo.length, logisticsType, itemDescLen: itemDesc.length, note },
    })
    this.logger.log(`[shipping] 订单 ${orderId} 发货信息已录入微信（logistics_type=${logisticsType}${note ? '，' + note : ''}）`)
  }

  private async markRetry(orderId: bigint, payNo: string, itemDesc: string, ledger: any, error: string, logisticsType = LOGISTICS_SAME_CITY) {
    const attempts = (ledger?.attempts ?? 0) + 1
    const dead = attempts >= MAX_ATTEMPTS
    await this.prisma.orderShipping.upsert({
      where: { orderId },
      create: {
        orderId, payNo, itemDesc: itemDesc || null, logisticsType,
        status: dead ? ShipStatus.DEAD : ShipStatus.RETRY, attempts, lastError: error.slice(0, 255),
      },
      update: {
        payNo, itemDesc: itemDesc || ledger?.itemDesc || null, logisticsType,
        status: dead ? ShipStatus.DEAD : ShipStatus.RETRY, attempts, lastError: error.slice(0, 255),
      },
    })
    await this.audit.log({
      operatorId: 0n,
      action: 'ORDER_SHIPPING_FAIL',
      entity: 'order',
      entityId: Number(orderId),
      before: { shipping: ledger?.status ?? null },
      after: { shipping: dead ? 'dead' : 'retry', attempts, error: error.slice(0, 120) },
    })
    this.logger.error(`[shipping] 订单 ${orderId} 发货信息录入失败（第 ${attempts} 次${dead ? '，已达上限不再重试' : '，等待补偿重试'}）：${error}`)
  }

  private async markDead(orderId: bigint, payNo: string, itemDesc: string, logisticsType: number, error: string) {
    await this.prisma.orderShipping.upsert({
      where: { orderId },
      create: { orderId, payNo, itemDesc: itemDesc || null, logisticsType, status: ShipStatus.DEAD, attempts: 1, lastError: error.slice(0, 255) },
      update: { payNo, itemDesc: itemDesc || null, logisticsType, status: ShipStatus.DEAD, lastError: error.slice(0, 255) },
    })
    await this.audit.log({
      operatorId: 0n,
      action: 'ORDER_SHIPPING_FAIL',
      entity: 'order',
      entityId: Number(orderId),
      before: { shipping: 'retry' },
      after: { shipping: 'dead', reason: error.slice(0, 120) },
    })
    this.logger.error(`[shipping] 订单 ${orderId} 发货信息进入终态（不再重试）：${error}`)
  }

  /**
   * 补偿：把「已线上支付 + 已送达 + 台账未成功」的单捞出来重试。
   * 两路扫描：
   *   ① 台账 status=2（失败可重试）且 attempts < MAX；
   *   ② 压根没建台账的（首次失败发生在建台账之前、或功能上线前就送达的老单）。
   * 不阻塞、不抛错（定时任务里抛错只会污染日志）。
   */
  @Cron(process.env.ORDER_SHIPPING_CRON || '0 */20 * * * *')
  async retryPending(): Promise<{ retried: number; ok: number }> {
    let retried = 0
    let ok = 0
    try {
      const retriable = await this.prisma.orderShipping.findMany({
        where: { status: ShipStatus.RETRY, attempts: { lt: MAX_ATTEMPTS } },
        orderBy: { updatedAt: 'asc' },
        take: 100,
      })
      for (const r of retriable) {
        retried++
        const res = await this.uploadForOrder(Number(r.orderId))
        if (res.ok) ok++
      }

      // ② 已送达但没有台账的单（首次失败发生在建台账之前、或功能上线前就送达的老单）
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000)
      const candidates = await this.prisma.order.findMany({
        where: { status: { in: [OrderStatus.DELIVERED, OrderStatus.COMPLETED] }, createdAt: { gte: since } },
        select: { id: true },
        take: 100,
      })
      // 已有台账的单走上面的 ① 分支（避免对同一单同时跑两条通道）
      const ledgerIds = new Set<string>(
        candidates.length
          ? (
              await this.prisma.orderShipping.findMany({
                where: { orderId: { in: candidates.map((c) => c.id) } },
                select: { orderId: true },
              })
            ).map((r) => String(r.orderId))
          : [],
      )
      for (const o of candidates) {
        if (ledgerIds.has(String(o.id))) continue
        const rec = await this.wechatPaidRecord(o.id)
        if (!rec) continue
        retried++
        const res = await this.uploadForOrder(Number(o.id))
        if (res.ok) ok++
      }
    } catch (e: any) {
      this.logger.error(`[shipping] 补偿任务异常：${e?.message || e}`)
    }
    if (retried) this.logger.log(`[shipping] 补偿轮完成：尝试 ${retried} 单，成功 ${ok} 单`)
    return { retried, ok }
  }

  /// 特殊发货报备（测试单/预售单）：测试单报备后无需发货，也不会被判超时发货
  async reportSpecialOrder(orderId: number, type: 1 | 2, delayTo?: number) {
    const rec = await this.wechatPaidRecord(BigInt(orderId))
    if (!rec) throw new BizException(ErrorCode.NOT_FOUND, '该订单没有微信已支付流水，无法报备')
    const resp = await this.wxOrder.reportSpecialOrder({ orderId: rec.payNo, type, delayTo })
    if (resp.errcode !== 0) {
      throw new BizException(ErrorCode.INTERNAL_ERROR, `报备失败（${resp.errcode}）：${resp.errmsg}`)
    }
    await this.audit.log({
      operatorId: 0n,
      action: 'ORDER_SHIPPING_SPECIAL_REPORT',
      entity: 'order',
      entityId: orderId,
      before: {},
      after: { type, payNoLen: rec.payNo.length },
    })
    return { orderId, type, ok: true }
  }

  /// 给运营后台用：把「开通状态 / 结算确认状态」一次问清（缺凭证时明确说缺什么）
  async platformStatus() {
    if (!this.wxOrder.isConfigured()) {
      return { configured: false, managed: null, confirmed: null, note: '微信凭证未配置（WX_APPID / WX_SECRET）' }
    }
    const managed = await this.wxOrder.isTradeManaged()
    const confirmed = await this.wxOrder.isTradeManagementConfirmed()
    return { configured: true, managed, confirmed, note: '' }
  }
}
