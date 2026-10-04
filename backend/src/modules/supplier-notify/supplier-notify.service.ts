import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import {
  DEFAULT_SUPPLIER_ACK_REMINDER,
  SUPPLIER_ACK_REMINDER_KEY,
  SUPPLIER_NOTIFY_GATEWAY_STATE_KEY,
  SupplierAckReminderConfig,
  inQuietWindow,
  validateReminderConfig,
} from './notify-config'
import { dialTts, isVmsConfigured, maskPhone, queryCallDetail } from './vms.adapter'

/** 卡BP-1：网关取件返回项（phone 明文仅出现在该响应里；台账/日志一律 maskPhone） */
export interface PendingDialItem {
  dialId: string
  orderId: number
  supplierId: number
  phone: string
  supplierName: string | null
  shopName: string | null
  minutesUnacked: number
  ringSeconds: number
  hangupAfterAnswerSeconds: number
}

/**
 * 卡BN-1（2026-10-02）：供应商未接单电话催办（后端）
 *
 * 扫描判定（任务书第五节，写死）：每分钟扫 status=30 且未接单的（订单×供应商），
 * 超过 thresholdMinutes 未点「收到，开始备货」→ 自动拨打阿里云语音 TTS；
 * 两个总刹车：cfg.enabled=false 或 maxCalls=0 → 完全不拨；
 * launchAt（首次保存配置时刻）之前的历史单一律不打；免打扰时段跨零点正确处理。
 *
 * 台账：本卡不许加表 → 每一通拨打写一条 audit_log（action=SUPPLIER_NOTIFY_CALL，
 *       after JSON 携带 orderId/supplierId/mode/result/callId/note），records 接口读它。
 * dry-run：ALIYUN_VMS_* 四值任一为空 ⇒ 不发任何 HTTP 请求，台账 result='dry_run'。
 */
@Injectable()
export class SupplierNotifyService {
  private readonly logger = new Logger(SupplierNotifyService.name)
  private running = false

  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ────────────────────────────────────────
  // 配置（platform_config KV，键不存在用默认值）
  // ────────────────────────────────────────

