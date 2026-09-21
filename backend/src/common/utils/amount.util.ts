/// 订单「应收」金额口径 —— 唯一实现，禁止在别处再写第二套
///
/// 规则（2026-09-21 卡T 固化为单一出口）：
///   amountFinal 非空 → 取 amountFinal（核单后已含运费）
///   否则            → amountOrdered + deliveryFee（未核单称重时的兜底）
///
/// 与 courier.service.ts 的 COD 应收金额口径一致；
/// 履约页「金额」列与每日对账页「应收」必须都由本函数产出，不得各自实现。
export function receivableAmount(o: {
  amountFinal: unknown
  amountOrdered: unknown
  deliveryFee: unknown
}): number {
  return o.amountFinal != null
    ? Number(o.amountFinal)
    : Number(o.amountOrdered) + Number(o.deliveryFee)
}

/// 保留两位小数（对账页汇总口径用）
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
