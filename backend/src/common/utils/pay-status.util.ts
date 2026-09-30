/// 支付/收款状态口径 —— 唯一实现，禁止在别处再写第二套（卡S2 · 2026-09-29 大辉拍板）
///
/// 统一后的四档状态（列表 / 详情 / 后台对账必须同源，判定优先级从上到下）：
///   1. paid_wechat  「已付款 · 微信直接支付」 —— 该单存在**已支付的微信支付流水**
///                    （payment_record.channel='wechat' && status=1；不论 payMethod，
///                      COD 单送达后线上直付也算；退款把流水置 2 → 自动回退，不需要新字段）
///   2. paid_proof   「已付款 · 扫码付款」 —— 配送员提交了收款凭证（order.payProof.photos 非空）
///   3. cod_pending  「待收款」 —— 货到付款(payMethod=2)、已送达(60/70)，既无线上到账也无凭证
///   4. unpaid       「未支付」 —— 其余（下单后还没付）
///
/// ⚠️ 上面四档是**内部/运营口径**。卡AG 起**客户（采购方）看到的文案另有一套**
///    （见文件末尾 buyerPayStatusTextOf）：客户侧 cod_pending 与 unpaid **都显示「未支付」**。
///
/// 「已付款」必须有资金证据：线上到账 或 配送员凭证。采购方**不能**再自己声明
/// （「我已付款」按钮已下线，POST /buyer/order/:id/claim-paid 接口保留仅为兼容老版本小程序包）。
///
/// 调用点（必须都走这里，页面/服务里禁止内联 `payMethod === 2 && ...` 这类判定）：
///   - backend/src/modules/order/order.service.ts            list()（采购方订单列表）→ 取**客户版**文案
///   - backend/src/modules/order/order.service.ts            detail()（采购方订单详情）→ 取**客户版**文案
///   - backend/src/modules/buyer/buyer.service.ts            collectBlockers()（注销门槛，只用 code 不算文案）
///   - backend/src/modules/admin-finance/admin-finance.service.ts  dailyReconciliation()（每日对账）→ **运营版**文案
///
/// ⚠️ 卡AG（2026-09-30）：**同一套判定、两套文案** ——
///   客户版（采购方）见下方 buyerPayStatusTextOf()：cod_pending 与 unpaid 对客户**都显示「未支付」**；
///   运营版（运营后台）就是 payStatusOf().text，cod_pending 仍是「待收款」（那是作业提示，不能对客户露出）。
///   只有在**采购方侧接口**才用客户版；运营后台 / 配送员侧一律用运营版。

/// 四档状态码
export type PayStatusCode = 'unpaid' | 'cod_pending' | 'paid_wechat' | 'paid_proof'

export interface PayStatusInput {
  payMethod: number // 0 未选 / 1 微信支付 / 2 货到付款
  status: number // 订单状态（60 已送达 / 70 已完成 才可能出现「待收款」）
  onlinePaid: boolean // 是否存在已支付的线上支付流水（用 hasWechatPaidRecord 判定）
  hasProof: boolean // 是否有配送员收款凭证（用 hasPayProof 判定）
}

export interface PayStatusResult {
  code: PayStatusCode
  text: string
}

/// 「待收款」只可能出现在已送达(60)/已完成(70)的 COD 单上
/// （与 OrderStatus.DELIVERED / COMPLETED 数值一致；此处用字面量保持本文件零依赖、可被脚本直接 require）
const DELIVERED_STATUS = [60, 70]

/// 是否有配送员收款凭证（photos 数组非空；非数组但 payProof 存在视为有 —— 与核销既有口径一致）
export function hasPayProof(payProof: unknown): boolean {
  if (!payProof) return false
  const photos = (payProof as any).photos
  return Array.isArray(photos) ? photos.length > 0 : true
}

/// 是否存在「已支付」的线上支付流水。
/// 生产口径 = channel='wechat' && status=1；'mock' 是本机开发模拟通道（生产 WX_MOCK_PAY=0 时不存在
/// mock 流水），算进来是为了本地开发/自测环境与生产行为一致（mock 回调成功同样代表"钱已到账"的模拟态）。
export function hasWechatPaidRecord(records: Array<{ channel?: string | null; status: number }>): boolean {
  return records.some((r) => r.status === 1 && (r.channel === 'wechat' || r.channel === 'mock'))
}

