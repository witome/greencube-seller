/**
 * 微信订阅消息 · 模板字段解析 + 按字段类型格式化（**全仓唯一实现**）
 *
 * 为什么单独一个文件：这两件事都必须**只有一处实现** ——
 *   · 解析模板字段：从 `gettemplate` 返回的 `content` 里取字段名/类型，错一处就 47003；
 *   · 按类型格式化：thing ≤20 字、amount 要币种符号、number 只能纯数字……
 *     散落在业务代码里迟早有一处忘了截断，那就等于把微信的 47003 抛给运营。
 *
 * 📐 类型与限制来自官方文档「订阅消息参数值内容限制」（2026-09-25 核对）：
 *
 * | 类型              | 限制                                            | 正则                                            |
 * |-------------------|-------------------------------------------------|-------------------------------------------------|
 * | thing             | 20 个以内字符                                   | ^[a-zA-Z0-9!@#$%^&*()_+={}\[\]:;"'<>,.?/~`-]{1,20}$ |
 * | number            | 32 位以内数字                                   | ^[0-9]{1,32}(\.[0-9]+)?$                        |
 * | letter            | 32 位以内字母                                   | ^[a-zA-Z]{1,32}$                                |
 * | symbol            | 5 位以内符号                                    | ^[^\w\s]{1,5}$                                  |
 * | character_string  | 64 位以内数字、字母或符号                        | ^[a-zA-Z0-9\W_]{1,64}$                          |
 * | time              | hh:mm 或 hh:mm:ss（可 `~` 连两段）               | ^(?:(?:([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?… |
 * | date              | yyyy-MM-dd 或 yyyy-MM-dd hh:mm:ss（可 `~`）      | ^(\d{4}-[01]\d-[0-3]\d(?: …                      |
 * | amount            | **1 个币种符号 + 10 位以内纯数字，可带小数**      | ^[A-Za-z$€¥]{1}[\d]{0,8}(\.\d{1,2})?$            |
 * | phone_number      | 17 位以内，数字、符号                            | ^[\d\-+\$\s]{1,17}$                              |
 * | car_number        | 12 位以内字符                                    | ^.{1,12}$                                        |
 * | name              | 32 位以内字符                                    | ^.{1,32}$                                        |
 * | phrase            | 16 位以内字符（原文档写「5 个以内汉字」，实际取宽）| ^.{1,16}$                                        |
 *
 * ⚠️ **一个必须说明的取舍**：官方给 thing 的正则是纯 ASCII 那串 `[a-zA-Z0-9!@#$%…]`，
 *    按字面执行会把汉字全删掉 —— 而现实中所有模板的 thing 字段装的就是中文
 *    （「订单号: XXX」这类），显然文档正则不完整。故我们对 thing **只做长度截断 +
 *    去换行/控制字符，不删汉字**，否则消息就没内容了。
 *
 * ⚠️ **amount 必须带币种符号**：正则 `[A-Za-z$€¥]{1}[\d]{0,8}(\.\d{1,2})?` 要求首位是币种符号，
 *    所以「商品单价」这类 amount 字段我们输出 `¥5.80` 而不是 `5.80`（纯数字会被微信判格式错）。
 *    若模板字段是 number 类型，则输出纯数字 `5.80`（符合 number 的正则）。
 *    口径：**这两种都满足官方限制，目的就是「不许把 47003 抛给用户」**。
 */

/** 模板里的一个字段（从 content 的 `{{field.DATA}}` 解析出来） */
export interface TmplKeyword {
  /** 发送时 data 的键，例如 `thing1` / `amount2`（**就是 content 里 {{}} 中的那段**） */
  key: string
  /** 字段类型（key 的字母前缀），例如 thing / amount / number / time */
  type: string
  /** 序号（key 里的数字），例如 thing1 → 1；没有数字则 null */
  kid: number | null
  /** 字段中文名（content 里冒号左边那段），例如「商品单价」 */
  name: string
}

