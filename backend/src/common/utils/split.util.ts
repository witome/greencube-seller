/**
 * 拆单分配算法（决策 1：核单拆单）
 * 按「供货优先级 + 当日可供量」自动分配：主供优先满足，不足则差额流转次供。
 * 供「运营手动拆单」与「下单自动拆单」两处共用，保证算法一致。
 */

export interface SupplierLinkInfo {
  supplierId: bigint
  priority: number
  dailySupply: number
  supplyPrice: number
  supplierName?: string
}

export interface SplitAllocation {
  supplierId: number
  supplierName: string
  priority: number
  qty: number
  supplyPrice: number
}

/**
 * 按优先级依次分配可供量
 * @returns allocations 分配结果；shortage 可供量不足的差额（>0 表示缺货）
 */
export function allocateByPriority(links: SupplierLinkInfo[], qtyOrdered: number) {
  let remaining = qtyOrdered
  const allocations: SplitAllocation[] = []
  for (const link of links) {
    if (remaining <= 0) break
    const take = Math.min(remaining, link.dailySupply)
    if (take > 0) {
      allocations.push({
        supplierId: Number(link.supplierId),
        supplierName: link.supplierName ?? '',
        priority: link.priority,
        qty: Math.round(take * 100) / 100,
        supplyPrice: link.supplyPrice,
      })
      remaining = Math.round((remaining - take) * 100) / 100
    }
  }
  return { allocations, shortage: remaining > 0 ? remaining : 0 }
}
