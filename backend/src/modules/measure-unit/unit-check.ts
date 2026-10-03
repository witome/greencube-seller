import { BizException, ErrorCode } from '../../common/constants/error-codes'

/// 卡BV-1（2026-10-03）：商品「单位」的统一校验入口（supplier-goods / admin-goods 共用）
///
/// 为什么抽成函数而不是塞进某个 service：单位校验要同时被 supplier-goods 与 admin-goods 用到，
/// 抽成「只吃 prisma 客户端」的纯函数，两边 import 即可，**不用互相 import 模块**（避免循环依赖）。
///
/// ⚠️⚠️ 放行集合 = **启用中的单位 ∪ 该商品/该申请当前正在使用的那个单位** ——
/// 后半句是防死锁的关键：单位被运营停用后，老商品的单位仍是它，
/// 供应商编辑该商品时「不改单位」必须还能提交通过，否则老商品就永远改不动了。

export const UNIT_REQUIRED_MSG = '请选择计量单位'
export const UNIT_NOT_ALLOWED_MSG = '计量单位不存在或已停用，请重新选择'

/** prisma 客户端的最小形状（PrismaService 或交互式事务 tx 都满足） */
type UnitClient = {
  measureUnit: { findFirst: (args: { where: { name: string; status?: number } }) => Promise<unknown> }
}

/**
 * 校验一个单位名是否允许写入。
 * @param unit        待校验的单位（来自请求体）
 * @param currentUnit 该商品/该申请**当前正在使用**的单位（可空；命中它一律放行，哪怕它已被停用）
 * @returns 归一化后的单位名（trim 后）
 */
export async function assertUnitAllowed(
  prisma: UnitClient,
  unit: unknown,
  currentUnit?: string | null,
): Promise<string> {
  const name = typeof unit === 'string' ? unit.trim() : ''
  if (!name) throw new BizException(ErrorCode.PARAM_ERROR, UNIT_REQUIRED_MSG)

  const enabled = await prisma.measureUnit.findFirst({ where: { name, status: 1 } })
  if (enabled) return name

  // 老商品/老申请当前正在用的单位（可能已被停用）→ 放行
  const current = typeof currentUnit === 'string' ? currentUnit.trim() : ''
  if (current && current === name) return name

  throw new BizException(ErrorCode.PARAM_ERROR, UNIT_NOT_ALLOWED_MSG)
}

/**
 * 提交新品专用：`unit` **必填**且必须命中启用中的单位（新品没有「当前值」可放行）。
 */
export async function assertUnitRequired(prisma: UnitClient, unit: unknown): Promise<string> {
  return assertUnitAllowed(prisma, unit, null)
}