/** 把模板 content 解析成字段列表。`商品名称:{{thing1.DATA}}` → { key:'thing1', type:'thing', kid:1, name:'商品名称' } */
export function parseTemplateContent(content: string): TmplKeyword[] {
  const out: TmplKeyword[] = []
  const seen = new Set<string>()
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const m = line.match(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*?)\s*\.\s*DATA\s*\}\}/)
    if (!m) continue
    const key = m[1]
    if (seen.has(key)) continue
    seen.add(key)
    const label = line.split('{')[0].replace(/[:：]\s*$/, '').trim()
    const numMatch = key.match(/(\d+)$/)
    out.push({
      key,
      type: key.replace(/\d+$/, '').toLowerCase(),
      kid: numMatch ? Number(numMatch[1]) : null,
      name: label,
    })
  }
  return out
}

/** 从 `{price}` 里取出变量名；不是变量模板（纯字面量）则返回 null */
export function extractVarName(tpl: string): string | null {
  const m = String(tpl || '').match(/^\{([a-zA-Z][a-zA-Z0-9_]*)\}$/)
  return m ? m[1] : null
}

/** 字段类型归一：`thing1` / `thing.DATA` / `Thing` → `thing` */
export function normalizeFieldType(typeOrKey: string): string {
  return String(typeOrKey || '')
    .replace(/\.DATA$/i, '')
    .replace(/\d+$/, '')
    .toLowerCase()
    .trim()
}

/** 类型分组：数值型（必须有真实数字）/ 时间型（可自动填当下）/ 文本型（可截断） */
const NUMERIC_TYPES = new Set(['number', 'amount', 'digit'])
const TIME_TYPES = new Set(['time', 'date'])
export const isNumericFieldType = (t: string) => NUMERIC_TYPES.has(normalizeFieldType(t))

const pad = (n: number) => String(n).padStart(2, '0')
export const fmtTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
export const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * 格式化结果。
 * ⚠️ 用**宽松接口**而不是「判别联合」：本仓 `tsconfig.json` 是 `strictNullChecks: false`，
 *    判别联合在这种配置下窄化不可靠（实测 `if (!r.ok)` 之后访问 `r.reason` 报 TS2339）。
 *    约定：`ok=true` 时读 `value`，`ok=false` 时读 `reason`，两者互斥。
 */
export interface FormatResult {
  ok: boolean
  /** ok=true 时：最终写进 data 的值 */
  value?: string
  /** 被就地修正过（截断/补格式）时，这里是给人看的一句话说明 */
  fixed?: string
  /** ok=false 时：为什么给不出合法值（**人话**，会原样进日志与后台） */
  reason?: string
}

