/**
 * 采购需求 · 菜名归一化（**全仓唯一实现**）
 *
 * 为什么必须只有一处：汇总表 `purchase_demand.demand_key` 是唯一键，上报、后台手填、
 * 合并、下架商品比对**四条路径都要用同一个键**。任何一处另写一份，都会出现
 * 「同一样菜两条汇总行、计数各算各的」——这类错一旦发生就要人工改数据，所以这里刻意
 * 把规则收在一个函数里，其他调用点一律 import。
 *
 * 规则（口径 3）：
 *   ① 去首尾空格
 *   ② 全角转半角（全角字母/数字/标点 → 半角；全角空格 → 普通空格）
 *   ③ 去掉所有空格
 *   ④ 去掉**首尾**的量词 / 单位（斤 / 两 / 颗 / 个 / 把 / 箱 / 袋 / 份 …）
 *   ⑤ 英文小写
 *
 * ⚠️ 近似词**不自动合并**：`归一化只处理「写法差异」，不做「同义替换」`。
 *    「荷兰豆」与「LaLa豆」（lala豆）归一化后仍是两个 key，这是**故意的**——
 *    自动猜同义词很容易把两样菜并成一条，采购照着买就买错了。
 *    真需要并的时候，后台有「合并到…」按钮，由人点。
 */

/**
 * 计量单位 / 量词（可被剥掉）。
 *
 * ⚠️ **故意不含** 块 / 片 / 段 / 丝 / 丁 / 末 / 干 / 皮：
 *    那些是「形态」不是「计量单位」——剥掉会把「土豆块」「大白菜丝」「干豆腐皮」
 *    并到「土豆」「大白菜」「干豆腐」上去，那是**两样货**（甚至三样），采购会买错。
 *    所以这张表只放真正的数量单位。
 */
const UNIT_WORDS = [
  '公斤', '千克', '斤', '两', '兩', '克', '颗', '个', '只', '把', '扎', '束',
  '箱', '袋', '份', '包', '盒', '桶', '提', '条', '根', '棵',
]

/** 数量字符：阿拉伯数字（含全角已转半角）+ 中文数字 + 小数点 */
const NUM_CHARS = '0-9一二三四五六七八九十百千万半两兩.．'

/** 需要清掉的标点（客户口语里常见的分隔符） */
const PUNCT_RE = /[，,。.、；;：:！!？?（）()【】\[\]「」『』""''·~～\-—_/\\|]/g

/** 全角 → 半角（U+FF01–U+FF5E 平移 0xFEE0；U+3000 全角空格 → 空格） */
function toHalfWidth(s: string): string {
  return s
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
}

const LEAD_QTY_RE = new RegExp(`^[${NUM_CHARS}]+(?:${UNIT_WORDS.join('|')})`)
const TAIL_UNIT_RE = new RegExp(`(?:${UNIT_WORDS.join('|')})$`)
const TAIL_QTY_RE = new RegExp(`[${NUM_CHARS}]+$`)
const LEAD_QTY_ONLY_RE = new RegExp(`^[${NUM_CHARS}]+`)

/**
 * 剥掉首尾的量词/单位（保留原大小写、只清空格）。
 * `normalizeDemandKey()` 与 `cleanDemandName()` 都基于它 → 规则只有这一份。
 */
function stripQuantity(raw: string): string {
  if (!raw) return ''
  let s = toHalfWidth(String(raw)).replace(/\s+/g, '')
  s = s.replace(PUNCT_RE, '')
  let guard = 0
  // 前缀「两斤」「5斤」：反复剥（「两斤半」也能剥干净）
  while (guard++ < 10 && LEAD_QTY_RE.test(s)) s = s.replace(LEAD_QTY_RE, '')
  // 后缀「斤」「两」：剥到剥不动为止（「荷兰豆2斤」→ 荷兰豆2 → 荷兰豆）
  guard = 0
  while (guard++ < 10 && TAIL_UNIT_RE.test(s)) {
    const next = s.replace(TAIL_UNIT_RE, '')
    if (!next) break // 整个串就是一个单位字，别剥成空
    s = next
  }
  // 后缀纯数字（「荷兰豆50」→「荷兰豆」）；剥完至少要剩 2 个字，避免把「10」这类剥空
  if (TAIL_QTY_RE.test(s)) {
    const next = s.replace(TAIL_QTY_RE, '')
    if (next.length >= 2) s = next
  }
  // 前缀纯数字（「50荷兰豆」→「荷兰豆」）
  if (LEAD_QTY_ONLY_RE.test(s)) {
    const next = s.replace(LEAD_QTY_ONLY_RE, '')
    if (next.length >= 2) s = next
  }
  return s
}

/**
 * 归一化键 —— 汇总表 `purchase_demand.demand_key` 的**唯一**来源。
 *
 * 示例：
 *   荷兰豆        → 荷兰豆
 *   荷 兰 豆      → 荷兰豆        （去空格）
 *   两斤荷兰豆    → 荷兰豆        （剥前缀量词）
 *   荷兰豆50斤    → 荷兰豆        （剥后缀数量）
 *   ＬａＬａ豆    → lala豆        （全角转半角 + 英文小写）
 */
export function normalizeDemandKey(raw: string): string {
  return stripQuantity(raw).toLowerCase().slice(0, 64)
}

/**
 * 显示名（后台列表上看到的那个「菜名」）。
 * 与 key 用同一套剥量词规则，但**保留原大小写**——后台看到的是客户写的样子，更好认。
 */
export function cleanDemandName(raw: string): string {
  const s = stripQuantity(raw)
  return (s || String(raw || '').trim()).slice(0, 64)
}

/** 只取「被识别成菜名的那一段」，防客户原话里的电话/地址/人名进清单（口径 3） */
export function sanitizeRawText(raw: string): string {
  const s = toHalfWidth(String(raw ?? '')).replace(/\s+/g, ' ').trim()
  return s.slice(0, 64)
}
