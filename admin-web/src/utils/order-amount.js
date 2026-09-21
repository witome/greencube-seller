// 订单「应收」金额口径（前端唯一实现）
//
// 与后端 backend/src/common/utils/amount.util.ts: receivableAmount 逐字一致：
//   amountFinal 非空 → 取 amountFinal（核单后已含运费）
//   否则            → amountOrdered + deliveryFee（未核单称重时的兜底）
//
// 履约页「金额」列与每日对账页「金额」列必须都由本函数产出，不得各自实现。
export function receivableOf(row) {
  if (!row) return 0
  return row.amountFinal != null
    ? Number(row.amountFinal)
    : Number(row.amountOrdered) + Number(row.deliveryFee)
}

// 金额显示：两位小数
export function money(n) {
  return Number(n ?? 0).toFixed(2)
}
