/**
 * 「模型把没上架的菜配成别的商品」的服务端硬护栏（2026-09-30）
 *
 * ── 为什么需要它（生产实测，2026-09-30 用真 Key 连打 3 轮）──
 * 提示词里早就写了「近亲不许配」（llm.parser 第 5/9 条），但**真模型仍会静默配错**：
 *   · 「苦瓜3斤」            → 大白菜3斤（3 次里 2 次）
 *   · 「大白菜20斤 秋葵5斤」  → 豆角5斤（3 次里 3 次）
 *   · 「大白菜20斤 洋葱10斤」 → 豆角10斤（3 次里 2 次）
 * 后果不止「少提示一句」：草稿里被塞进一个客户**没要的商品**，而前端只会显示「已记下 N 样」——
 * 客户以为记下的和实际记下的不是一回事（这条链上还有采购需求登记与到货通知，全被绕过）。
 *
 * ── 做法（唯一实现：单句口径与 ops 多轮口径共用）──
 * 提示词要求模型对**每条**商品给出 `matched`＝客户原话里对应这个商品的那一段字（原样，不许改写）。
 * 服务端逐条核对（模型自己说出口的字，与它自己挑的商品名是否沾边）：
 *   ① `matched` 必须是客户原话的字面子串 —— 模型没编词；
 *   ② `matched` 与商品名要有**共同的字**：最长公共子串 ≥2；
 *      若商品名或 matched 只有 1~2 个字，放宽到 ≥1（保「猪肉→五花肉」「蒜→大蒜」这类真口语）。
 * 不过 → **丢掉这一条操作**，并把 `matched` 记进 `unmatched`：
 * 客户看到的是「🤔 苦瓜 我还没上架，已帮你记下」（采购需求登记 + 到货通知入口照常）。
 *
 * ⚠️ 兜底方向（这条决定了「加新字段是安全还是事故」，见项目规则）：
 *   · `matched` **缺省**（老提示词 / 模型偷懒）→ 按**通过**处理，只记一条 warn 便于观察 ——
 *     绝不因为模型没带这个字段就把客户正常说的话判成「没上架」（那是把所有人都判错）。
 *   · `matched` 是空的字符串 → 同上（当缺省）。
 *   · `matched` 带上了但与原话不符 / 与商品名不沾边 → 必须丢，宁可少配一个也不许配错。
 */

/** 最长公共子串长度（只关心 0 / 1 / ≥2，超过 4 就够判定，截断避免长句白算） */
export function longestCommonSubstring(a: string, b: string): number {
  const s = String(a || '')
  const t = String(b || '')
  if (!s || !t) return 0
  const maxKeep = 4
  let best = 0
  // dp 一维滚动：prev[j] = 以 s[i-1]/t[j-1] 结尾的公共子串长度
  let prev = new Array(t.length + 1).fill(0)
  for (let i = 1; i <= s.length; i++) {
    const cur = new Array(t.length + 1).fill(0)
    for (let j = 1; j <= t.length; j++) {
      if (s[i - 1] === t[j - 1]) {
        cur[j] = prev[j - 1] + 1
        if (cur[j] > best) best = cur[j]
        if (best >= maxKeep) return best
      }
    }
    prev = cur
  }
  return best
}

/** 归一化：去空白/标点里的常见噪声，只保留有意义的字（不做同义词替换，语义判断是模型的事） */
function normalize(s: string): string {
  return String(s || '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。！？、,.!?"'“”‘’（）()【】\[\]：:；;~～-]/g, '')
}

/**
 * 这一条「商品 + 模型声称的原话字眼」是否可信。
 * @param productName 服务端从 product 表取的名称（不是模型给的）
 * @param matched     模型给的原话片段；空/缺省 = 不做判定（见文件头兜底方向）
 */
export function isMatchPlausible(productName: string, matched?: string): boolean {
  const m = normalize(matched || '')
  if (!m) return true // 缺省 → 通过（兜底方向：宁松不严，避免误伤正常匹配）
  const p = normalize(productName || '')
  if (!p) return false
  // 判据（2026-09-30 收紧）：客户说的字眼与商品名「对得上」= 互为**子串**，且共同部分 ≥2 字。
  //   为什么弃用 LCS：旧实现 LCS≥1 放宽（保「猪肉→五花肉」），恰好放跑了 skill 硬约束第 0 条的
  //   核心案例「杏鲍菇→香菇」——两者只共享一个「菇」字（LCS=1），但完全是两种菇。
  //   子串判断能区分：白菜⊆大白菜（子串，对得上）✓；杏鲍菇⊄香菇且香菇⊄杏鲍菇（拦）✓；
  //   猪肉⊄五花肉（拦，符合「名字对不上就进 unmatched」口径）✓。
  //   一个字的名字（「蒜」）也不可信 → 拦（与规则版 keywords 的 ≥2 字过滤一致）。
  if (m.length < 2) return false
  // 商品名 normalize 后括号已被剥掉（「土豆（黄心）」→「土豆黄心」），这里只做子串互含判断。
  // m.includes(p) 覆盖「大白菜20斤」这类 matched 带数量仍含商品名的口语；方向仍是宁松不严。
  return p.includes(m) || m.includes(p)
}

export interface MatchCandidate<P> {
  product: P
  /** 模型声称的「客户原话里对应这个商品的那一段字」 */
  matched?: string
}

export interface MatchGuardResult<P> {
  ok: MatchCandidate<P>[]
  /** 被丢弃的那些原话片段（调用方要并进 unmatched，让客户看到「还没上架」） */
  rejectedTexts: string[]
  /** 被丢弃但模型没给 matched → 拿不到原话字眼，只能靠规则版兜底命名 */
  rejectedUnnamed: number
  /** 缺 matched 而按通过处理的条数（观察用） */
  missingMatched: number
}

/**
 * 逐条核对模型的匹配。不改变任何输入对象，只做筛选。
 * @param raw        客户原话（这条链路唯一的「事实来源」）
 * @param candidates 模型给出的「商品 + 声称的原话片段」
 */
export function filterMisMatched<P extends { name: string }>(
  raw: string,
  candidates: MatchCandidate<P>[],
): MatchGuardResult<P> {
  const sentence = normalize(raw)
  const ok: MatchCandidate<P>[] = []
  const rejectedTexts: string[] = []
  let rejectedUnnamed = 0
  let missingMatched = 0

  for (const c of candidates) {
    const matched = normalize(c.matched || '')
    if (!matched) {
      // 兜底方向：缺字段 → 通过（不许把所有人判成未上架）
      missingMatched++
      ok.push(c)
      continue
    }
    // ① 模型说的字必须真的在客户原话里
    const inSentence = sentence.includes(matched)
    // ② 这个字必须与商品名沾边
    const plausible = isMatchPlausible(c.product?.name || '', matched)
    if (inSentence && plausible) {
      ok.push(c)
      continue
    }
    if (inSentence) rejectedTexts.push(matched)
    else rejectedUnnamed++
  }

  return { ok, rejectedTexts, rejectedUnnamed, missingMatched }
}
