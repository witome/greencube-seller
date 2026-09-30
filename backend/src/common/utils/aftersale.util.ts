import { PrismaService } from '../../prisma/prisma.service'

/**
 * 售后台账（线下处理版）· 共享口径 —— 卡AE（2026-09-30）
 *
 * 本文件只放两样东西：
 *   ① 【归属推导】售后单 → 供应商的**唯一实现**（`resolveAftersaleSuppliers`）
 *   ② 售后工单的状态 / 类型 / 补偿方式的展示文案
 *
 * ⚠️ 为什么必须有「唯一实现」：
 *   `aftersale_order` 表**没有供应商字段**（本卡红线 3：不新加表、不新加字段），
 *   归属只能经 `aftersale_order.order_item_id` → `order_item.supplier_id` → `supplier.stall_name` 反查。
 *   而 `order_item.supplier_id` 是**核单拆单时才写入**的，可能为 null。
 *   三处调用方（后台列表 / 客户侧回显 / 供应商端列表）必须走同一份推导，
 *   否则「这条工单算谁的」会出现第二套答案。
 *
 * ⚠️ 文案映射与 `admin-order/admin-aftersale.service.ts`（STATUS_TEXT/TYPE_TEXT/COMPENSATE_METHOD_TEXT）
 *    、`buyer/buyer.service.ts`（myAftersales 内的 statusText）里的同名映射**逐字一致**。
 *    本卡只做「新增消费方」，**刻意不合并既有两份**（任务卡禁止顺手重构）；
 *    将来要合并请单开一张卡，别在这里偷偷改口径。
 */

/// 归属不到供应商时后台列表的展示文案（原型 C1「待分派」）
export const AFTERSALE_UNASSIGNED_TEXT = '待分派'

/// 售后工单状态（与 schema 注释一致：待处理/处理中/已解决/已关闭）
/// ⚠️ 唯一权威定义 —— `admin-order/admin-aftersale.service.ts` 从这里 re-export，
///    避免「状态数字」出现第二份（本卡新增的 buyer / supplier 侧也一律用这份）。
export const AFTERSALE_STATUS = {
  PENDING: 0,
  PROCESSING: 1,
  RESOLVED: 2,
  CLOSED: 3,
} as const

/// 售后工单状态文案：0 待处理 / 1 处理中 / 2 已解决 / 3 已关闭
/// ⚠️ 口径 6i（本卡）：`1 处理中` 本期不启用、无写入点 —— 客户侧只显示三档
///    （待处理 / 已解决 / 已关闭），映射本身保留是因为历史库数据可能已有 1。
export const AFTERSALE_STATUS_TEXT: Record<number, string> = {
  0: '待处理',
  1: '处理中',
  2: '已解决',
  3: '已关闭',
}

/// 售后类型文案：1 少货 / 2 品质问题 / 3 错货 / 4 其他
export const AFTERSALE_TYPE_TEXT: Record<number, string> = { 1: '少货', 2: '品质问题', 3: '错货', 4: '其他' }

/// 补偿方式文案：1 退款 / 2 补货 / 3 下次账单抵扣
/// ⚠️ 口径（本卡 6f + 大辉确认）：**不新增枚举值 4「仅致歉」** ——
///    「补偿方式为空」即代表「仅致歉」，落库为 null，展示侧把它显示成「仅致歉」。
export const AFTERSALE_METHOD_TEXT: Record<number, string> = { 1: '退款', 2: '补货', 3: '下次账单抵扣' }

/// 补偿方式为空时的展示文案（= 仅致歉，见上）
export const AFTERSALE_METHOD_EMPTY_TEXT = '仅致歉'

/// 供应商归属推导结果
export type AftersaleSupplierInfo = {
  /// `order_item.supplier_id`；归属不到时为 null
  supplierId: number | null
  /// 供应商档口名；归属不到时为 null
  supplierName: string | null
  /// 是否已归属到具体供应商。false = 未拆单 / 明细缺失（后台显示「待分派」，供应商端**不显示**）
  assigned: boolean
}

const UNASSIGNED: AftersaleSupplierInfo = { supplierId: null, supplierName: null, assigned: false }

/// Map 的键：orderItemId 字符串形式（BigInt 不能用 === 比较，统一转字符串）
const keyOf = (orderItemId: bigint | number | null | undefined): string => String(orderItemId ?? 0)

/**
 * 售后单 → 供应商归属（**全仓唯一实现**）
 *
 * 归属链（只读、不落字段）：`aftersale_order.order_item_id` → `order_item.supplier_id` → `supplier.stall_name`
 *
 * 归不到供应商的两种情形，一律返回 `assigned: false`（供应商端不显示该工单，后台显示「待分派」）：
 *   · `order_item_id` 为 0 / null（历史「拒收自动建单」留下的行；本卡起不再产生新行）
 *   · `order_item.supplier_id` 为 null（订单还未核单拆单）
 *
 * @param orderItemIds 批量入参（列表场景一次传入全部行的 orderItemId，避免 N+1）
 * @returns 以 `String(orderItemId)` 为键的 Map；入参里出现过的 id 一定有条目（归不到就是 UNASSIGNED）
 */
export async function resolveAftersaleSuppliers(
  prisma: PrismaService,
  orderItemIds: Array<bigint | number | null | undefined>,
): Promise<Map<string, AftersaleSupplierInfo>> {
  const result = new Map<string, AftersaleSupplierInfo>()
  const wanted = new Set<string>()
  const validIds: bigint[] = []

  for (const raw of orderItemIds) {
    const key = keyOf(raw)
    if (wanted.has(key)) continue
    wanted.add(key)
    result.set(key, UNASSIGNED)
    // 0 / null 视为「无明细」，直接保持 UNASSIGNED，不去查库
    const n = Number(raw ?? 0)
    if (Number.isInteger(n) && n > 0) validIds.push(typeof raw === 'bigint' ? raw : BigInt(n))
  }
  if (!validIds.length) return result

  const items = await prisma.orderItem.findMany({
    where: { id: { in: validIds } },
    select: { id: true, supplierId: true },
  })
  const supplierIds = [...new Set(items.map((it) => it.supplierId).filter((v): v is bigint => v != null))]
  const suppliers = supplierIds.length
    ? await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, stallName: true } })
    : []
  const nameById = new Map(suppliers.map((s) => [String(s.id), s.stallName]))

  for (const it of items) {
    if (it.supplierId == null) continue // 未拆单 → 保持 UNASSIGNED
    result.set(String(it.id), {
      supplierId: Number(it.supplierId),
      supplierName: nameById.get(String(it.supplierId)) ?? null,
      assigned: true,
    })
  }
  return result
}

/// 单条查询的便捷包装（详情场景）；归不到时返回 UNASSIGNED
export async function resolveAftersaleSupplier(
  prisma: PrismaService,
  orderItemId: bigint | number | null | undefined,
): Promise<AftersaleSupplierInfo> {
  const map = await resolveAftersaleSuppliers(prisma, [orderItemId])
  return map.get(keyOf(orderItemId)) ?? UNASSIGNED
}
