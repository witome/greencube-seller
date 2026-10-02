import { PrismaService } from '../../prisma/prisma.service'

// ────────────────────────────────────────
// 加价比例解析（卡BI 2026-10-02）
// 生效优先级：单品(markupOverridden=1) > 供应商 > 分类 > 全局默认 > 0.30
// 这里是**唯一实现**：admin-pricing 的列表/重算、admin-goods 的新建/审核默认比例都只调用它。
// 设计为「纯函数 + 一次载入全部配置」：markup_config 是小表，列表/批量场景避免 N+1 查询。
// ────────────────────────────────────────

export type MarkupSource = '单品' | '供应商' | '分类' | '全局默认'

/// markup_config 一行的最小形状（Prisma 返回的 rate 是 Decimal、refId 是 bigint | null）
export interface MarkupConfigRow {
  scope: number
  refId: bigint | null
  rate: { toString(): string } | number | string
}

/// 可解析对象的最小形状（Product + 主供 supplierId）
export interface MarkupResolvable {
  markupOverridden: number | bigint
  markupRate: { toString(): string } | number | string
  categoryId: bigint
  /// 主供供应商 id（links 按 priority 升序的第一个）；无主供则传 null
  supplierId?: bigint | null
}

export const MARKUP_FALLBACK_RATE = 0.3

/// 纯解析：不查库。configs 由调用方一次载入传入
export function resolveMarkupFromConfigs(
  product: MarkupResolvable,
  configs: MarkupConfigRow[],
): { rate: number; source: MarkupSource } {
  // 单品单独设过 → 例外优先，配置重算/批量都必须跳过
  if (Number(product.markupOverridden) === 1) {
    return { rate: Number(product.markupRate), source: '单品' }
  }
  if (product.supplierId != null) {
    const sup = configs.find((c) => c.scope === 3 && c.refId !== null && BigInt(c.refId) === product.supplierId)
    if (sup) return { rate: Number(sup.rate), source: '供应商' }
  }
  const cat = configs.find((c) => c.scope === 2 && c.refId !== null && BigInt(c.refId) === product.categoryId)
  if (cat) return { rate: Number(cat.rate), source: '分类' }
  const glob = configs.find((c) => c.scope === 1)
  if (glob) return { rate: Number(glob.rate), source: '全局默认' }
  return { rate: MARKUP_FALLBACK_RATE, source: '全局默认' }
}

/// 一次载入全部配置（表很小，全局/分类/供应商三档都在这张表里）
export async function loadMarkupConfigs(prisma: PrismaService): Promise<MarkupConfigRow[]> {
  return prisma.markupConfig.findMany()
}

/// 给 admin-goods 用：新建/审核通过商品时取默认比例（无单品覆盖，走 供应商 > 分类 > 全局 > 0.30）
export async function resolveDefaultMarkup(
  prisma: PrismaService,
  supplierId: bigint,
  categoryId: bigint,
): Promise<{ rate: number; source: MarkupSource }> {
  const configs = await loadMarkupConfigs(prisma)
  return resolveMarkupFromConfigs(
    { markupOverridden: 0, markupRate: MARKUP_FALLBACK_RATE, categoryId, supplierId },
    configs,
  )
}
