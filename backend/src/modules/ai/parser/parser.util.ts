/**
 * AI 下单解析 · 共享工具
 *
 * ⚠️ 这些口径**必须只有一份实现**（规则版与 LLM 版共用）：
 * 一旦两处各写一遍，「同一个说法两个解析器算出的斤数不一样」这类缺陷会反复回来。
 */

/** 配送日期口径：今天 / 明天（默认）/ 后天 */
export interface DeliveryDate {
  label: string
  iso: string
}

export function resolveDeliveryDate(text: string | null | undefined): DeliveryDate {
  const isoOf = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  const t = text || ''
  if (/(今天|今日)/.test(t)) return { label: '今天', iso: isoOf(0) }
  if (/(后天)/.test(t)) return { label: '后天', iso: isoOf(2) }
  // 默认明天（次日达）
  return { label: '明天', iso: isoOf(1) }
}

/** 这句话有没有明确提到配送时间（今天/明天/后天）——多轮口径：没提就沿用草稿原值，不许被默认值覆盖 */
export function hasDateMention(text: string | null | undefined): boolean {
  return /(今天|今日|明天|明日|后天)/.test(String(text || ''))
}

/**
 * 由 ISO 日期还原出「今天/明天/后天」的展示口径（多轮沿用草稿日期时用）。
 * 不是这三天之一（如用户手改过更远的日期）就原样显示 MM-DD，不瞎猜。
 */
export function resolveDeliveryDateFromIso(iso: string | null | undefined): DeliveryDate | null {
  const s = String(iso || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const isoOf = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  if (s === isoOf(0)) return { label: '今天', iso: s }
  if (s === isoOf(1)) return { label: '明天', iso: s }
  if (s === isoOf(2)) return { label: '后天', iso: s }
  return { label: s.slice(5), iso: s }
}

/**
 * 多轮口径下这一轮的配送日期（唯一实现）：
 * - 这句话（或模型填的日期）提到了时间 → 用它
 * - 没提 → 沿用草稿原值；草稿也没有（首句）→ 走默认明天
 */
export function resolveTurnDeliveryDate(raw: string, modelDate: string | undefined, draftDate: string | undefined): DeliveryDate {
  if (hasDateMention(raw) || hasDateMention(modelDate)) return resolveDeliveryDate(modelDate || raw)
  return resolveDeliveryDateFromIso(draftDate) || resolveDeliveryDate(raw)
}

/** 中文数字 → 阿拉伯数字（一/二/两/三…十、十五、五十、一百二 等） */
const CN_DIGIT: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

export function cnToNum(s: string): number | null {
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  if (!/^[零一二两三四五六七八九十百]+$/.test(s)) return null
  let result = 0
  let current = 0
  for (const ch of s) {
    if (ch === '十') {
      result += (current || 1) * 10
      current = 0
    } else if (ch === '百') {
      result += (current || 1) * 100
      current = 0
    } else {
      current = CN_DIGIT[ch] ?? 0
    }
  }
  result += current
  return result
}

/** 从规格文本提取「约 X 斤/单位」的 X（如「约 2 斤/颗」→ 2） */
export function specJinPerUnit(spec: string | null | undefined): number | null {
  if (!spec) return null
  const m = spec.match(/(\d+(?:\.\d+)?)\s*斤/)
  return m ? Number(m[1]) : null
}

/**
 * 份数单位 → 斤（唯一换算口径）
 * 称重商品（weighType=1）用「颗/个/把」这类份数单位时，按规格换算：2颗 × 约2斤/颗 = 4 斤。
 * 换算不出来（规格里没写几斤）就原样返回，不瞎猜。
 */
export function normalizeQtyToJin(qty: number, unit: string, weighType: number, specText: string | null | undefined): number {
  if (weighType === 1 && ['颗', '个', '把'].includes(unit)) {
    const perUnit = specJinPerUnit(specText)
    if (perUnit) return Math.round(qty * perUnit * 10) / 10
  }
  return qty
}
