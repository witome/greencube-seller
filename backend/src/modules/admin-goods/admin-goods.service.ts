import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { ReviewApplyDto } from './dto/review-apply.dto'
import { ReviewChangeDto } from './dto/review-change.dto'
import { SetPriorityDto } from './dto/set-priority.dto'
import { CreateProductDto } from './dto/create-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { BatchReviewDto } from './dto/batch-review.dto'
import { BatchChangeReviewDto } from './dto/batch-change-review.dto'
import { AuditService } from '../audit/audit.service'
import { resolveDefaultMarkup, loadMarkupConfigs, resolveMarkupFromConfigs } from '../admin-pricing/markup-resolver'

@Injectable()
export class AdminGoodsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

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
      // 卡BP（2026-10-02）：商品备注随新品申请一起审核
      remark: (a.payload as any).remark ?? null,
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
      // 卡BQ 复核建议（2026-10-03 Hermes 三黑）：既未给比例也未给售价不再是错误 ——
      // 一律走 resolveDefaultMarkup（供应商 > 分类 > 全局 > 0.30）并据此算销售价，
      // 让「留空通过」的定价权完全落在后端（前端不再传近似 salePrice，杜绝预览/落库分叉）。
      // 卡BI：运营显式给比例 = 单品单独设过（markupOverridden=1）；
      // 未给（只指定销售价，或两者都不给）→ 按配置解析默认比例，markupOverridden=0
      let markupRate: number
      let markupOverridden: number
      if (dto.markupRate) {
        markupRate = dto.markupRate
        markupOverridden = 1
      } else {
        const resolved = await resolveDefaultMarkup(this.prisma, app.supplierId, BigInt(payload.categoryId))
        markupRate = resolved.rate
        markupOverridden = 0
      }
      const salePrice = dto.salePrice !== undefined
        ? dto.salePrice
        : Math.round(supplyPrice * (1 + markupRate) * 100) / 100

      await this.prisma.$transaction([
        this.prisma.product.update({
          where: { id: app.productId! },
          data: {
            status: 1, // 上架
            markupRate,
            markupOverridden,
            salePrice,
          },
        }),
        // 卡BP（2026-10-02）：新品备注审核通过后写入该供应商的 link 记录
        ...(payload.remark !== undefined && payload.remark !== null
          ? [this.prisma.productSupplierLink.updateMany({
              where: { productId: app.productId!, supplierId: app.supplierId },
              data: { remark: String(payload.remark) },
            })]
          : []),
        this.prisma.productApplication.update({
          where: { id: app.id },
          data: { status: 1, reviewedBy: operatorId, reviewedAt: new Date() },
        }),
      ])

      await this.audit.log({
        operatorId,
        action: 'REVIEW_GOODS_APPLY',
        entity: 'product_application',
        entityId: applyId,
        before: { status: 0 },
        after: { status: 1, salePrice },
      })

      return { applyId, status: 'approved', salePrice }
    } else {
      if (!dto.rejectReason) throw new BizException(ErrorCode.PARAM_ERROR, '驳回需填写原因')
      await this.prisma.productApplication.update({
        where: { id: app.id },
        data: { status: 2, rejectReason: dto.rejectReason, reviewedBy: operatorId, reviewedAt: new Date() },
      })

      await this.audit.log({
        operatorId,
        action: 'REVIEW_GOODS_APPLY',
        entity: 'product_application',
        entityId: applyId,
        before: { status: 0 },
        after: { status: 2, rejectReason: dto.rejectReason },
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
      // 卡BP（2026-10-02）：商品备注变更通过后写入 link（挂在 link 上，多供应商互不覆盖）
      if (changes.remark !== undefined && link) {
        linkUpdate.remark = String(changes.remark)
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

      await this.audit.log({
        operatorId,
        action: 'REVIEW_GOODS_CHANGE',
        entity: 'product_application',
        entityId: changeId,
        before: { status: 0 },
        after: { status: 1, newSalePrice },
      })

      return { changeId, status: 'approved', newSalePrice }
    } else {
      await this.prisma.productApplication.update({
        where: { id: app.id },
        data: { status: 2, rejectReason: dto.comment, reviewedBy: operatorId, reviewedAt: new Date() },
      })

      await this.audit.log({
        operatorId,
        action: 'REVIEW_GOODS_CHANGE',
        entity: 'product_application',
        entityId: changeId,
        before: { status: 0 },
        after: { status: 2, rejectReason: dto.comment },
      })

      return { changeId, status: 'rejected' }
    }
  }

  // ────────────────────────────────────────
  // 卡BS（2026-10-03）：批量通过
  // 实现红线：**逐条复用 reviewApply / reviewChange**，不复制任何定价 / 落库 / 审计逻辑；
  // 单条独立 try/catch（不做整批大事务），一条失败不中断整批；
  // 审计沿用被调方法已有的 REVIEW_GOODS_APPLY / REVIEW_GOODS_CHANGE（不新增 action）。
  // ────────────────────────────────────────
  async batchReviewApply(operatorId: bigint, dto: BatchReviewDto) {
    const ids = this.normalizeIds(dto?.applyIds)
    const failed: { id: number; name?: string; reason: string }[] = []
    let approved = 0
    for (const id of ids) {
      try {
        // 留空 = 走 reviewApply 内部的 resolveDefaultMarkup（供应商>分类>全局），与单条通过完全一致
        const res = await this.reviewApply(id, operatorId, { approved: true, markupRate: dto?.markupRate })
        if (res?.status === 'approved') approved += 1
      } catch (e: any) {
        failed.push({ id, name: await this.applyNameOf(id), reason: e?.message || '审核失败' })
      }
    }
    return { total: ids.length, approved, failed }
  }

  async batchReviewChange(operatorId: bigint, dto: BatchChangeReviewDto) {
    const ids = this.normalizeIds(dto?.changeIds)
    const failed: { id: number; name?: string; reason: string }[] = []
    let approved = 0
    for (const id of ids) {
      try {
        const res = await this.reviewChange(id, operatorId, { approved: true })
        if (res?.status === 'approved') approved += 1
      } catch (e: any) {
        failed.push({ id, name: await this.applyNameOf(id), reason: e?.message || '审核失败' })
      }
    }
    return { total: ids.length, approved, failed }
  }

  /// 去重 + 上限校验（1~50，越界抛 PARAM_ERROR）
  private normalizeIds(ids: any): number[] {
    const list = Array.isArray(ids) ? ids.map((i) => Number(i)).filter((i) => Number.isInteger(i)) : []
    const uniq = [...new Set(list)]
    if (!uniq.length || uniq.length > 50) {
      throw new BizException(ErrorCode.PARAM_ERROR, '一次最多批量通过 50 条，请分批')
    }
    return uniq
  }

  /// 失败明细里带商品名（读不到就省略，不影响失败原因）
  private async applyNameOf(id: number): Promise<string | undefined> {
    try {
      const app = await this.prisma.productApplication.findUnique({
        where: { id: BigInt(id) },
        include: { product: true },
      })
      return app?.product?.name || undefined
    } catch {
      return undefined
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

  // ────────────────────────────────────────
  // 设置供货优先级（同一商品多供应商排序，越小越优先）
  // ────────────────────────────────────────
  async setPriority(productId: number, operatorId: bigint, dto: SetPriorityDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: BigInt(productId) },
      include: { links: true },
    })
    if (!product) throw new BizException(ErrorCode.NOT_FOUND, '商品不存在')

    // 校验输入的 supplierId 都属于该商品的供货关系
    const validIds = new Set(product.links.map((l) => Number(l.supplierId)))
    for (const it of dto.items) {
      if (!validIds.has(it.supplierId)) {
        throw new BizException(ErrorCode.PARAM_ERROR, `供应商 ${it.supplierId} 不供应该商品`)
      }
    }

    const before = product.links.map((l) => ({ supplierId: Number(l.supplierId), priority: l.priority }))

    await this.prisma.$transaction(
      dto.items.map((it) =>
        this.prisma.productSupplierLink.update({
          where: { productId_supplierId: { productId: BigInt(productId), supplierId: BigInt(it.supplierId) } },
          data: { priority: it.priority },
        }),
      ),
    )

    await this.audit.log({
      operatorId,
      action: 'SET_SUPPLY_PRIORITY',
      entity: 'product',
      entityId: productId,
      before: { priorities: before },
      after: { priorities: dto.items },
    })

    return { productId, updated: dto.items.length }
  }

  // ────────────────────────────────────────
  // 商品管理：在售/下架商品列表（含主供供应商、搜索、分类/状态筛选、分页）
  // ────────────────────────────────────────
  async listProducts(query: { keyword?: string; categoryId?: string; status?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, parseInt(query.page || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || '20')))
    const where: any = {}
    if (query.keyword) where.name = { contains: query.keyword }
    if (query.categoryId) where.categoryId = BigInt(parseInt(query.categoryId))
    if (query.status !== undefined && query.status !== '') where.status = parseInt(query.status)

    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: true,
          links: { orderBy: { priority: 'asc' }, include: { supplier: true } },
        },
      }),
    ])

    // 卡BI：比例来源（单品/供应商/分类/全局默认）——配置一次载入，避免逐行查库
    const configs = await loadMarkupConfigs(this.prisma)

    const list = rows.map((p) => {
      const primary = p.links[0]
      const resolved = resolveMarkupFromConfigs(
        {
          markupOverridden: p.markupOverridden,
          markupRate: p.markupRate,
          categoryId: p.categoryId,
          supplierId: primary?.supplierId ?? null,
        },
        configs,
      )
      return {
        productId: Number(p.id),
        name: p.name,
        categoryName: p.category.name,
        weighType: p.weighType,
        unit: p.unit,
        specText: p.specText,
        salePrice: Number(p.salePrice),
        markupRate: Number(p.markupRate),
        markupSource: resolved.source,
        markupOverridden: p.markupOverridden,
        status: p.status,
        supplierCount: p.links.length,
        primarySupplier: primary
          ? {
              supplierId: Number(primary.supplierId),
              supplierName: primary.supplier.stallName,
              supplyPrice: Number(primary.supplyPrice),
              dailySupply: Number(primary.dailySupply),
            }
          : null,
      }
    })

    return { total, list }
  }

  // ────────────────────────────────────────
  // 上下架（0 下架 / 1 上架）
  // ────────────────────────────────────────
  async updateProductStatus(productId: number, status: number, operatorId: bigint) {
    const product = await this.prisma.product.findUnique({ where: { id: BigInt(productId) } })
    if (!product) throw new BizException(ErrorCode.NOT_FOUND, '商品不存在')
    if (![0, 1].includes(status)) throw new BizException(ErrorCode.PARAM_ERROR, '状态值不合法（0 下架 / 1 上架）')

    await this.prisma.product.update({ where: { id: BigInt(productId) }, data: { status } })

    await this.audit.log({
      operatorId,
      action: status === 1 ? 'PRODUCT_ON_SHELF' : 'PRODUCT_OFF_SHELF',
      entity: 'product',
      entityId: productId,
      before: { status: product.status },
      after: { status },
    })

    return { productId, status }
  }

  // ────────────────────────────────────────
  // 新增商品（归属供应商 + 供货价 + 加价比例 + 规格，创建商品 + 供货关系）
  // ────────────────────────────────────────
  async createProduct(operatorId: bigint, dto: CreateProductDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: BigInt(dto.supplierId) } })
    if (!supplier) throw new BizException(ErrorCode.PARAM_ERROR, '供应商不存在')

    // 卡BI：运营显式给比例 = 单品单独设过（markupOverridden=1）；
    // 未给 → 按配置解析默认比例（供应商 > 分类 > 全局 > 0.30），markupOverridden=0
    let markupRate: number
    let markupOverridden: number
    if (dto.markupRate !== undefined) {
      markupRate = dto.markupRate
      markupOverridden = 1
    } else {
      const resolved = await resolveDefaultMarkup(this.prisma, BigInt(dto.supplierId), BigInt(dto.categoryId))
      markupRate = resolved.rate
      markupOverridden = 0
    }
    const salePrice = dto.salePrice !== undefined
      ? dto.salePrice
      : Math.round(dto.supplyPrice * (1 + markupRate) * 100) / 100

    const product = await this.prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          categoryId: BigInt(dto.categoryId),
          name: dto.name,
          weighType: dto.weighType,
          unit: dto.unit ?? '斤',
          specText: dto.specText,
          salePrice,
          markupRate,
          markupOverridden,
          status: 1,
        },
      })
      await tx.productSupplierLink.create({
        data: {
          productId: p.id,
          supplierId: BigInt(dto.supplierId),
          supplyPrice: dto.supplyPrice,
          dailySupply: dto.dailySupply,
          priority: 1,
          status: 1,
        },
      })
      return p
    })

    await this.audit.log({
      operatorId,
      action: 'PRODUCT_CREATE',
      entity: 'product',
      entityId: Number(product.id),
      before: null,
      after: { name: dto.name, supplierId: dto.supplierId, supplyPrice: dto.supplyPrice, salePrice },
    })

    return { productId: Number(product.id), name: dto.name, salePrice }
  }

  // ────────────────────────────────────────
  // 编辑商品（名称/规格/供货价/加价比例/销售价/可供量）
  // ────────────────────────────────────────
  async updateProduct(productId: number, operatorId: bigint, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: BigInt(productId) },
      include: { links: { orderBy: { priority: 'asc' } } },
    })
    if (!product) throw new BizException(ErrorCode.NOT_FOUND, '商品不存在')

    const productUpdate: any = {}
    if (dto.name !== undefined) productUpdate.name = dto.name
    if (dto.weighType !== undefined) productUpdate.weighType = dto.weighType
    if (dto.unit !== undefined) productUpdate.unit = dto.unit
    if (dto.specText !== undefined) productUpdate.specText = dto.specText
    if (dto.markupRate !== undefined) productUpdate.markupRate = dto.markupRate

    if (dto.salePrice !== undefined) {
      productUpdate.salePrice = dto.salePrice
    } else if (dto.markupRate !== undefined || dto.supplyPrice !== undefined) {
      // 供货价或加价比例变动时，若无显式销售价，按「主供供货价 × (1+加价比例)」重算
      const primary = product.links[0]
      const newSupply = dto.supplyPrice !== undefined ? dto.supplyPrice : (primary ? Number(primary.supplyPrice) : 0)
      const newRate = dto.markupRate !== undefined ? dto.markupRate : Number(product.markupRate)
      productUpdate.salePrice = Math.round(newSupply * (1 + newRate) * 100) / 100
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(productUpdate).length) {
        await tx.product.update({ where: { id: BigInt(productId) }, data: productUpdate })
      }
      const primary = product.links[0]
      if (primary && (dto.supplyPrice !== undefined || dto.dailySupply !== undefined)) {
        await tx.productSupplierLink.update({
          where: { id: primary.id },
          data: {
            ...(dto.supplyPrice !== undefined ? { supplyPrice: dto.supplyPrice } : {}),
            ...(dto.dailySupply !== undefined ? { dailySupply: dto.dailySupply } : {}),
          },
        })
      }
    })

    await this.audit.log({
      operatorId,
      action: 'PRODUCT_UPDATE',
      entity: 'product',
      entityId: productId,
      before: { name: product.name, salePrice: Number(product.salePrice), markupRate: Number(product.markupRate) },
      after: productUpdate,
    })

    return { productId, updated: true }
  }
}
