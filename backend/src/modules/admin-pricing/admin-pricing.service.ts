import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { UpdatePricingDto } from './dto/update-pricing.dto'
import { BatchMarkupDto } from './dto/batch-markup.dto'
import { PutMarkupConfigDto, ApplyMarkupConfigDto } from './dto/markup-config.dto'
import { loadMarkupConfigs, resolveMarkupFromConfigs } from './markup-resolver'

/** 加价配置并发写入撞唯一键时的兜底映射（正常路径走原子 upsert，到不了这里；验证脚本用真实错误证明它生效） */
export function markupConfigWriteError(e: unknown): BizException | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const msg = String((e.meta as any)?.message ?? '')
    if (e.code === 'P2002' || (e.code === 'P2010' && msg.includes('Duplicate entry'))) {
      return new BizException(ErrorCode.PARAM_ERROR, '加价配置写入冲突，请重试')
    }
  }
  return null
}

@Injectable()
export class AdminPricingService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ────────────────────────────────────────
  // 在售商品列表（含主供供货价、加价比例、销售价、比例来源）
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
    const configs = await loadMarkupConfigs(this.prisma)

    return products.map((p) => {
      const primary = p.links[0]
      const supplyPrice = primary ? Number(primary.supplyPrice) : null
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
        unit: p.unit,
        supplyPrice,
        markupRate: Number(p.markupRate),
        salePrice: Number(p.salePrice),
        // 卡BI：比例来源文案（单品/供应商/分类/全局默认）+ 是否单品单独设过
        markupSource: resolved.source,
        markupOverridden: p.markupOverridden,
        supplierCount: p.links.length,
        // 建议销售价 = 供货价 × (1 + 加价比例)
        suggestPrice: supplyPrice !== null ? Math.round(supplyPrice * (1 + Number(p.markupRate)) * 100) / 100 : null,
      }
    })
  }

  // ────────────────────────────────────────
  // 改价：改加价比例会联动销售价（销售价 = 供货价 × (1+比例)）；也可直接改销售价覆盖
  // 卡BI：改比例 = 单品单独设过 → markupOverridden=1（此后配置重算/批量都跳过它）
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
      markupOverridden: product.markupOverridden,
    }

    const patch: any = {}
    if (dto.markupRate !== undefined) {
      patch.markupRate = dto.markupRate
      patch.markupOverridden = 1
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
      markupOverridden: patch.markupOverridden ?? before.markupOverridden,
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
  // 批量加价：范围 = 全部 / 按分类 / 按供应商，统一设置加价比例并写 markup_config
  // 卡BI：applyNow=false（默认）只影响以后新增（在售商品一律不动）；
  //       applyNow=true 同时重算在售商品（markupOverridden=1 的跳过）。
  //       categoryId 与 supplierId 都传时分类优先（业务上二选一）。
  // ────────────────────────────────────────
  async batchMarkup(operatorId: bigint, dto: BatchMarkupDto) {
    const scopeInfo = this.scopeOf(dto.categoryId, dto.supplierId)

    await this.upsertConfigRow(operatorId, scopeInfo.scope, scopeInfo.refId, dto.markupRate)

    let result = { updated: 0, skipped: 0 }
    if (dto.applyNow) {
      result = await this.recomputeScope(operatorId, scopeInfo.scope, scopeInfo.refId)
    }

    await this.audit.log({
      operatorId,
      action: 'BATCH_MARKUP',
      entity: 'product',
      entityId: 0,
      after: {
        scope: scopeInfo.scope,
        categoryId: dto.categoryId ?? null,
        supplierId: dto.supplierId ?? null,
        markupRate: dto.markupRate,
        applyNow: !!dto.applyNow,
        updated: result.updated,
        skipped: result.skipped,
      },
    })

    return {
      updated: result.updated,
      skipped: result.skipped,
      markupRate: dto.markupRate,
      scope: scopeInfo.scope,
      refId: scopeInfo.refId ?? null,
      appliedToOnSale: !!dto.applyNow,
    }
  }

  // ────────────────────────────────────────
  // 加价配置：读取（全局 / 按分类 / 按供应商，未配的 rate 为 null）
  // ────────────────────────────────────────
  async getMarkupConfig() {
    const [configs, categories, suppliers] = await Promise.all([
      loadMarkupConfigs(this.prisma),
      this.prisma.category.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.supplier.findMany({ orderBy: { id: 'asc' } }),
    ])

    const globalRow = configs.find((c) => c.scope === 1)
    const rateOf = (scope: number, refId: bigint) => {
      const row = configs.find((c) => c.scope === scope && c.refId !== null && BigInt(c.refId) === refId)
      return row ? Number(row.rate) : null
    }

    return {
      global: globalRow ? Number(globalRow.rate) : null,
      categories: categories.map((c) => ({
        categoryId: Number(c.id),
        name: c.name,
        rate: rateOf(2, c.id),
      })),
      suppliers: suppliers.map((s) => ({
        supplierId: Number(s.id),
        stallName: s.stallName,
        rate: rateOf(3, s.id),
      })),
    }
  }

  // ────────────────────────────────────────
  // 加价配置：写入（upsert 原子写 + 审计）。只改配置，在售商品不动（重算走 apply）
  // ────────────────────────────────────────
  async putMarkupConfig(operatorId: bigint, dto: PutMarkupConfigDto) {
    const scopeInfo = this.scopeOf(dto.scope === 2 ? dto.refId : undefined, dto.scope === 3 ? dto.refId : undefined, dto.scope)
    const before = await this.findConfigRow(scopeInfo.scope, scopeInfo.refId)

    await this.upsertConfigRow(operatorId, scopeInfo.scope, scopeInfo.refId, dto.rate)

    await this.audit.log({
      operatorId,
      action: 'MARKUP_CONFIG_SET',
      entity: 'markup_config',
      entityId: 0,
      before: before ? { scope: before.scope, refId: before.refId ? Number(before.refId) : null, rate: Number(before.rate) } : null,
      after: {
        scope: scopeInfo.scope,
        refId: scopeInfo.refId ?? null,
        rate: dto.rate,
        note: '只写配置；重算在售商品需调 POST /admin/pricing/markup-config/apply',
      },
    })

    return { scope: scopeInfo.scope, refId: scopeInfo.refId ?? null, rate: dto.rate }
  }

  // ────────────────────────────────────────
  // 加价配置：把当前配置重算到在售商品（跳过 markupOverridden=1），返回 { updated, skipped }
  // ────────────────────────────────────────
  async applyMarkupConfig(operatorId: bigint, dto: ApplyMarkupConfigDto) {
    const scopeInfo = this.scopeOf(dto.scope === 2 ? dto.refId : undefined, dto.scope === 3 ? dto.refId : undefined, dto.scope)
    const result = await this.recomputeScope(operatorId, scopeInfo.scope, scopeInfo.refId)

    await this.audit.log({
      operatorId,
      action: 'MARKUP_CONFIG_APPLY',
      entity: 'product',
      entityId: 0,
      after: { scope: scopeInfo.scope, refId: scopeInfo.refId ?? null, ...result },
    })

    return { scope: scopeInfo.scope, refId: scopeInfo.refId ?? null, ...result }
  }

  // ────────────────────────────────────────
  // 内部：范围归一（scope 1 全局 / 2 分类 / 3 供应商；分类与供应商都给 = 分类优先）
  // ────────────────────────────────────────
  private scopeOf(categoryId?: number, supplierId?: number, forcedScope?: number) {
    const scope = forcedScope ?? (categoryId ? 2 : supplierId ? 3 : 1)
    if (![1, 2, 3].includes(scope)) throw new BizException(ErrorCode.PARAM_ERROR, 'scope 必须为 1/2/3')
    if (scope === 2 && !categoryId) throw new BizException(ErrorCode.PARAM_ERROR, '按分类配置需提供 refId（categoryId）')
    if (scope === 3 && !supplierId) throw new BizException(ErrorCode.PARAM_ERROR, '按供应商配置需提供 refId（supplierId）')
    return {
      scope,
      refId: scope === 2 ? categoryId : scope === 3 ? supplierId : undefined,
    }
  }

  private async findConfigRow(scope: number, refId?: number) {
    return this.prisma.markupConfig.findFirst({
      where: { scope, ...(refId !== undefined ? { refId: BigInt(refId) } : { refId: null }) },
    })
  }

  /// 单条原子 upsert：MySQL 唯一键 (scope, ref_key 生成列) 兜底并发双写（同 service_fee_config 先例）。
  /// raw SQL 写时间必须 UTC_TIMESTAMP(3)（本机会话时区 +08，NOW(3) 会被 Prisma 按 UTC 读 → 整列偏 8 小时）。
  private async upsertConfigRow(operatorId: bigint, scope: number, refId: number | undefined, rate: number) {
    const refIdValue = refId !== undefined ? BigInt(refId) : null
    try {
      await this.prisma.$executeRaw`
        INSERT INTO markup_config (scope, ref_id, rate, updated_by, updated_at)
        VALUES (${scope}, ${refIdValue}, ${rate}, ${operatorId}, UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE rate = ${rate}, updated_by = ${operatorId}, updated_at = UTC_TIMESTAMP(3)
      `
    } catch (e) {
      const biz = markupConfigWriteError(e)
      if (biz) throw biz
      throw e
    }
  }

  /// 按范围重算在售商品：markupOverridden=0 的按新优先级（供应商>分类>全局）取比例并联动销售价；
  /// markupOverridden=1 的跳过（单品例外优先）。涉钱收口：整批同事务提交（2026-09-19 卡B 惯例）。
  private async recomputeScope(_operatorId: bigint, scope: number, refId?: number) {
    const configs = await loadMarkupConfigs(this.prisma)
    const where: any = { status: 1 }
    if (scope === 2) where.categoryId = BigInt(refId!)
    if (scope === 3) where.links = { some: { supplierId: BigInt(refId!) } }

    const products = await this.prisma.product.findMany({
      where,
      include: { links: { where: { status: 1 }, orderBy: { priority: 'asc' } } },
    })

    const updates: any[] = []
    let updated = 0
    let skipped = 0
    for (const p of products) {
      if (Number(p.markupOverridden) === 1) {
        skipped++
        continue
      }
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
      const patch: any = { markupRate: resolved.rate }
      if (primary) {
        patch.salePrice = Math.round(Number(primary.supplyPrice) * (1 + resolved.rate) * 100) / 100
      }
      updates.push(this.prisma.product.update({ where: { id: p.id }, data: patch }))
      updated++
    }

    if (updates.length) await this.prisma.$transaction(updates)

    return { updated, skipped }
  }
}