/// 取「最新一条已支付的线上流水」（id 最大）。
/// ⚠️ 存在的意义：判定与「取哪条」必须同一份实现 —— 否则 service 里会各自内联 filter，
/// 一处忘了带 channel 条件就出现「列表说已付、详情说未付」这类两页两个数的老毛病（卡S2 收口）。
export function latestPaidRecord<T extends { channel?: string | null; status: number; id?: unknown }>(
  records: T[],
): T | undefined {
  return records
    .filter((r) => r.status === 1 && (r.channel === 'wechat' || r.channel === 'mock'))
    .sort((a, b) => Number((b as any).id ?? 0) - Number((a as any).id ?? 0))[0]
}

/// 「线上已收款」时间（没有则 null）：最新一条已支付线上流水的 paidAt ?? createdAt。
/// 列表 / 详情 / 后台三处取这个时间都调这里，别各自写。
export function onlinePaidAtOf<
  T extends { channel?: string | null; status: number; id?: unknown; paidAt?: Date | null; createdAt?: Date },
>(records: T[]): string | null {
  const rec = latestPaidRecord(records)
  if (!rec) return null
  const at = (rec as any).paidAt ?? (rec as any).createdAt
  return at ? new Date(at).toISOString() : null
}

/// 四档判定（唯一出口）
export function payStatusOf(input: PayStatusInput): PayStatusResult {
  if (input.onlinePaid) return { code: 'paid_wechat', text: '已付款 · 微信直接支付' }
  if (input.hasProof) return { code: 'paid_proof', text: '已付款 · 扫码付款' }
  if (input.payMethod === 2 && DELIVERED_STATUS.includes(input.status)) {
    return { code: 'cod_pending', text: '待收款' }
  }
  return { code: 'unpaid', text: '未支付' }
}

/// 后台对账页的三档归组：paid_wechat / paid_proof / 未收；
/// 「待收款」作为「未收」的子标注（COD 已送达未收）。
export function payStatusGroup(code: PayStatusCode): { text: string; subText: string | null } {
  switch (code) {
    case 'paid_wechat':
      return { text: '已付款 · 微信直接支付', subText: null }
    case 'paid_proof':
      return { text: '已付款 · 扫码付款', subText: null }
    case 'cod_pending':
      return { text: '未收', subText: '待收款' }
    default:
      return { text: '未收', subText: null }
  }
}

// ────────────────────────────────────────────────────────────────
// 卡AG（2026-09-30 大辉拍板 1a）：**面向采购方（客户）的文案映射**
//
// 客户视角只认「钱付没付」：
//   unpaid       → 「未支付」（还没给钱）
//   cod_pending  → 「未支付」（货到付款、已送达、钱还没收到 —— 对客户同样是「没给钱」）
//   paid_wechat  → 「已付款 · 微信直接支付」（照旧）
//   paid_proof   → 「已付款 · 扫码付款」（照旧）
//
// ⚠️ 「待收款」是给**作业方**看的话（配送员该去收这笔钱 / 运营去盯），不能对客户露出；
//    反过来也不许在作业端被抹成「未支付」（否则配送员不知道要去收钱）。
// ⚠️ 这是**同一份判定的第二套文案**，不是第二套判定：判定仍只有 payStatusOf 一处，
//    页面/服务里禁止内联任何 `payMethod === 2 && ...`。
// ⚠️ 只有采购方侧接口调它；运营对账（dailyReconciliation）与配送员侧继续用 payStatusOf().text。
// ────────────────────────────────────────────────────────────────

/// 客户版「未支付」（unpaid 与 cod_pending 共用同一句）
export const BUYER_UNPAID_TEXT = '未支付'

/// 把判定结果翻成**客户版**文案（两个「已付款」档原样透传，其余一律「未支付」）
export function buyerPayStatusTextOf(status: Pick<PayStatusResult, 'code' | 'text'>): string {
  return status.code === 'paid_wechat' || status.code === 'paid_proof' ? status.text : BUYER_UNPAID_TEXT
}

/// 老数据里点过「我已付款」（order.buyerPaidClaimAt 有值）的只读标注。
/// ⚠️ 仅历史痕迹展示，**不参与实收/未收金额计算**，也不是四档状态之一。
export const HISTORIC_CLAIM_TEXT = '曾称已付（历史口径）'

/// 线上到账与现金收款凭证并存（可能重复收款）的对账行警示文案
export const DUPLICATE_PROOF_TEXT = '⚠️ 另有现金收款凭证，请核对是否重复收款'
