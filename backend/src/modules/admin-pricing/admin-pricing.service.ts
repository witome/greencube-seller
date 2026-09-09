import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { UpdatePricingDto } from './dto/update-pricing.dto'
import { BatchMarkupDto } from './dto/batch-markup.dto'

@Injectable()
export class AdminPricingService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ────────────────────────────────────────
  // 在售商品列表（含主供供货价、加价比例、销售价）
  // ────────────────────────────────────────
  async list() {
    const products = await this.prisma.product.findMany({
      where: { status: 1 },
      orderBy: { id: 'asc' },
      include: {
        category: true,
        links: { where: { status: 1 }, orderBy: { priority: 'asc' } },
      },
    })

    return products.map((p) => {
      const primary = p.links[0]
      const supplyPrice = primary ? Number(primary.supplyPrice) : null
      return {
        productId: Number(p.id),
        name: p.name,
        categoryName: p.category.name,
        unit: p.unit,
        supplyPrice,
        markupRate: Number(p.markupRate),
        salePrice: Number(p.salePrice),
        supplierCount: p.links.length,
        // 建议销售价 = 供货价 × (1 + 加价比例)
        suggestPrice: supplyPrice !== null ? Math.round(supplyPrice * (1 + Number(p.markupRate)) * 100) / 100 : null,
      }
    })
  }

  // ────────────────────────────────────────
  // 改价：改加价比例会联动销售价（销售价 = 供货价 × (1+比例)）；也可直接改销售价覆盖
  // ────────────────────────────────────────
  async updatePricing(productId: number, operatorId: bigint, dto: UpdatePricingDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: BigInt(productId) },
      include: { links: { where: { status: 1 }, orderBy: { priority: 'asc' } } },
    })
    if (!product) throw new BizException(ErrorCode.NOT_FOUND, '商品不存在')

    const before = {
      markupRate: Number(product.markupRate),
      salePrice: Number(product.salePrice),
    }

    const patch: any = {}
    if (dto.markupRate !== undefined) {
      patch.markupRate = dto.markupRate
      // 有主供供货价时，销售价联动 = 供货价 × (1 + 加价比例)
      const primary = product.links[0]
      if (primary) {
        patch.salePrice = Math.round(Number(primary.supplyPrice) * (1 + dto.markupRate) * 100) / 100
      }
    }
    if (dto.salePrice !== undefined) {
      patch.salePrice = dto.salePrice
    }

    await this.prisma.product.update({
      where: { id: BigInt(productId) },
      data: patch,
    })

    const after = {
      markupRate: patch.markupRate ?? before.markupRate,
      salePrice: patch.salePrice ?? before.salePrice,
    }

    await this.audit.log({
      operatorId,
      action: 'UPDATE_PRICING',
      entity: 'product',
      entityId: productId,
      before,
      after,
    })

    return { productId, ...after }
  }

  // ────────────────────────────────────────
  // 批量加价：按分类（或全部）统一设置加价比例，联动销售价
  // ────────────────────────────────────────
  async batchMarkup(operatorId: bigint, dto: BatchMarkupDto) {
    const where: any = { status: 1 }
    if (dto.categoryId) where.categoryId = BigInt(dto.categoryId)

    const products = await this.prisma.product.findMany({
      where,
      include: { links: { where: { status: 1 }, orderBy: { priority: 'asc' } } },
    })

    let updated = 0
    for (const p of products) {
      const patch: any = { markupRate: dto.markupRate }
      const primary = p.links[0]
      if (primary) {
        patch.salePrice = Math.round(Number(primary.supplyPrice) * (1 + dto.markupRate) * 100) / 100
      }
      await this.prisma.product.update({ where: { id: p.id }, data: patch })
      updated++
    }

    await this.audit.log({
      operatorId,
      action: 'BATCH_MARKUP',
      entity: 'product',
      entityId: 0,
      after: { categoryId: dto.categoryId ?? null, markupRate: dto.markupRate, updated },
    })

    return { updated, markupRate: dto.markupRate, categoryId: dto.categoryId ?? null }
  }
}
