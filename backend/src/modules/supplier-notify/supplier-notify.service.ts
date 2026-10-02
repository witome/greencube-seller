import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import {
  DEFAULT_SUPPLIER_ACK_REMINDER,
  SUPPLIER_ACK_REMINDER_KEY,
  SupplierAckReminderConfig,
  inQuietWindow,
  validateReminderConfig,
} from './notify-config'
import { dialTts, isVmsConfigured, maskPhone, queryCallDetail } from './vms.adapter'

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

  /** GET/PUT config 的统一返回：{ ...配置, vmsConfigured, callerNumber, templateId, launchAt, todayStats } */
  async getAdminConfig() {
    const cfg = await this.getRawConfig()
    return {
      ...cfg,
      vmsConfigured: isVmsConfigured(),
      callerNumber: process.env.ALIYUN_VMS_CALLER_NUMBER || null, // 可回显（非密钥）
      templateId: process.env.ALIYUN_VMS_TTS_CODE || null, // 可回显（非密钥）；AK 绝不回显
      todayStats: await this.todayStats(cfg),
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
    if (!pairs.length) return { settings: { ...cfg, quietNow }, rows: [] }

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
    return { settings: { ...cfg, quietNow }, rows }
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
          result: a?.result ?? null,
          callId: a?.callId ?? null,
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
    return { ackCallEnabled: supplier.ackCallEnabled === 1, thresholdMinutes: cfg.thresholdMinutes }
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

  /** 手动触发一次扫描（自测/取证用），返回判定明细统计 */
  async scanOnce() {
    return this.runScan()
  }

  /**
   * 扫描核心。返回 { candidates, called, dryRun, real, skipped: {...}, ... }
   * skipped 细分：belowThreshold / stopped / maxReached / gapWait / quiet / ackCallOff / noPhone / acked
   */
  async runScan() {
    const zeroSkipped = { belowThreshold: 0, stopped: 0, maxReached: 0, gapWait: 0, quiet: 0, ackCallOff: 0, noPhone: 0, acked: 0 }
    const cfg = await this.getRawConfig()
    const now = new Date()
    const quietNow = cfg.quietEnabled && inQuietWindow(now, cfg.quietStart, cfg.quietEnd)
    const base = {
      enabled: cfg.enabled,
      maxCalls: cfg.maxCalls,
      quietNow,
      launchAt: cfg.launchAt,
      candidates: 0,
      called: 0,
      dryRun: 0,
      real: 0,
      skipped: { ...zeroSkipped },
    }
    // 两个总刹车：总开关关 / maxCalls=0（只提醒运营、完全不拨）
    if (!cfg.enabled || cfg.maxCalls <= 0) return { ...base, totalOff: true }

    if (this.running) return { ...base, reentered: true }
    this.running = true
    try {
      const nowMs = now.getTime()
      const since = nowMs - 24 * 3600 * 1000
      const launchMs = new Date(cfg.launchAt).getTime()
      // ★ 历史单不拨打：createdAt >= launchAt；只回看 24 小时
      const from = new Date(Math.max(launchMs, since))
      const orders = await this.prisma.order.findMany({
        where: { status: 30, createdAt: { gte: from } },
        select: { id: true, createdAt: true, items: { select: { supplierId: true } } },
      })

      const pairs: { orderId: bigint; supplierId: bigint; createdAt: Date }[] = []
      for (const o of orders) {
        const sids = [...new Set(o.items.map((it) => it.supplierId).filter((id): id is bigint => id !== null))]
        for (const sid of sids) pairs.push({ orderId: o.id, supplierId: sid, createdAt: o.createdAt })
      }
      base.candidates = pairs.length
      if (!pairs.length) return { ...base, totalOff: false }

      const supplierIds = [...new Set(pairs.map((p) => p.supplierId))]
      const suppliers = await this.prisma.supplier.findMany({
        where: { id: { in: supplierIds } },
        select: { id: true, ackCallEnabled: true, user: { select: { phone: true } } },
      })
      const supMap = new Map(suppliers.map((s) => [Number(s.id), s]))
      const acks = await this.prisma.orderSupplierAck.findMany({ where: { orderId: { in: orders.map((o) => o.id) } } })
      const ackMap = new Map(acks.map((a) => [`${Number(a.orderId)}:${Number(a.supplierId)}`, a]))

      for (const p of pairs) {
        const key = `${Number(p.orderId)}:${Number(p.supplierId)}`
        const ack = ackMap.get(key)
        if (ack?.ackAt) { base.skipped.acked++; continue } // 已接单
        const minutes = (nowMs - p.createdAt.getTime()) / 60000
        if (minutes < cfg.thresholdMinutes) { base.skipped.belowThreshold++; continue } // 未达阈值
        if (ack?.remindStopped === 1) { base.skipped.stopped++; continue } // 运营已处理
        const remindCount = ack?.remindCount ?? 0
        if (remindCount >= cfg.maxCalls) { base.skipped.maxReached++; continue } // 达上限 → 转人工
        // 第 2 通间隔从「上次拨打」起算
        if (remindCount >= 1 && ack?.lastRemindAt && nowMs - ack.lastRemindAt.getTime() < cfg.secondGapMinutes * 60000) {
          base.skipped.gapWait++
          continue
        }
        if (quietNow) { base.skipped.quiet++; continue } // 免打扰时段不拨（过点也不回头打）
        const sup = supMap.get(Number(p.supplierId))
        if (sup && sup.ackCallEnabled === 0) { base.skipped.ackCallOff++; continue } // 供应商自关，不占次数
        const phone = sup?.user?.phone || null
        if (!phone) { base.skipped.noPhone++; continue } // 无手机号：只提醒运营，不占次数

        // → 拨打（dry-run 或真拨）
        const r = await dialTts(phone)
        await this.prisma.orderSupplierAck.upsert({
          where: { orderId_supplierId: { orderId: p.orderId, supplierId: p.supplierId } },
          update: { remindCount: { increment: 1 }, lastRemindAt: now },
          create: { orderId: p.orderId, supplierId: p.supplierId, remindCount: 1, lastRemindAt: now },
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
   */
  private async updateReceipts() {
    if (!isVmsConfigured()) return // dry-run 环境没有真拨，无需回执
    const cutoff = new Date(Date.now() - 90 * 1000)
    const rows = await this.prisma.auditLog.findMany({
      where: { action: 'SUPPLIER_NOTIFY_CALL', createdAt: { lt: cutoff, gte: new Date(Date.now() - 48 * 3600 * 1000) } },
      orderBy: { id: 'asc' },
      take: 200,
    })
    for (const row of rows) {
      const a = row.after as any
      if (a?.result !== 'initiated' || !a?.callId) continue
      const at = a.at ? new Date(a.at) : row.createdAt
      // QueryDate = 发起日（上海时区 yyyyMMdd）
      const ymd = at.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(/-/g, '')
      const detail = await queryCallDetail(a.callId, ymd)
      if (detail.result) {
        await this.prisma.auditLog.update({
          where: { id: row.id },
          data: { after: { ...a, result: detail.result, statusCode: detail.statusCode ?? null, receiptCheckedAt: new Date().toISOString() } },
        })
      }
    }
  }
}