  async getRawConfig(): Promise<SupplierAckReminderConfig> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: SUPPLIER_ACK_REMINDER_KEY } })
    if (!row?.value) return { ...DEFAULT_SUPPLIER_ACK_REMINDER }
    return { ...DEFAULT_SUPPLIER_ACK_REMINDER, ...(row.value as Partial<SupplierAckReminderConfig>) }
  }

  /** 网关心跳状态：online = 最近一次心跳在 180 秒内（卡BP-1） */
  private async gatewayState(): Promise<{ online: boolean; lastHeartbeatAt: string | null }> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: SUPPLIER_NOTIFY_GATEWAY_STATE_KEY } })
    const at = (row?.value as any)?.at ?? null
    const online = !!at && Date.now() - new Date(at).getTime() < 180 * 1000
    return { online, lastHeartbeatAt: at }
  }

  /** GET/PUT config 的统一返回：{ ...配置, vmsConfigured, callerNumber, templateId, launchAt, todayStats, gateway } */
  async getAdminConfig() {
    const cfg = await this.getRawConfig()
    return {
      ...cfg,
      vmsConfigured: isVmsConfigured(),
      callerNumber: process.env.ALIYUN_VMS_CALLER_NUMBER || null, // 可回显（非密钥）
      templateId: process.env.ALIYUN_VMS_TTS_CODE || null, // 可回显（非密钥）；AK 绝不回显
      todayStats: await this.todayStats(cfg),
      gateway: await this.gatewayState(), // 卡BP-1：网关在线状态
    }
  }

  /** 保存配置（body 为子集，merge 后整体校验）；launchAt 仅首次保存写入，之后任何保存不改 */
  async saveConfig(operatorId: bigint, body: Partial<SupplierAckReminderConfig>) {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: SUPPLIER_ACK_REMINDER_KEY } })
    const before = row ? (row.value as unknown as SupplierAckReminderConfig) : null
    const merged: SupplierAckReminderConfig = {
      ...(before ?? DEFAULT_SUPPLIER_ACK_REMINDER),
      // 只接受白名单字段（ValidationPipe whitelist 已拦未知字段，这里再显式收敛一遍）
      enabled: body.enabled ?? (before ?? DEFAULT_SUPPLIER_ACK_REMINDER).enabled,
      thresholdMinutes: body.thresholdMinutes ?? (before ?? DEFAULT_SUPPLIER_ACK_REMINDER).thresholdMinutes,
      secondGapMinutes: body.secondGapMinutes ?? (before ?? DEFAULT_SUPPLIER_ACK_REMINDER).secondGapMinutes,
      maxCalls: body.maxCalls ?? (before ?? DEFAULT_SUPPLIER_ACK_REMINDER).maxCalls,
      quietEnabled: body.quietEnabled ?? (before ?? DEFAULT_SUPPLIER_ACK_REMINDER).quietEnabled,
      quietStart: body.quietStart ?? (before ?? DEFAULT_SUPPLIER_ACK_REMINDER).quietStart,
      quietEnd: body.quietEnd ?? (before ?? DEFAULT_SUPPLIER_ACK_REMINDER).quietEnd,
      // ── 卡BP-1 新增四字段（旧存量行可能缺字段，逐个兜默认值） ──
      channel: body.channel ?? (before as any)?.channel ?? DEFAULT_SUPPLIER_ACK_REMINDER.channel,
      ringSeconds: body.ringSeconds ?? (before as any)?.ringSeconds ?? DEFAULT_SUPPLIER_ACK_REMINDER.ringSeconds,
      hangupAfterAnswerSeconds:
        body.hangupAfterAnswerSeconds ?? (before as any)?.hangupAfterAnswerSeconds ?? DEFAULT_SUPPLIER_ACK_REMINDER.hangupAfterAnswerSeconds,
      gatewayPhoneNo:
        body.gatewayPhoneNo !== undefined ? body.gatewayPhoneNo : ((before as any)?.gatewayPhoneNo ?? DEFAULT_SUPPLIER_ACK_REMINDER.gatewayPhoneNo),
      // ── Hermes 复核收口：同一供应商冷却分钟数 ──
      supplierGapMinutes:
        body.supplierGapMinutes ?? (before as any)?.supplierGapMinutes ?? DEFAULT_SUPPLIER_ACK_REMINDER.supplierGapMinutes,
      // ★ 首次保存写入保存时刻；之后任何保存不许改（历史单拨打分界线）
      launchAt: before?.launchAt ?? new Date().toISOString(),
    }
    validateReminderConfig(merged)
    await this.prisma.platformConfig.upsert({
      where: { key: SUPPLIER_ACK_REMINDER_KEY },
      update: { value: merged as unknown as any },
      create: { key: SUPPLIER_ACK_REMINDER_KEY, value: merged as unknown as any },
    })
    // 审计：尤其记下谁把阈值从 5 改成 3（before/after 全量对比）
    await this.audit.log({
      operatorId,
      action: 'SUPPLIER_NOTIFY_CONFIG',
      entity: 'platform_config',
      entityId: 0,
      before: before ?? undefined,
      after: merged,
    })
    return this.getAdminConfig()
  }

  /** 今日统计：calls=今日台账数（auto+manual）、connected=今日接通、needManual=当前「达上限未处理」的催办对象数 */
  private async todayStats(cfg: SupplierAckReminderConfig) {
    const todayStart = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) + 'T00:00:00+08:00')
    const records = await this.prisma.auditLog.findMany({
      where: { action: 'SUPPLIER_NOTIFY_CALL', createdAt: { gte: todayStart } },
      select: { after: true },
    })
    const calls = records.length
    const connected = records.filter((r) => (r.after as any)?.result === 'connected').length
    let needManual = 0
    if (cfg.maxCalls > 0) {
      const acks = await this.prisma.orderSupplierAck.findMany({
        where: { ackAt: null, remindStopped: 0, remindCount: { gte: cfg.maxCalls } },
        select: { orderId: true },
      })
      const orderIds = [...new Set(acks.map((a) => a.orderId))]
      if (orderIds.length) {
        const orders = await this.prisma.order.findMany({ where: { id: { in: orderIds }, status: 30 }, select: { id: true } })
        needManual = orders.length
      }
    }
    return { calls, connected, needManual }
  }

  // ────────────────────────────────────────
  // 催办列表（运营后台数据源，卡BN-2 按此渲染）
  // ────────────────────────────────────────

  async list() {
    const cfg = await this.getRawConfig()
    const now = Date.now()
    const since = now - 24 * 3600 * 1000
    const launchAt = new Date(cfg.launchAt).getTime()
    const quietNow = cfg.quietEnabled && inQuietWindow(new Date(), cfg.quietStart, cfg.quietEnd)

    const orders = await this.prisma.order.findMany({
      where: { status: 30 },
      select: {
        id: true, createdAt: true,
        items: { select: { supplierId: true } },
        purchaser: { select: { shopName: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    const pairs: { orderId: bigint; supplierId: bigint }[] = []
    for (const o of orders) {
      const sids = [...new Set(o.items.map((it) => it.supplierId).filter((id): id is bigint => id !== null))]
      for (const sid of sids) pairs.push({ orderId: o.id, supplierId: sid })
    }
    if (!pairs.length) return { settings: { ...cfg, quietNow, gateway: await this.gatewayState() }, rows: [] }

    const orderMap = new Map(orders.map((o) => [Number(o.id), o]))
    const supplierIds = [...new Set(pairs.map((p) => p.supplierId))]
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, stallName: true, ackCallEnabled: true, user: { select: { phone: true } } },
    })
    const supMap = new Map(suppliers.map((s) => [Number(s.id), s]))
    const acks = await this.prisma.orderSupplierAck.findMany({
      where: { orderId: { in: orders.map((o) => o.id) } },
    })
    const ackMap = new Map(acks.map((a) => [`${Number(a.orderId)}:${Number(a.supplierId)}`, a]))

    // 最近 24h 台账 → 每对 (order,supplier) 的最后一通结果
    const recordRows = await this.prisma.auditLog.findMany({
      where: { action: 'SUPPLIER_NOTIFY_CALL', createdAt: { gte: new Date(since) } },
      orderBy: { id: 'asc' },
      select: { after: true },
    })
    const lastRecord = new Map<string, any>()
    for (const r of recordRows) {
      const a = r.after as any
      if (a?.orderId && a?.supplierId) lastRecord.set(`${a.orderId}:${a.supplierId}`, a)
    }

    const rows = pairs.map((p) => {
      const key = `${Number(p.orderId)}:${Number(p.supplierId)}`
      const o = orderMap.get(Number(p.orderId))!
      const s = supMap.get(Number(p.supplierId))
      const ack = ackMap.get(key)
      const createdAt = o.createdAt
      const minutesUnacked = Math.floor((now - createdAt.getTime()) / 60000)
      const ackAt = ack?.ackAt ?? null
      const remindStopped = ack?.remindStopped === 1
      const remindCount = ack?.remindCount ?? 0
      const lastRemindAt = ack?.lastRemindAt ?? null
      const phone = s?.user?.phone || null
      const inCandidateBase = now - createdAt.getTime() <= 24 * 3600 * 1000 && createdAt.getTime() >= launchAt
      const rec = lastRecord.get(key)
      let lastResult: string | null = rec?.result ?? null
      if (!lastResult && !ackAt && inCandidateBase && minutesUnacked >= cfg.thresholdMinutes) {
        // 未落台账时的跳过原因（列表实时推导口径；扫描时的同序判定见 runScan）
        if (s && s.ackCallEnabled === 0) lastResult = 'skipped_ack_call_off'
        else if (!phone) lastResult = 'skipped_no_phone'
        else if (quietNow) lastResult = 'skipped_quiet'
      }
      let nextAction: 'auto' | 'manual' | 'stopped'
      if (ackAt || remindStopped) nextAction = 'stopped'
      else if (cfg.maxCalls === 0 || (remindCount > 0 && remindCount >= cfg.maxCalls)) nextAction = 'manual'
      else nextAction = 'auto'
      return {
        orderId: Number(p.orderId),
        supplierId: Number(p.supplierId),
        supplierName: s?.stallName ?? null,
        phoneMasked: maskPhone(phone),
        shopName: o.purchaser?.shopName ?? null,
        createdAt: createdAt.toISOString(),
        minutesUnacked,
        ackAt: ackAt ? ackAt.toISOString() : null,
        remindCount,
        lastRemindAt: lastRemindAt ? lastRemindAt.toISOString() : null,
        lastResult,
        remindStopped,
        quiet: quietNow,
        nextAction,
      }
    })
    return { settings: { ...cfg, quietNow, gateway: await this.gatewayState() }, rows }
  }

  /** 台账查询：每一通（auto/manual）一条；orderId/supplierId 可选过滤 */
  async records(query: { orderId?: string; supplierId?: string }) {
    const where: any = { action: 'SUPPLIER_NOTIFY_CALL' }
    if (query.orderId) where.entityId = BigInt(query.orderId)
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: 500 })
    return rows
      .map((r) => {
        const a = r.after as any
        return {
          id: Number(r.id),
          at: r.createdAt.toISOString(),
          supplierId: a?.supplierId ?? null,
          mode: a?.mode ?? null,
          channel: a?.channel ?? null,
          result: a?.result ?? null,
          callId: a?.callId ?? null,
          dialId: a?.dialId ?? null,
          durationSec: a?.durationSec ?? null, // Hermes 复核收口：BP-1 已写入审计，投影补上
          note: a?.note ?? null,
        }
      })
      .filter((r) => (query.supplierId ? String(r.supplierId) === query.supplierId : true))
  }

  // ────────────────────────────────────────
  // 人工补打 / 自测拨打 / 标记已处理
  // ────────────────────────────────────────

  /** 运营人工补打一通（走同一适配器）；写 mode='manual' 台账 + 审计。不动 remindCount/lastRemindAt（自动次数只由扫描计）。 */
  async manualCall(dto: { orderId: number; supplierId: number }, operatorId: bigint) {
    const orderId = BigInt(dto.orderId)
    const supplierId = BigInt(dto.supplierId)
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, items: { select: { supplierId: true } } },
    })
    if (!order || !order.items.some((it) => it.supplierId === supplierId)) {
      throw new BizException(ErrorCode.PARAM_ERROR, '该订单下没有该供应商的明细')
    }
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, user: { select: { phone: true } } },
    })
    const phone = supplier?.user?.phone || null
    if (!phone) throw new BizException(ErrorCode.PARAM_ERROR, '供应商无手机号，无法拨打')
    const r = await dialTts(phone)
    await this.writeCallRecord({ orderId, supplierId, mode: 'manual', operatorId, ...r })
    return { mode: 'manual' as const, result: r.result, callId: r.callId ?? null, note: r.note ?? null, dryRun: r.result === 'dry_run' }
  }

  /** 运营自测拨打：打给指定号码；dry-run 返回 { dryRun:true } 并写审计（不写台账——无订单上下文） */
  async testCall(dto: { phone: string }, operatorId: bigint) {
    const r = await dialTts(dto.phone)
    await this.audit.log({
      operatorId,
      action: 'SUPPLIER_NOTIFY_TEST_CALL',
      entity: 'supplier_notify',
      entityId: 0,
      after: { phone: maskPhone(dto.phone), result: r.result, callId: r.callId ?? null, note: r.note ?? null, dryRun: r.result === 'dry_run' },
    })
    return { dryRun: r.result === 'dry_run', result: r.result, callId: r.callId ?? null, note: r.note ?? null }
  }

  /** 运营点「已处理」→ remindStopped=1，不再自动拨打 */
  async markHandled(dto: { orderId: number; supplierId: number }, operatorId: bigint) {
    const orderId = BigInt(dto.orderId)
    const supplierId = BigInt(dto.supplierId)
    const before = await this.prisma.orderSupplierAck.findUnique({
      where: { orderId_supplierId: { orderId, supplierId } },
    })
    const ack = await this.prisma.orderSupplierAck.upsert({
      where: { orderId_supplierId: { orderId, supplierId } },
      update: { remindStopped: 1 },
      create: { orderId, supplierId, remindStopped: 1 },
    })
    await this.audit.log({
      operatorId,
      action: 'SUPPLIER_NOTIFY_MARK_HANDLED',
      entity: 'order_supplier_ack',
      entityId: ack.id,
      before: before ? { remindStopped: before.remindStopped } : null,
      after: { remindStopped: 1 },
    })
    return { orderId: Number(orderId), supplierId: Number(supplierId), remindStopped: 1 }
  }

  // ────────────────────────────────────────
  // 供应商自己的开关（卡BN-3 数据源）
  // ────────────────────────────────────────

  async me(userId: bigint) {
    const supplier = await this.prisma.supplier.findUnique({ where: { userId }, select: { id: true, ackCallEnabled: true } })
    if (!supplier) throw new BizException(ErrorCode.NOT_FOUND, '供应商不存在')
    const cfg = await this.getRawConfig()
    // Hermes 复核收口：供应商端「我的」页需要展示"提醒专号 + 请勿回拨、有事拨客服"，
    // 所以这里把两个号码读出来给小程序（专号来自配置，客服号来自既有 platform_config.service_hotline）。
    const hotlineRow = await this.prisma.platformConfig.findUnique({ where: { key: 'service_hotline' } })
    const hotline = typeof hotlineRow?.value === 'string' ? hotlineRow.value : ''
    return {
      ackCallEnabled: supplier.ackCallEnabled === 1,
      thresholdMinutes: cfg.thresholdMinutes,
      reminderPhoneNo: cfg.gatewayPhoneNo || null,
      serviceHotline: hotline || null,
    }
  }

  async updateMe(userId: bigint, dto: { ackCallEnabled: boolean }) {
    const supplier = await this.prisma.supplier.findUnique({ where: { userId }, select: { id: true, ackCallEnabled: true } })
    if (!supplier) throw new BizException(ErrorCode.NOT_FOUND, '供应商不存在')
    const next = dto.ackCallEnabled ? 1 : 0
    await this.prisma.supplier.update({ where: { id: supplier.id }, data: { ackCallEnabled: next } })
    await this.audit.log({
      operatorId: userId,
      action: 'SUPPLIER_NOTIFY_ME',
      entity: 'supplier',
      entityId: supplier.id,
      before: { ackCallEnabled: supplier.ackCallEnabled },
      after: { ackCallEnabled: next },
    })
    return { ackCallEnabled: next === 1 }
  }

  // ────────────────────────────────────────
  // 扫描（cron 每分钟 / scan-once 手动触发共用）
  // ────────────────────────────────────────

  /// 定时入口：默认每分钟；扫描频率固定，阈值不做进 cron 表达式
  @Cron(process.env.SUPPLIER_NOTIFY_CRON || '0 * * * * *', { timeZone: 'Asia/Shanghai' })
  async handleCron() {
    try {
      await this.updateReceipts()
      await this.runScan()
    } catch (e: any) {
      this.logger.error(`催办扫描异常: ${e?.message}`)
    }
  }

  /** 手动触发一次扫描（自测/取证用），返回判定明细统计；卡BO：与 cron 一致先查回执再扫描，新增 receipts 统计字段（原有字段不动） */
  async scanOnce() {
    const receipts = await this.updateReceipts()
    const scan = await this.runScan()
    return { ...scan, receipts }
  }

  /**
   * 扫描核心。返回 { candidates, called, dryRun, real, dispatchPending, skipped: {...}, ... }
   * skipped 细分：belowThreshold / stopped / maxReached / gapWait / quiet / ackCallOff / noPhone / acked
   *
   * 卡BP-1（2026-10-04）：扫描不再固定直拨 —— 按 cfg.channel 分路：
   *   phone  → 只判定、只统计 dispatchPending（登记待派发），不拨不计数；计数+台账由网关 pendingDial 取件时写；
   *   aliyun → 保持原 dialTts 直拨行为（旧通道原样保留）；
   *   off    → 什么都不做。
   * 判定七条与候选装载抽成 loadCandidates / judgePair，与网关取件共用同一份（不许出现第二份判定）。
   */
  async runScan() {
    const zeroSkipped = { belowThreshold: 0, stopped: 0, maxReached: 0, gapWait: 0, quiet: 0, ackCallOff: 0, noPhone: 0, acked: 0 }
    const cfg = await this.getRawConfig()
    const quietNow = cfg.quietEnabled && inQuietWindow(new Date(), cfg.quietStart, cfg.quietEnd)
    const base = {
      enabled: cfg.enabled,
      maxCalls: cfg.maxCalls,
      channel: cfg.channel ?? ('phone' as const),
      quietNow,
      launchAt: cfg.launchAt,
      candidates: 0,
      called: 0,
      dryRun: 0,
      real: 0,
      dispatchPending: 0,
      skipped: { ...zeroSkipped },
    }
    // 两个总刹车：总开关关 / maxCalls=0（只提醒运营、完全不拨）
    if (!cfg.enabled || cfg.maxCalls <= 0) return { ...base, totalOff: true }

    if (this.running) return { ...base, reentered: true }
    this.running = true
    try {
      const ctx = await this.loadCandidates(cfg)
      base.candidates = ctx.pairs.length
      if (!ctx.pairs.length) return { ...base, totalOff: false }

      for (const p of ctx.pairs) {
        const skip = this.judgePair(p, ctx)
        if (skip) { base.skipped[skip]++; continue }
        // 卡BP-1：手机专线通道 —— 扫描命中只登记待派发，等网关来取；不拨不占次数
        if (base.channel === 'phone') { base.dispatchPending++; continue }
        if (base.channel === 'off') continue // 通道关闭：不派发不计数
        // → channel === 'aliyun'：原直拨路径（dry-run 或真拨）
        const phone = ctx.supMap.get(Number(p.supplierId))?.user?.phone || null
        const r = await dialTts(phone!)
        await this.prisma.orderSupplierAck.upsert({
          where: { orderId_supplierId: { orderId: p.orderId, supplierId: p.supplierId } },
          update: { remindCount: { increment: 1 }, lastRemindAt: ctx.now },
          create: { orderId: p.orderId, supplierId: p.supplierId, remindCount: 1, lastRemindAt: ctx.now },
        })
        await this.writeCallRecord({ orderId: p.orderId, supplierId: p.supplierId, mode: 'auto', operatorId: 0n, ...r })
        base.called++
        if (r.result === 'dry_run') base.dryRun++
        else base.real++
      }
      return { ...base, totalOff: false }
    } finally {
      this.running = false
    }
  }

  // ────────────────────────────────────────
  // 卡BP-1：候选装载 + 七条判定（扫描与网关取件共用，唯一一份）
  // ────────────────────────────────────────

  /**
   * 装载候选上下文：备货中(status=30)订单×供应商对（只回看 24h 且 createdAt >= launchAt）、
   * 供应商档案（含手机号/开关）、接单 ack 行、免打扰判定。
   * client 可传事务客户端（pendingDial 在一个事务里完成装载+判定+登记）。
   */
  private async loadCandidates(cfg: SupplierAckReminderConfig, client?: any) {
    const db = client || this.prisma
    const now = new Date()
    const quietNow = cfg.quietEnabled && inQuietWindow(now, cfg.quietStart, cfg.quietEnd)
    const nowMs = now.getTime()
    const since = nowMs - 24 * 3600 * 1000
    // ★ 历史单不拨打：createdAt >= launchAt；只回看 24 小时
    const from = new Date(Math.max(new Date(cfg.launchAt).getTime(), since))
    const orders = await db.order.findMany({
      where: { status: 30, createdAt: { gte: from } },
      select: { id: true, createdAt: true, items: { select: { supplierId: true } }, purchaser: { select: { shopName: true } } },
    })
    const pairs: { orderId: bigint; supplierId: bigint; createdAt: Date; shopName: string | null }[] = []
    for (const o of orders) {
      const sids: bigint[] = [...new Set<bigint>(o.items.map((it: any) => it.supplierId).filter((id: any): id is bigint => id !== null))]
      for (const sid of sids) pairs.push({ orderId: o.id, supplierId: sid, createdAt: o.createdAt, shopName: o.purchaser?.shopName ?? null })
    }
    const supplierIds = [...new Set(pairs.map((p) => p.supplierId))]
    const suppliers = await db.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, stallName: true, ackCallEnabled: true, user: { select: { phone: true } } },
    })
    const supMap = new Map<number, { id: bigint; stallName: string; ackCallEnabled: number; user: { phone: string | null } }>(
      suppliers.map((s: any) => [Number(s.id), s]),
    )
    const acks = await db.orderSupplierAck.findMany({ where: { orderId: { in: orders.map((o: any) => o.id) } } })
    const ackMap = new Map<string, any>(acks.map((a: any) => [`${Number(a.orderId)}:${Number(a.supplierId)}`, a]))
    return { cfg, now, nowMs, quietNow, pairs, supMap, ackMap }
  }

  /** 七条判定（与扫描同序）：返回 null = 通过（可拨打/可派发）；否则返回跳过原因 */
  private judgePair(
    p: { orderId: bigint; supplierId: bigint; createdAt: Date },
    ctx: { cfg: SupplierAckReminderConfig; nowMs: number; quietNow: boolean; ackMap: Map<string, any>; supMap: Map<number, any> },
  ): 'acked' | 'belowThreshold' | 'stopped' | 'maxReached' | 'gapWait' | 'quiet' | 'ackCallOff' | 'noPhone' | null {
    const { cfg, nowMs, quietNow, ackMap, supMap } = ctx
    const ack = ackMap.get(`${Number(p.orderId)}:${Number(p.supplierId)}`)
    if (ack?.ackAt) return 'acked' // 已接单
    const minutes = (nowMs - p.createdAt.getTime()) / 60000
    if (minutes < cfg.thresholdMinutes) return 'belowThreshold' // 未达阈值
    if (ack?.remindStopped === 1) return 'stopped' // 运营已处理
    const remindCount = ack?.remindCount ?? 0
    if (remindCount >= cfg.maxCalls) return 'maxReached' // 达上限 → 转人工
    // 第 2 通间隔从「上次拨打」起算
    if (remindCount >= 1 && ack?.lastRemindAt && nowMs - ack.lastRemindAt.getTime() < cfg.secondGapMinutes * 60000) return 'gapWait'
    if (quietNow) return 'quiet' // 免打扰时段不拨（过点也不回头打）
    const sup = supMap.get(Number(p.supplierId))
    if (sup && sup.ackCallEnabled === 0) return 'ackCallOff' // 供应商自关，不占次数
    if (!sup?.user?.phone) return 'noPhone' // 无手机号：只提醒运营，不占次数
    return null
  }

  // ────────────────────────────────────────
  // 卡BP-1：手机专线网关（派发 / 回报 / 心跳）
  // ────────────────────────────────────────

  /**
   * 供应商冷却判定（Hermes 复核收口）：该供应商在本轮候选里任何一单于 gapMs 内被提醒过 → true。
   * 数据源 = ackMap（仅覆盖回看窗口内的订单），够用；跨窗口的历史提醒由 remindCount/maxCalls 兜。
   */
  private supplierInGap(
    ctx: { nowMs: number; ackMap: Map<string, any> },
    supplierId: number,
    gapMs: number,
  ): boolean {
    const suffix = ':' + supplierId
    for (const [k, a] of ctx.ackMap) {
      if (!k.endsWith(suffix)) continue
      if (a?.lastRemindAt && ctx.nowMs - new Date(a.lastRemindAt).getTime() < gapMs) return true
    }
    return false
  }

  /** 网关取件：在**一个事务**里挑出最多 limit 条候选（判定与扫描共用 judgePair），逐条登记派发：
   *   remindCount += 1、lastRemindAt = now、写台账 SUPPLIER_NOTIFY_CALL
   *   （payload {mode:'auto', channel:'phone', result:'dispatched', dialId, at}，手机号只记 maskPhone）。
   * 返回给网关的数组是**唯一允许明文手机号出现**的地方（网关要拨号）。
   * channel='off' / 'aliyun' ⇒ 永远返回空数组（off=关闭；aliyun 走扫描直拨，不经网关）。
   */
  async pendingDial(limit: number): Promise<PendingDialItem[]> {
    const cfg = await this.getRawConfig()
    // ⚠️ Hermes 复核发现（2026-10-04，生产探针）：网关取件曾绕过「总开关」——
    //    enabled=false / maxCalls=0 只挡住了扫描（runScan），pendingDial 却照派不误。
    //    这里与扫描同口径加回两个总刹车：任一命中 ⇒ 一律不派发（后台一关就是全停）。
    if (!cfg.enabled || cfg.maxCalls <= 0) return []
    if (cfg.channel !== 'phone') return []
    const take = Math.min(Math.max(1, Math.floor(limit) || 5), 50)
    return this.prisma.$transaction(async (tx) => {
      const ctx = await this.loadCandidates(cfg, tx)
      // Hermes 复核收口（端到端实测发现）：同一个供应商名下多张单不能被连打多通 ——
      // ①一轮内同一供应商只取一单（取最久未处理的那张）②该供应商若在 supplierGapMinutes 内被提醒过，整轮跳过。
      const gapMs = (cfg.supplierGapMinutes ?? 10) * 60000
      const ordered = [...ctx.pairs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      const picked: typeof ctx.pairs = []
      const usedSuppliers = new Set<number>()
      for (const p of ordered) {
        if (picked.length >= take) break
        const sidKey = Number(p.supplierId)
        if (usedSuppliers.has(sidKey)) continue // 本轮该供应商已选走一单
        if (this.supplierInGap(ctx, sidKey, gapMs)) continue // 供应商冷却中
        if (this.judgePair(p, ctx) === null) { picked.push(p); usedSuppliers.add(sidKey) }
      }
      const out: PendingDialItem[] = []
      for (const p of picked) {
        const sup = ctx.supMap.get(Number(p.supplierId))
        const phone = sup?.user?.phone || null
        if (!phone) continue // 判定已保证有号；防御再拦
        const dialId = `${p.orderId}_${p.supplierId}_${Date.now()}`
        await tx.orderSupplierAck.upsert({
          where: { orderId_supplierId: { orderId: p.orderId, supplierId: p.supplierId } },
          update: { remindCount: { increment: 1 }, lastRemindAt: ctx.now },
          create: { orderId: p.orderId, supplierId: p.supplierId, remindCount: 1, lastRemindAt: ctx.now },
        })
        await this.audit.log(
          {
            operatorId: 0n,
            action: 'SUPPLIER_NOTIFY_CALL',
            entity: 'supplier_notify',
            entityId: p.orderId,
            after: {
              orderId: Number(p.orderId),
              supplierId: Number(p.supplierId),
              mode: 'auto',
              channel: 'phone',
              result: 'dispatched',
              dialId,
              phone: maskPhone(phone), // 台账只记脱敏号码
              at: ctx.now.toISOString(),
            },
          },
          tx,
        )
        out.push({
          dialId,
          orderId: Number(p.orderId),
          supplierId: Number(p.supplierId),
          phone, // 明文仅在此响应里
          supplierName: sup?.stallName ?? null,
          shopName: p.shopName ?? null,
          minutesUnacked: Math.floor((ctx.nowMs - p.createdAt.getTime()) / 60000),
          ringSeconds: cfg.ringSeconds,
          hangupAfterAnswerSeconds: cfg.hangupAfterAnswerSeconds,
        })
      }
      return out
    })
  }

  /** 网关回报拨打结果：result ∈ dispatched | connected | no_answer | failed（枚举由网关 DTO 校验，非法 → 400） */
  async reportResult(dto: { dialId: string; result: string; durationSec?: number | null; cause?: string | null }) {
    // Hermes 复核收口：dialId 形如 `${orderId}_${supplierId}_${ts}` —— 回报行也要带归属，
    // 否则台账里这一行 supplierId 为空，按供应商筛记录时会漏掉它（端到端实测发现）。
    const m = /^(\d+)_(\d+)_\d+$/.exec(String(dto.dialId || ''))
    const orderId = m ? BigInt(m[1]) : null
    const supplierId = m ? BigInt(m[2]) : null
    await this.audit.log({
      operatorId: 0n,
      action: 'SUPPLIER_NOTIFY_CALL',
      entity: 'supplier_notify',
      entityId: orderId ?? 0n,
      after: {
        orderId: orderId ? Number(orderId) : null,
        supplierId: supplierId ? Number(supplierId) : null,
        mode: 'auto',
        channel: 'phone',
        dialId: dto.dialId,
        result: dto.result,
        durationSec: dto.durationSec ?? null,
        cause: dto.cause ?? null,
        at: new Date().toISOString(),
      },
    })
    return { ok: true, dialId: dto.dialId, result: dto.result }
  }

  /** 网关心跳：{at} 写 platform_config.supplier_notify_gateway_state；180 秒内有值 = 在线 */
  async heartbeat() {
    const at = new Date().toISOString()
    await this.prisma.platformConfig.upsert({
      where: { key: SUPPLIER_NOTIFY_GATEWAY_STATE_KEY },
      update: { value: { at } },
      create: { key: SUPPLIER_NOTIFY_GATEWAY_STATE_KEY, value: { at } },
    })
    return { ok: true, at }
  }

  /** 写一通拨打台账（= 一条 audit_log：action=SUPPLIER_NOTIFY_CALL，after 携带明细） */
  private async writeCallRecord(input: {
    orderId: bigint; supplierId: bigint; mode: 'auto' | 'manual'; operatorId: bigint
    result: string; callId?: string; note?: string
  }) {
    await this.audit.log({
      operatorId: input.operatorId,
      action: 'SUPPLIER_NOTIFY_CALL',
      entity: 'supplier_notify',
      entityId: input.orderId,
      after: {
        orderId: Number(input.orderId),
        supplierId: Number(input.supplierId),
        mode: input.mode,
        result: input.result,
        callId: input.callId ?? null,
        note: input.note ?? null,
        dryRun: input.result === 'dry_run',
        at: new Date().toISOString(),
      },
    })
  }

  /**
   * 回执查询：result='initiated' 且发起已过 90 秒的台账 → QueryCallDetailByCallId →
   * 更新为 connected / no_answer / failed（字段名以实测为准，查询失败保留 initiated 不丢台账）。
   *
   * 卡BO（2026-10-02）窗口黑洞修复：查询层用 JSON 路径条件过滤 result='initiated'
   * （Prisma 5.22 + MySQL 8 支持 after: { path, equals }），已完结的老行不再占满 take:200
   * 的窗口、把新 initiated 行挤出查询（旧实现取「48h 内最早 200 条」，拨打密度上来后
   * 新台账永远拿不到回执）。代码侧保留 result/callId 判定作为最终口径（callId 缺失
   * 无法用 path 条件表达）。dry-run（四值未配置）下 queryCallDetail 返回空对象 →
   * 只统计、不写库，零副作用。返回统计供 scan-once 透出（cron 忽略返回值，行为不变）。
   */
  private async updateReceipts(): Promise<{ windowRows: number; initiatedSeen: number; queried: number; updated: number }> {
    const cutoff = new Date(Date.now() - 90 * 1000)
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: 'SUPPLIER_NOTIFY_CALL',
        createdAt: { lt: cutoff, gte: new Date(Date.now() - 48 * 3600 * 1000) },
        after: { path: '$.result', equals: 'initiated' }, // 卡BO：查询层只取未完结行，老行不再挡窗口
      },
      orderBy: { id: 'asc' },
      take: 200,
    })
    const stats = { windowRows: rows.length, initiatedSeen: 0, queried: 0, updated: 0 }
    for (const row of rows) {
      const a = row.after as any
      if (a?.result !== 'initiated' || !a?.callId) continue // 最终口径：未完结 = initiated 且有 callId
      stats.initiatedSeen++
      const at = a.at ? new Date(a.at) : row.createdAt
      // QueryDate = 发起日（上海时区 yyyyMMdd）
      const ymd = at.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(/-/g, '')
      const detail = await queryCallDetail(a.callId, ymd) // dry-run 环境返回 {}（不发请求、零副作用）
      stats.queried++
      if (detail.result) {
        await this.prisma.auditLog.update({
          where: { id: row.id },
          data: { after: { ...a, result: detail.result, statusCode: detail.statusCode ?? null, receiptCheckedAt: new Date().toISOString() } },
        })
        stats.updated++
      }
    }
    return stats
  }
}