/** 去掉换行 / 制表 / 控制字符 —— 它们会破坏模板排版，且 thing 不接受 */
function stripBreaks(s: string): string {
  return String(s ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** 截断到 max 个字符（按 Unicode 码点算，避免把 emoji/生僻字切成半个） */
function clip(s: string, max: number): { text: string; clipped: boolean } {
  const arr = Array.from(s)
  if (arr.length <= max) return { text: s, clipped: false }
  return { text: arr.slice(0, max).join(''), clipped: true }
}

/** 把各种写法的金额洗成数字字符串：¥5.8 / 5.8元 / 1,200.00 → 5.80 / 1200.00 */
export function toAmountString(raw: string | number): string | null {
  if (raw == null) return null
  const s = String(raw).replace(/[,\s]/g, '').replace(/[A-Za-z$€¥￥元]/g, '')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return n.toFixed(2)
}

/**
 * 按字段类型格式化一个值。**永不抛异常**：给不出合法值就返回 ok=false + 人话 reason，
 * 由调用方决定「换兜底文案」还是「礼貌拒绝并告诉运营怎么修」。
 *
 * @param type 字段类型（thing/amount/number/time/date/…）
 * @param raw  已由调用方解析好的值（变量已替换）；null/'' 表示没有值
 */
export function formatFieldValue(type: string, raw: string | number | null | undefined, now: Date = new Date()): FormatResult {
  const t = normalizeFieldType(type)
  const has = raw !== null && raw !== undefined && String(raw).trim() !== ''

  if (!has) {
    if (t === 'time') return { ok: true, value: fmtTime(now), fixed: 'time 字段没给值 → 自动填当前时刻' }
    if (t === 'date') return { ok: true, value: fmtDate(now), fixed: 'date 字段没给值 → 自动填当天' }
    return { ok: false, reason: `${t || 'thing'} 字段没有可用值` }
  }

  const s = stripBreaks(String(raw))

  switch (t) {
    case 'number':
    case 'digit': {
      const a = toAmountString(s)
      if (!a) return { ok: false, reason: `number 字段的值不是合法数字：「${s}」` }
      const intPart = a.split('.')[0]
      if (intPart.length > 32) return { ok: false, reason: `number 字段整数位超过 32 位` }
      return { ok: true, value: a }
    }
    case 'amount': {
      const a = toAmountString(s)
      if (!a) return { ok: false, reason: `amount 字段的值不是合法数字：「${s}」` }
      // 官方 amount 正则要求「1 个币种符号 + 10 位以内纯数字，可带小数」→ 首位必须给币种符号
      let out = `¥${a}`
      let fixed: string | undefined
      const intPart = a.split('.')[0]
      if (intPart.length > 8) {
        // 超过 8 位整数位不符合官方限制；报价不可能到这量级，截前 8 位并明确标记
        out = `¥${intPart.slice(0, 8)}.00`
        fixed = 'amount 整数位超过 8 位，已按前 8 位截断'
      }
      return { ok: true, value: out, fixed }
    }
    case 'time': {
      const m = s.match(/([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)(?:\s*[:：]\s*([0-5]\d))?/)
      if (!m) return { ok: true, value: fmtTime(now), fixed: `time 字段值不是时间格式，已改用当前时刻` }
      return { ok: true, value: `${pad(Number(m[1]))}:${m[2]}${m[3] ? ':' + m[3] : ''}` }
    }
    case 'date': {
      const m = s.match(/(\d{4})\D{1,2}(\d{1,2})\D{1,2}(\d{1,2})/)
      if (!m) return { ok: true, value: fmtDate(now), fixed: 'date 字段值不是日期格式，已改用当天' }
      return { ok: true, value: `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}` }
    }
    case 'letter': {
      const v = s.replace(/[^a-zA-Z]/g, '')
      if (!v) return { ok: false, reason: `letter 字段必须只含字母：「${s}」` }
      const c = clip(v, 32)
      return { ok: true, value: c.text, fixed: c.clipped ? 'letter 超 32 位已截断' : undefined }
    }
    case 'symbol': {
      const v = s.replace(/[\w\s]/g, '')
      if (!v) return { ok: false, reason: `symbol 字段必须是符号：「${s}」` }
      const c = clip(v, 5)
      return { ok: true, value: c.text, fixed: c.clipped ? 'symbol 超 5 位已截断' : undefined }
    }
    case 'phone_number': {
      const v = s.replace(/[^\d+\-\s]/g, '')
      const c = clip(v, 17)
      if (!c.text) return { ok: false, reason: 'phone_number 字段没有可用数字' }
      return { ok: true, value: c.text, fixed: c.clipped ? 'phone_number 超 17 位已截断' : undefined }
    }
    case 'car_number': {
      const c = clip(s, 12)
      return { ok: true, value: c.text, fixed: c.clipped ? 'car_number 超 12 位已截断' : undefined }
    }
    case 'name': {
      const c = clip(s, 32)
      return { ok: true, value: c.text, fixed: c.clipped ? 'name 超 32 位已截断' : undefined }
    }
    case 'character_string': {
      const c = clip(s, 64)
      return { ok: true, value: c.text, fixed: c.clipped ? 'character_string 超 64 位已截断' : undefined }
    }
    case 'phrase': {
      const c = clip(s, 16)
      return { ok: true, value: c.text, fixed: c.clipped ? 'phrase 超 16 位已截断' : undefined }
    }
    case 'thing':
    default: {
      // ⚠️ 按上面注释的取舍：thing 只截长度、不删汉字
      const c = clip(s, 20)
      return { ok: true, value: c.text, fixed: c.clipped ? 'thing 超 20 字已截断' : undefined }
    }
  }
}

/** 兜底填充（模板里有我们没映射上的字段时用，避免「缺字段」被微信判 47003） */
export function fillerFor(type: string, now: Date = new Date()): string {
  const t = normalizeFieldType(type)
  switch (t) {
    case 'number':
    case 'digit':
      return '0'
    case 'amount':
      return '¥0'
    case 'time':
      return fmtTime(now)
    case 'date':
      return fmtDate(now)
    case 'letter':
      return 'NA'
    case 'symbol':
      return '-'
    default:
      return '无'
  }
}
