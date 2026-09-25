import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { ServiceFeeConfigDto, GenerateSettlementDto } from './dto/finance.dto'
import { DeliveryFeeConfigDto, PayQrDto } from './dto/delivery-fee.dto'
import { HomeContentDto } from './dto/home-content.dto'
import { receivableAmount, round2 } from '../../common/utils/amount.util'

/**
 * 服务费配置写入失败 → 友好业务错误（2026-09-19 卡J）
 *
 * 抽成独立导出函数的原因：正常写入路径走 `INSERT ... ON DUPLICATE KEY UPDATE`，
 * 并发下第二个请求会**自动走更新语义**、不会抛错，所以冲突分支在真实链路上无法复现。
 * 独立导出后，验证脚本可以用**真实的 P2002 异常**（直接打库触发）来证明这段映射确实生效。
 *
 * 返回 null 表示「不是唯一键冲突」，调用方应原样抛出（真实故障不该被吞掉）。
 */
export function serviceFeeWriteError(e: unknown): BizException | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    return new BizException(ErrorCode.PARAM_ERROR, '该费率配置已存在，请刷新后重试')
  }
  return null
}

@Injectable()
export class AdminFinanceService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /// 读取全局默认费率
  private async getGlobalRate(): Promise<number> {
    const cfg = await this.prisma.serviceFeeConfig.findFirst({ where: { categoryId: null } })
    return cfg ? Number(cfg.rate) : Number(process.env.DEFAULT_SERVICE_FEE_RATE || 0.05)
  }

  /// 读取费率配置（全局 + 分类覆盖），返回 { globalRate, categoryRates, categoryList }
  private async loadRateConfig() {
    const configs = await this.prisma.serviceFeeConfig.findMany()
    const global = configs.find((c) => c.categoryId === null)
    const globalRate = global ? Number(global.rate) : Number(process.env.DEFAULT_SERVICE_FEE_RATE || 0.05)
    const categoryRates = new Map<number, number>()
    const categoryList: { categoryId: number; categoryName: string; rate: number }[] = []
    for (const c of configs) {
      if (c.categoryId !== null) {
        categoryRates.set(Number(c.categoryId), Number(c.rate))
        categoryList.push({ categoryId: Number(c.categoryId), categoryName: '', rate: Number(c.rate) })
      }
    }
    // 补分类名
    if (categoryList.length) {
      const cats = await this.prisma.category.findMany({ where: { id: { in: categoryList.map((c) => BigInt(c.categoryId)) } } })
      const nameMap = new Map(cats.map((c) => [Number(c.id), c.name]))
      categoryList.forEach((c) => { c.categoryName = nameMap.get(c.categoryId) ?? '' })
    }
    return { globalRate, categoryRates, categoryList }
  }

  // ────────────────────────────────────────
  // 读取服务费配置列表（全局 + 分类覆盖）
  // ────────────────────────────────────────
  async serviceFeeConfigs() {
    const { globalRate, categoryList } = await this.loadRateConfig()
    return { globalRate, categories: categoryList }
  }

  // ────────────────────────────────────────
  // 服务费调整试算
  // ────────────────────────────────────────
  async serviceFeePreview(query: { rate?: string; period?: string }) {
    const rate = query.rate !== undefined ? Number(query.rate) : await this.getGlobalRate()
    const period = query.period || new Date().toISOString().slice(0, 7)

    const items = await this.prisma.orderItem.findMany({
      where: {
        supplierId: { not: null },
        qtyAccepted: { not: null },
        order: {
          deliveryDate: { gte: new Date(period + '-01'), lt: new Date(period + '-31') },
          status: { in: [60, 70, 90] },
        },
      },
    })

    const gross = items.reduce((s, i) => s + Number(i.qtyAccepted) * Number(i.supplyPrice), 0)
    const fee = gross * rate
    const net = gross - fee
    const supplierCount = new Set(items.map((i) => Number(i.supplierId))).size

    return {
      rate,
      affectedSuppliers: supplierCount,
      sampleGross: Math.round(gross * 100) / 100,
      sampleFee: Math.round(fee * 100) / 100,
      sampleNet: Math.round(net * 100) / 100,
      note: '不追溯已生成结算单，仅对新结算生效',
    }
  }

  // ────────────────────────────────────────
  // 保存服务费配置（不追溯已生成结算单）
  // ────────────────────────────────────────
  async serviceFeeConfig(userId: bigint, dto: ServiceFeeConfigDto) {
    const categoryId = dto.categoryId ?? null

    // before 仅用于审计留痕（口径与原实现逐字一致）
    const existing = await this.prisma.serviceFeeConfig.findFirst({ where: { categoryId } })
    const before = existing ? { rate: Number(existing.rate) } : null

    // 原子写入（2026-09-19 卡J，堵住并发双写）：
    // 原实现是 findFirst → create 两步，**不是原子的** —— 两个并发请求同时读到「无配置」
    // 就会各插一条；最要紧的是全局那条（category_id IS NULL），而 MySQL 唯一索引不约束 NULL，
    // 所以光加 @@unique([categoryId]) 挡不住它（那是「看起来对、其实没用」的修复）。
    //
    // 现由迁移 20260919173000_add_service_fee_unique_global 在库层兜底：
    // global_key = COALESCE(category_id, 0) 生成列 + 唯一键 uk_service_fee_config_global_key。
    // 这里再用**单条** SQL 写入，把「判存在 + 写」压成一步：并发下第二个请求由
    // ON DUPLICATE KEY UPDATE 自动走**更新语义**（要求里更优的那种处理），
    // 既不会产生第二行，也不会抛错、不会裸 500。
    //
    // 走原生 SQL 的原因：global_key 是生成列，Prisma schema 表达不了（声明了就报 3105），
    // 因此 Prisma 的 upsert 没有可用的唯一选择器（where 必须是 unique 字段）。
    // 不用 VALUES() 函数，把参数写两遍：避免 MySQL 8.0.20+ 的弃用告警，且 5.7 也兼容。
    //
    // ⚠️ 时间列用 **UTC_TIMESTAMP(3)**，不是 NOW(3)**（2026-09-25 统一，卡C）：
    //    本机 MySQL 会话时区是 SYSTEM(+08)，`NOW(3)` 给的是**本地时间**；
    //    而 Prisma 读写 `datetime(3)` 一律按 **UTC** 解释 —— 用 NOW(3) 写进去的值会被
    //    当成 UTC 读，**整列偏 8 小时**（实测：写完后 updated_at 比 UTC 快 479 分钟，
    //    运营在后台看到的是「8 小时后更新的」）。
    //    这条与 demand 模块同一口径，全仓原生 SQL 写时间列一律 UTC_TIMESTAMP(3)。
    let savedId: bigint
    try {
      await this.prisma.$executeRaw`
        INSERT INTO service_fee_config (category_id, rate, updated_by, updated_at)
        VALUES (${categoryId}, ${dto.rate}, ${userId}, UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
          rate = ${dto.rate},
          updated_by = ${userId},
          updated_at = UTC_TIMESTAMP(3)
      `

      // 写入后回读该分类的唯一一行（唯一键保证至多一行）
      const row = await this.prisma.serviceFeeConfig.findFirst({
        where: { categoryId },
        select: { id: true },
      })
      if (!row) {
        throw new BizException(ErrorCode.INTERNAL_ERROR, '服务费配置写入后未读到记录，请重试')
      }
      savedId = row.id
    } catch (e) {
      // 兜底：正常路径（ON DUPLICATE KEY UPDATE）到不了这里。
      // 万一唯一键冲突以 P2002 冒出来 → 友好业务错误码，绝不裸 500；
      // 其它异常原样抛出（真实故障不该被吞）。
      const mapped = serviceFeeWriteError(e)
      if (mapped) throw mapped
      throw e
    }

    await this.audit.log({
      operatorId: userId,
      action: 'UPDATE_SERVICE_FEE',
      entity: 'service_fee_config',
      entityId: savedId,
      before: before ? { categoryId, ...before } : { categoryId, rate: null },
      after: { categoryId, rate: dto.rate },
    })

    return { rate: dto.rate, categoryId }
  }

  // ────────────────────────────────────────
  // 结算单列表
  // ────────────────────────────────────────
  async settlements(query: { period?: string }) {
    const where: any = {}
    if (query.period) where.period = query.period

    const rows = await this.prisma.settlement.findMany({
      where,
      orderBy: { period: 'desc' },
      include: { supplier: true },
    })

    return rows.map((s) => ({
      settlementId: Number(s.id),
      period: s.period,
      supplierId: Number(s.supplierId),
      supplierName: s.supplier.stallName,
      grossAmount: Number(s.grossAmount),
      serviceFeeRate: Number(s.serviceFeeRate),
      serviceFee: Number(s.serviceFee),
      netAmount: Number(s.netAmount),
      status: s.status,
    }))
  }

  // ────────────────────────────────────────
  // 生成结算单（决策 3：基数 = Σ 验收数量 × 供货价）
  // ⚠️ 服务费按分类费率覆盖：商品所属分类有覆盖用覆盖，否则用全局默认
  // ────────────────────────────────────────
  async generate(dto: GenerateSettlementDto, operatorId?: bigint) {
    const period = dto.period
    const { globalRate, categoryRates } = await this.loadRateConfig()

    // 该期所有已验收且已分配供应商的明细（含商品分类，用于取分类费率）
    const items = await this.prisma.orderItem.findMany({
      where: {
        supplierId: { not: null },
        qtyAccepted: { not: null },
        order: {
          deliveryDate: { gte: new Date(period + '-01'), lt: new Date(period + '-31') },
          status: { in: [60, 70, 90] }, // 已送达/已完成/已结算
        },
      },
      include: { product: true },
    })

    // 按供应商汇总 gross + fee（逐项按商品分类费率）
    const bySupplier = new Map<bigint, { gross: number; fee: number }>()
    for (const it of items) {
      const gross = Number(it.qtyAccepted) * Number(it.supplyPrice)
      const rate = categoryRates.get(Number(it.product.categoryId)) ?? globalRate
      const fee = gross * rate
      const cur = bySupplier.get(it.supplierId!) || { gross: 0, fee: 0 }
      cur.gross += gross
      cur.fee += fee
      bySupplier.set(it.supplierId!, cur)
    }

    let generated = 0
    // 全部结算单 upsert + 审计 同一事务（2026-09-15 涉钱收口）：结算必须「要么全成、要么全不成」，
    // 任一供应商写失败则整批回滚，绝不留下部分供应商已结算、部分未结算的中间态
    await this.prisma.$transaction(async (tx) => {
      for (const [supplierId, v] of bySupplier) {
        const net = v.gross - v.fee
        const avgRate = v.gross > 0 ? v.fee / v.gross : globalRate
        await tx.settlement.upsert({
          where: { supplierId_period: { supplierId, period } },
          update: {
            grossAmount: Math.round(v.gross * 100) / 100,
            serviceFeeRate: Math.round(avgRate * 10000) / 10000,
            serviceFee: Math.round(v.fee * 100) / 100,
            netAmount: Math.round(net * 100) / 100,
          },
          create: {
            supplierId,
            period,
            grossAmount: Math.round(v.gross * 100) / 100,
            serviceFeeRate: Math.round(avgRate * 10000) / 10000,
            serviceFee: Math.round(v.fee * 100) / 100,
            netAmount: Math.round(net * 100) / 100,
            status: 0,
          },
        })
        generated++
      }

      if (operatorId) {
        await this.audit.log(
          {
            operatorId,
            action: 'GENERATE_SETTLEMENT',
            entity: 'settlement',
            entityId: 0,
            before: { period },
            after: { period, generated, globalRate },
          },
          tx,
        )
      }
    })

    return { period, generated, globalRate }
  }

  // ────────────────────────────────────────
  // 运费规则（满额免运费 / 次日达免运费 / 加急运费）
  // ────────────────────────────────────────
  async getDeliveryFeeConfig() {
    const cfg = await this.prisma.platformConfig.findUnique({ where: { key: 'delivery_fee' } })
    const value = (cfg?.value as any) || { fee: 5, freeThreshold: 100, freeNextDay: true, urgentFee: 0, urgentFreeThreshold: 0 }
    return {
      fee: Number(value.fee ?? 5),
      freeThreshold: Number(value.freeThreshold ?? 100),
      freeNextDay: !!value.freeNextDay,
      urgentFee: Number(value.urgentFee ?? 0),
      urgentFreeThreshold: Number(value.urgentFreeThreshold ?? 0),
    }
  }

  async updateDeliveryFeeConfig(userId: bigint, dto: DeliveryFeeConfigDto) {
    const value = { fee: dto.fee, freeThreshold: dto.freeThreshold, freeNextDay: dto.freeNextDay, urgentFee: dto.urgentFee, urgentFreeThreshold: dto.urgentFreeThreshold }
    await this.prisma.platformConfig.upsert({
      where: { key: 'delivery_fee' },
      update: { value },
      create: { key: 'delivery_fee', value },
    })
    await this.audit.log({
      operatorId: userId,
      action: 'UPDATE_DELIVERY_FEE',
      entity: 'platform_config',
      entityId: 0,
      after: value,
    })
    return value
  }

  // ────────────────────────────────────────
  // 收款二维码（货到付款）：运营后台上传，配送员端展示供客户扫码付款
  // ────────────────────────────────────────
  async getPayQr() {
    const cfg = await this.prisma.platformConfig.findUnique({ where: { key: 'pay_qr' } })
    const value = (cfg?.value as any) || {}
    return { url: value.url || null }
  }

  async updatePayQr(userId: bigint, dto: PayQrDto) {
    const value = { url: dto.url }
    await this.prisma.platformConfig.upsert({
      where: { key: 'pay_qr' },
      update: { value },
      create: { key: 'pay_qr', value },
    })
    await this.audit.log({
      operatorId: userId,
      action: 'UPDATE_PAY_QR',
      entity: 'platform_config',
      entityId: 0,
      after: value,
    })
    return value
  }

  // ────────────────────────────────────────
  // 首页内容（2026-09-11 任务卡：首页三处接口化）
  // 复用 platform_config KV 表，三个 key：
  //   home_delivery_note   { title, subtitle }
  //   home_notice          { enabled, text }
  //   home_recommendations number[]（商品 id 有序数组）
  // schema 零改动（PlatformConfig 即通用 KV 表）
  // ────────────────────────────────────────
  async getHomeContent() {
    const keys = await this.prisma.platformConfig.findMany({
      where: { key: { in: ['home_delivery_note', 'home_notice', 'home_recommendations'] } },
    })
    const map = new Map(keys.map((k) => [k.key, k.value as any]))
    const note = map.get('home_delivery_note') || {}
    const notice = map.get('home_notice') || {}
    const recs = map.get('home_recommendations')
    return {
      deliveryNote: {
        title: typeof note.title === 'string' ? note.title : '',
        subtitle: typeof note.subtitle === 'string' ? note.subtitle : '',
      },
      notice: {
        enabled: !!notice.enabled,
        text: typeof notice.text === 'string' ? notice.text : '',
      },
      recommendationIds: Array.isArray(recs) ? recs.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [],
    }
  }

  async updateHomeContent(userId: bigint, dto: HomeContentDto) {
    const noteValue = { title: dto.deliveryNote.title, subtitle: dto.deliveryNote.subtitle || '' }
    const noticeValue = { enabled: !!dto.notice.enabled, text: dto.notice.text || '' }
    const recValue = dto.recommendationIds
    await this.prisma.$transaction([
      this.prisma.platformConfig.upsert({
        where: { key: 'home_delivery_note' },
        update: { value: noteValue },
        create: { key: 'home_delivery_note', value: noteValue },
      }),
      this.prisma.platformConfig.upsert({
        where: { key: 'home_notice' },
        update: { value: noticeValue },
        create: { key: 'home_notice', value: noticeValue },
      }),
      this.prisma.platformConfig.upsert({
        where: { key: 'home_recommendations' },
        update: { value: recValue },
        create: { key: 'home_recommendations', value: recValue },
      }),
    ])
    // 铁律 3：配置变更留痕（一次保存记一条，after 记三项合并值）
    await this.audit.log({
      operatorId: userId,
      action: 'UPDATE_HOME_CONTENT',
      entity: 'platform_config',
      entityId: 0,
      after: { ...noteValue, ...noticeValue, recommendationIds: recValue },
    })
    return this.getHomeContent()
  }

  /// ─── 每日对账（只读，绝不写入）────────────────────────────────
  /// 口径（与拍板一致）：
  /// 1.「一天」按送达日 order.deliveryDate；只统计已送达(60)/已完成(70)
  /// 2. 线上支付实收 = payment_record 中 status=1（已支付）流水金额合计
  /// 3. 货到付款实收 = order.payProof 存在（photos 为空视为无凭证，与核销口径一致）
  /// 4. 应收单笔金额 = amountFinal ?? (amountOrdered + deliveryFee)
  ///    —— 与 courier.service.ts COD 金额口径一致（amountFinal 已含运费，
  ///       未核单称重的兜底 = amountOrdered + deliveryFee）
  /// 5. 应付供应商（参考值）= Σ qtyAccepted × supplyPrice（仅两项均有值的明细；
  ///    正式结算单仍按月由既有 generate 逻辑生成，此处不参与）
  /// 6. 毛利粗算 = 应收 − 应付供应商参考值（不随收款进度变化；未扣配送成本/平台服务费/退款）
  async dailyReconciliation(query: { date?: string }) {
    const dateStr =
      query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)
        ? query.date
        : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) // 默认今天（东八区）
    const day = new Date(`${dateStr}T00:00:00.000Z`)

    const orders = await this.prisma.order.findMany({
      where: { deliveryDate: day, status: { in: [60, 70] } },
      include: {
        purchaser: { select: { shopName: true } },
        items: { select: { qtyAccepted: true, supplyPrice: true } },
        payments: { select: { amount: true, status: true } },
      },
      orderBy: { id: 'asc' },
    })

    // 订单 → 配送员映射（delivery_task.stationList 中 type==='deliver' 的站点）
    // DeliveryTask 无 courier 关系字段，批量查配送员姓名（复用 recentTasks 的 user.phone 口径）
    const tasks = await this.prisma.deliveryTask.findMany({ orderBy: { id: 'desc' }, take: 500 })
    const courierIds = [...new Set(tasks.map((t) => Number(t.courierId)))]
    const couriers = await this.prisma.courier.findMany({
      where: { id: { in: courierIds.map((id) => BigInt(id)) } },
      include: { user: true },
    })
    const nameMap = new Map(couriers.map((c) => [Number(c.id), c.user?.name || c.user?.phone || `配送员#${c.id}`]))
    // 姓名显示口径（2026-09-19 拍板修正）：原实现只取 user.phone，后台「配送员」列全显示手机号；
    // 改为 user.name 优先 → name 为空回退 user.phone → 都没有显示 配送员#<courierId>
    const courierOfOrder = new Map<number, { courierId: number; courierName: string }>()
    for (const t of tasks) {
      const stations = Array.isArray(t.stationList) ? (t.stationList as any[]) : []
      for (const s of stations) {
        if (s && s.type === 'deliver' && s.orderId !== undefined && !courierOfOrder.has(Number(s.orderId))) {
          courierOfOrder.set(Number(s.orderId), {
            courierId: Number(t.courierId),
            courierName: nameMap.get(Number(t.courierId)) || `配送员#${t.courierId}`,
          })
        }
      }
    }

    // 口径唯一实现（卡T 2026-09-21 抽出）：见 common/utils/amount.util.ts
    // —— 履约页「金额」列与本页「应收」共用同一函数，杜绝两页两个数
    const r2 = round2
    const amountOf = receivableAmount
    const hasProof = (o: any) => {
      if (!o.payProof) return false
      const photos = (o.payProof as any).photos
      return Array.isArray(photos) ? photos.length > 0 : true
    }
    const timeWindowText = (w: number) => ({ 1: '早', 2: '中', 3: '晚' }[w] ?? String(w))

    const summary = { receivable: 0, received: 0, unpaid: 0, supplierPayable: 0, grossProfit: 0 }
    let codUnpaidCount = 0
    let wechatPaidCount = 0
    let codPaidCount = 0
    let itemsMissingSupplyPrice = 0
    let itemsMissingQtyAccepted = 0
    const unpaidList: any[] = []
    // 卡T（2026-09-21）：当天订单清单（默认全量），供对账页就地看每单收款状态与凭证
    const orderList: any[] = []
    const courierAgg = new Map<string, any>()
    const shopAgg = new Map<string, any>()
    const bump = (map: Map<string, any>, key: string, seed: any) => {
      if (!map.has(key)) map.set(key, { orderCount: 0, receivable: 0, received: 0, unpaid: 0, ...seed })
      return map.get(key)
    }

    for (const o of orders) {
      const receivable = amountOf(o)
      let received = 0
      if (o.payMethod === 2) {
        if (hasProof(o)) {
          received = receivable
          codPaidCount++
        } else {
          codUnpaidCount++
        }
      } else if (o.payMethod === 1) {
        received = o.payments.filter((p) => p.status === 1).reduce((s, p) => s + Number(p.amount), 0)
        if (received > 0) wechatPaidCount++
      }
      const unpaid = receivable - received

      summary.receivable += receivable
      summary.received += received
      summary.unpaid += unpaid

      // 应付供应商参考值
      for (const it of o.items) {
        if (it.qtyAccepted == null) {
          itemsMissingQtyAccepted++
          continue
        }
        if (it.supplyPrice == null) {
          itemsMissingSupplyPrice++
          continue
        }
        summary.supplierPayable += Number(it.qtyAccepted) * Number(it.supplyPrice)
      }

      const courier = courierOfOrder.get(Number(o.id))
      const c = bump(courierAgg, String(courier?.courierId ?? 0), {
        courierId: courier?.courierId ?? null,
        courierName: courier?.courierName ?? '未指派',
      })
      c.orderCount++
      c.receivable += receivable
      c.received += received
      c.unpaid += unpaid

      const shop = bump(shopAgg, o.purchaser?.shopName ?? '未知餐馆', { shopName: o.purchaser?.shopName ?? '未知餐馆' })
      shop.orderCount++
      shop.receivable += receivable
      shop.received += received
      shop.unpaid += unpaid

      if (o.payMethod === 2 && !hasProof(o)) {
        unpaidList.push({
          orderId: Number(o.id),
          shopName: o.purchaser?.shopName ?? '未知餐馆',
          courierName: courier?.courierName ?? '未指派',
          amount: r2(receivable),
          deliveryDate: dateStr,
          timeWindow: timeWindowText(o.timeWindow),
        })
      }

      // ── 卡T（2026-09-21）：当天订单清单（每单收款状态 + 凭证），判定口径与上方 summary 完全同源 ──
      const wechatPaidAmount = r2(
        o.payments.filter((p) => p.status === 1).reduce((s, p) => s + Number(p.amount), 0),
      )
      const proof = hasProof(o)
      let payStatus: string
      let payStatusText: string
      if (o.payMethod === 1 && wechatPaidAmount > 0) {
        payStatus = 'wechat_paid'
        payStatusText = '微信已付'
      } else if (proof) {
        payStatus = 'cod_cleared'
        payStatusText = '货到付款已核销'
      } else if (o.buyerPaidClaimAt) {
        payStatus = 'buyer_claimed'
        payStatusText = '客户称已付（未核销）'
      } else {
        payStatus = 'unpaid'
        payStatusText = '未收'
      }
      orderList.push({
        orderId: Number(o.id),
        shopName: o.purchaser?.shopName ?? '未知餐馆',
        courierName: courier?.courierName ?? '未指派',
        deliveryDate: dateStr,
        timeWindow: timeWindowText(o.timeWindow),
        orderStatus: o.status,
        orderStatusText: o.status === 70 ? '已完成' : '已送达',
        amountOrdered: r2(Number(o.amountOrdered)),
        deliveryFee: r2(Number(o.deliveryFee)),
        amountFinal: o.amountFinal != null ? r2(Number(o.amountFinal)) : null,
        amount: r2(receivable),
        received: r2(received),
        unpaid: r2(unpaid),
        payMethod: o.payMethod,
        payStatus,
        payStatusText,
        hasProof: proof,
        payProof: o.payProof ?? null,
        buyerPaidClaimAt: o.buyerPaidClaimAt ? o.buyerPaidClaimAt.toISOString() : null,
        wechatPaidAmount,
      })
    }

    summary.receivable = r2(summary.receivable)
    summary.received = r2(summary.received)
    summary.unpaid = r2(summary.unpaid)
    summary.supplierPayable = r2(summary.supplierPayable)
    // 毛利粗算口径（2026-09-19 拍板修正）：原口径 = 实收 − 应付供应商，当天款没收回必然是
    // 负数（线上实测 -84.84），容易被误读成亏钱；改为 应收 − 应付供应商参考值 =
    // 这门生意本身的毛利，不随收款进度变化。未扣配送成本/平台服务费/退款。
    summary.grossProfit = r2(summary.receivable - summary.supplierPayable)

    const finishAgg = (m: Map<string, any>) =>
      [...m.values()].map((x) => ({
        ...x,
        receivable: r2(x.receivable),
        received: r2(x.received),
        unpaid: r2(x.unpaid),
      }))

    return {
      date: dateStr,
      summary: {
        ...summary,
        orderCount: orders.length,
        codPaidCount,
        codUnpaidCount,
        wechatPaidCount,
      },
      unpaidList,
      // 卡T（2026-09-21 新增）：当天订单清单（默认全量；前端「只看未收款」在本地过滤 unpaid > 0）
      orderList,
      byCourier: finishAgg(courierAgg).sort((a, b) => b.unpaid - a.unpaid || b.orderCount - a.orderCount),
      byShop: finishAgg(shopAgg).sort((a, b) => b.receivable - a.receivable),
      meta: {
        itemsMissingSupplyPrice,
        itemsMissingQtyAccepted,
        tasksScanned: tasks.length,
      },
    }
  }
}
