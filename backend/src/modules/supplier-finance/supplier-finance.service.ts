import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'

@Injectable()
export class SupplierFinanceService {
  constructor(private prisma: PrismaService) {}

  // ────────────────────────────────────────
  // 月度结算单（含服务费扣除行，公式透明）
  // 契约《开发配套-API接口字段契约》第 7 节
  // ────────────────────────────────────────
  async settlement(userId: bigint, period: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } })
    if (!supplier) throw new BizException(ErrorCode.FORBIDDEN, '当前账号不是供应商')

    const s = await this.prisma.settlement.findUnique({
      where: { supplierId_period: { supplierId: supplier.id, period } },
    })
    if (!s) throw new BizException(ErrorCode.NOT_FOUND, '该期尚未生成结算单')

    // 明细（已验收的供货明细，决策 3 基数；⚠️ 与结算生成口径一致：仅已送达/已完成/已结算订单）
    const items = await this.prisma.orderItem.findMany({
      where: {
        supplierId: supplier.id,
        qtyAccepted: { not: null },
        order: {
          deliveryDate: { gte: new Date(period + '-01'), lt: new Date(period + '-31') },
          status: { in: [60, 70, 90] },
        },
      },
      include: { product: true },
    })

    return {
      period: s.period,
      supplierName: supplier.stallName,
      grossAmount: Number(s.grossAmount),
      serviceFeeRate: Number(s.serviceFeeRate),
      serviceFee: Number(s.serviceFee),
      netAmount: Number(s.netAmount),
      status: s.status,
      statusText: ['待对账', '已确认', '已付款'][s.status] ?? '未知',
      items: items.map((it) => ({
        productName: it.product.name,
        unit: it.product.unit,
        qtyAccepted: Number(it.qtyAccepted),
        supplyPrice: Number(it.supplyPrice),
        subtotal: Math.round(Number(it.qtyAccepted) * Number(it.supplyPrice) * 100) / 100,
      })),
    }
  }
}
