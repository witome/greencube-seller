import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { ReviewApplyDto } from './dto/review-apply.dto'
import { ReviewChangeDto } from './dto/review-change.dto'

@Injectable()
export class AdminGoodsService {
  constructor(private prisma: PrismaService) {}

  // ────────────────────────────────────────
  // 待审核新品（type=1, status=0）
  // ────────────────────────────────────────
  async pending() {
    const apps = await this.prisma.productApplication.findMany({
      where: { type: 1, status: 0 },
      orderBy: { createdAt: 'asc' },
      include: { product: true, supplier: true },
    })

    return apps.map((a) => ({
      applyId: Number(a.id),
      productId: a.productId ? Number(a.productId) : null,
      name: a.product?.name,
      supplierName: a.supplier.stallName,
      supplyPrice: a.product ? Number((a.payload as any).supplyPrice) : null,
      dailySupply: (a.payload as any).dailySupply,
      categoryId: (a.payload as any).categoryId,
      weighType: (a.payload as any).weighType,
      qualification: (a.payload as any).qualification,
      submittedAt: a.createdAt.toISOString(),
    }))
  }

  // ────────────────────────────────────────
  // 待审核变更（type=2, status=0，含新旧对照）
  // ────────────────────────────────────────
  async changePending() {
    const apps = await this.prisma.productApplication.findMany({
      where: { type: 2, status: 0 },
      orderBy: { createdAt: 'asc' },
      include: { product: true, supplier: true },
    })

    return apps.map((a) => ({
      changeId: Number(a.id),
      productId: Number(a.productId),
      productName: a.product?.name,
      supplierName: a.supplier.stallName,
      diffs: a.diffs,
      reason: (a.payload as any).reason,
      submittedAt: a.createdAt.toISOString(),
    }))
  }

  // ────────────────────────────────────────
  // 新品审核（通过 → 上架 + 定加价比例算销售价；驳回 → 记录原因）
  // ────────────────────────────────────────
  async reviewApply(applyId: number, operatorId: bigint, dto: ReviewApplyDto) {
    const app = await this.prisma.productApplication.findUnique({
      where: { id: BigInt(applyId) },
      include: { product: true },
    })
    if (!app || app.type !== 1) throw new BizException(ErrorCode.NOT_FOUND, '新品申请不存在')
    if (app.status !== 0) throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '该申请已处理')

    const payload = app.payload as any
    const supplyPrice = Number(payload.supplyPrice)

    if (dto.approved) {
      if (!dto.markupRate && dto.salePrice === undefined) {
        throw new BizException(ErrorCode.PARAM_ERROR, '通过新品需提供加价比例或直接指定销售价')
      }
      const salePrice = dto.salePrice !== undefined
        ? dto.salePrice
        : Math.round(supplyPrice * (1 + dto.markupRate!) * 100) / 100

      await this.prisma.$transaction([
        this.prisma.product.update({
          where: { id: app.productId! },
          data: {
            status: 1, // 上架
            markupRate: dto.markupRate ?? 0,
            salePrice,
          },
        }),
        this.prisma.productApplication.update({
          where: { id: app.id },
          data: { status: 1, reviewedBy: operatorId, reviewedAt: new Date() },
        }),
      ])

      return { applyId, status: 'approved', salePrice }
    } else {
      if (!dto.rejectReason) throw new BizException(ErrorCode.PARAM_ERROR, '驳回需填写原因')
      await this.prisma.productApplication.update({
        where: { id: app.id },
        data: { status: 2, rejectReason: dto.rejectReason, reviewedBy: operatorId, reviewedAt: new Date() },
      })
      return { applyId, status: 'rejected' }
    }
  }

  // ────────────────────────────────────────
  // 变更审核（通过 → 应用变更；涉价自动重算销售价）
  // ────────────────────────────────────────
  async reviewChange(changeId: number, operatorId: bigint, dto: ReviewChangeDto) {
    const app = await this.prisma.productApplication.findUnique({
      where: { id: BigInt(changeId) },
      include: { product: true },
    })
    if (!app || app.type !== 2) throw new BizException(ErrorCode.NOT_FOUND, '变更申请不存在')
    if (app.status !== 0) throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '该申请已处理')

    const changes = app.payload as any
    const product = app.product!
    const link = await this.prisma.productSupplierLink.findUnique({
      where: { productId_supplierId: { productId: product.id, supplierId: app.supplierId } },
    })

    if (dto.approved) {
      const productUpdate: any = {}
      const linkUpdate: any = {}
      let newSalePrice: number | null = null

      if (changes.name !== undefined) productUpdate.name = changes.name
      if (changes.specText !== undefined) productUpdate.specText = changes.specText
      if (changes.weighType !== undefined) productUpdate.weighType = changes.weighType
      if (changes.categoryId !== undefined) productUpdate.categoryId = changes.categoryId

      if (changes.supplyPrice !== undefined && link) {
        const newSupplyPrice = Number(changes.supplyPrice)
        linkUpdate.supplyPrice = newSupplyPrice
        // 决策：涉供货价变动自动按加价比例重算销售价（除非人工指定）
        newSalePrice = dto.newSalePrice !== undefined
          ? dto.newSalePrice
          : Math.round(newSupplyPrice * (1 + Number(product.markupRate)) * 100) / 100
        productUpdate.salePrice = newSalePrice
      }
      if (changes.dailySupply !== undefined && link) {
        linkUpdate.dailySupply = Number(changes.dailySupply)
      }

      await this.prisma.$transaction([
        ...(Object.keys(productUpdate).length
          ? [this.prisma.product.update({ where: { id: product.id }, data: productUpdate })]
          : []),
        ...(link && Object.keys(linkUpdate).length
          ? [this.prisma.productSupplierLink.update({ where: { id: link.id }, data: linkUpdate })]
          : []),
        this.prisma.productApplication.update({
          where: { id: app.id },
          data: { status: 1, reviewedBy: operatorId, reviewedAt: new Date() },
        }),
      ])

      return { changeId, status: 'approved', newSalePrice }
    } else {
      await this.prisma.productApplication.update({
        where: { id: app.id },
        data: { status: 2, rejectReason: dto.comment, reviewedBy: operatorId, reviewedAt: new Date() },
      })
      return { changeId, status: 'rejected' }
    }
  }

  // ────────────────────────────────────────
  // 供货优先级（同一商品多供应商排序）
  // ────────────────────────────────────────
  async priority(productId: number) {
    const product = await this.prisma.product.findUnique({
      where: { id: BigInt(productId) },
      include: { links: { orderBy: { priority: 'asc' }, include: { supplier: true } } },
    })
    if (!product) throw new BizException(ErrorCode.NOT_FOUND, '商品不存在')

    return {
      productId: Number(product.id),
      productName: product.name,
      suppliers: product.links.map((l) => ({
        supplierId: Number(l.supplierId),
        supplierName: l.supplier.stallName,
        priority: l.priority,
        supplyPrice: Number(l.supplyPrice),
        dailySupply: Number(l.dailySupply),
        status: l.status,
      })),
    }
  }
}
