import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { ServiceFeeConfigDto, GenerateSettlementDto } from './dto/finance.dto'

@Injectable()
export class AdminFinanceService {
  constructor(private prisma: PrismaService) {}

  /// 读取全局默认费率
  private async getGlobalRate(): Promise<number> {
    const cfg = await this.prisma.serviceFeeConfig.findFirst({ where: { categoryId: null } })
    return cfg ? Number(cfg.rate) : Number(process.env.DEFAULT_SERVICE_FEE_RATE || 0.05)
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
    if (existing) {
      await this.prisma.serviceFeeConfig.update({
        where: { id: existing.id },
        data: { rate: dto.rate, updatedBy: userId },
      })
    } else {
      await this.prisma.serviceFeeConfig.create({
        data: { categoryId: dto.categoryId ?? null, rate: dto.rate, updatedBy: userId },
      })
    }
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
  // ────────────────────────────────────────
  async generate(dto: GenerateSettlementDto) {
    const period = dto.period
    const rate = await this.getGlobalRate()

    // 该期所有已验收且已分配供应商的明细
    const items = await this.prisma.orderItem.findMany({
      where: {
        supplierId: { not: null },
        qtyAccepted: { not: null },
        order: {
          deliveryDate: { gte: new Date(period + '-01'), lt: new Date(period + '-31') },
          status: { in: [60, 70, 90] }, // 已送达/已完成/已结算
        },
      },
    })

    // 按供应商汇总
    const bySupplier = new Map<bigint, number>()
    for (const it of items) {
      const gross = Number(it.qtyAccepted) * Number(it.supplyPrice)
      bySupplier.set(it.supplierId!, (bySupplier.get(it.supplierId!) || 0) + gross)
    }

    let generated = 0
    for (const [supplierId, gross] of bySupplier) {
      const fee = gross * rate
      const net = gross - fee
      await this.prisma.settlement.upsert({
        where: { supplierId_period: { supplierId, period } },
        update: {
          grossAmount: Math.round(gross * 100) / 100,
          serviceFeeRate: rate,
          serviceFee: Math.round(fee * 100) / 100,
          netAmount: Math.round(net * 100) / 100,
        },
        create: {
          supplierId,
          period,
          grossAmount: Math.round(gross * 100) / 100,
          serviceFeeRate: rate,
          serviceFee: Math.round(fee * 100) / 100,
          netAmount: Math.round(net * 100) / 100,
          status: 0,
        },
      })
      generated++
    }

    return { period, generated, rate }
  }
}
