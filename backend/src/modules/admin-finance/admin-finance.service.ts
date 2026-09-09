import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { ServiceFeeConfigDto, GenerateSettlementDto } from './dto/finance.dto'
import { DeliveryFeeConfigDto } from './dto/delivery-fee.dto'

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
    const existing = await this.prisma.serviceFeeConfig.findFirst({ where: { categoryId: dto.categoryId ?? null } })
    const before = existing ? { rate: Number(existing.rate) } : null

    let saved
    if (existing) {
      saved = await this.prisma.serviceFeeConfig.update({
        where: { id: existing.id },
        data: { rate: dto.rate, updatedBy: userId },
      })
    } else {
      saved = await this.prisma.serviceFeeConfig.create({
        data: { categoryId: dto.categoryId ?? null, rate: dto.rate, updatedBy: userId },
      })
    }

    await this.audit.log({
      operatorId: userId,
      action: 'UPDATE_SERVICE_FEE',
      entity: 'service_fee_config',
      entityId: saved.id,
      before: before ? { categoryId: dto.categoryId ?? null, ...before } : { categoryId: dto.categoryId ?? null, rate: null },
      after: { categoryId: dto.categoryId ?? null, rate: dto.rate },
    })

    return { rate: dto.rate, categoryId: dto.categoryId ?? null }
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
    for (const [supplierId, v] of bySupplier) {
      const net = v.gross - v.fee
      const avgRate = v.gross > 0 ? v.fee / v.gross : globalRate
      await this.prisma.settlement.upsert({
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
      await this.audit.log({
        operatorId,
        action: 'GENERATE_SETTLEMENT',
        entity: 'settlement',
        entityId: 0,
        before: { period },
        after: { period, generated, globalRate },
      })
    }

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
}
