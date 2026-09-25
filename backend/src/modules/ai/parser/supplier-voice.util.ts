import { cnToNum } from './parser.util'
import { SupplierNumberCheck } from './supplier.types'

/**
 * 供应商语音解析 · 数字安全阀（卡U ②，2026-09-25）
 *
 * 🔴 红线：模型给出的数字必须能在「识别原文」里找到依据 —— 找不到就不许提交，
 *    强制用户三选一（原型③屏：3.8 / 38 / 380 这种）。这是防「模型把三十八听成 3.8」
 *    这类致命错的最后闸门，价格错了是钱的事。
 *
 * 原文数字串的口径：
 *   - 阿拉伯数字：3.8、38、150 原样取出
 *   - 中文数字：三十八 → 38、两百 → 200（复用采购方唯一的 cnToNum 实现）
 *   - 「X块Y / X元Y」口语钱数：三块八 → 3.8（这是语音报价最常见的形态）
 */

const CN_NUM_CHARS = '零一二两三四五六七八九十百'
const CN_SMALL = '零一二三四五六八九'

/** 从识别原文提取全部「数字依据」（去重，保留原值） */
export function extractNumberCandidates(raw: string): number[] {
  const out: number[] = []
  const push = (n: number) => {
    if (Number.isFinite(n) && n > 0) {
      const v = Math.round(n * 100) / 100
      if (!out.some((x) => Math.abs(x - v) < 0.005)) out.push(v)
    }
  }

  const t = String(raw || '')
  const NUM = `[0-9]+(?:\\.[0-9]+)?|[${CN_NUM_CHARS}]+`
  const SMALL = `[0-9]|[${CN_SMALL}]`

  // ① 口语钱数「X块Y / X元Y」：三块八 → 3.8、3块5 → 3.5、三块 → 3
  const money = t.matchAll(new RegExp(`(${NUM})\\s*[块元]\\s*(${SMALL})?`, 'g'))
  for (const m of money) {
    const x = /^\d/.test(m[1]) ? Number(m[1]) : cnToNum(m[1])
    if (x == null) continue
    if (m[2] !== undefined) {
      const y = /\d/.test(m[2]) ? Number(m[2]) : cnToNum(m[2])
      if (y != null) push(x + y / 10)
    } else {
      push(x)
    }
  }

  // ② 独立数字串：阿拉伯（含小数）与中文数字逐段取出
  const runs = t.matchAll(new RegExp(`(${NUM})`, 'g'))
  for (const m of runs) {
    const s = m[1]
    if (/^\d/.test(s)) push(Number(s))
    else {
      const n = cnToNum(s)
      if (n != null) push(n)
    }
  }

  return out
}

/** value 是否能在原文数字依据里找到（浮点按 2 位小数比对） */
export function isValueGroundedInRaw(value: number, candidates: number[]): boolean {
  return candidates.some((c) => Math.abs(c - value) < 0.005)
}

/**
 * 不一致时的三选一选项（原型③屏 3.8 / 38 / 380 形态）：
 * 原文里最接近的候选优先（那大概率是用户真说的），再补 value 本身和一个 10 倍/十分位变体。
 */
export function buildNumberOptions(value: number, candidates: number[]): number[] {
  const fmt = (n: number) => Math.round(n * 100) / 100
  const ordered: number[] = []
  const add = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return
    const v = fmt(n)
    if (!ordered.some((x) => Math.abs(x - v) < 0.005)) ordered.push(v)
  }

  const sorted = [...candidates].sort((a, b) => Math.abs(a - value) - Math.abs(b - value))
  if (sorted.length) add(sorted[0]) // 原文里最接近的
  add(value)
  if (sorted.length && Math.abs(sorted[0] - value) > 0.005) {
    // 原文候选与模型值都放上之后，第三个给 10 倍量级变体（3.8/38/380 形态）
    add(value * 10)
    add(value / 10)
  } else if (!sorted.length) {
    add(value * 10)
    add(value / 10)
  } else {
    add(value * 10)
    add(value / 10)
  }
  return ordered.slice(0, 3)
}

/** 单个数字的安全阀结论 */
export function checkNumber(value: number, candidates: number[]): SupplierNumberCheck {
  const ok = isValueGroundedInRaw(value, candidates)
  return ok ? { value, consistent: true } : { value, consistent: false, options: buildNumberOptions(value, candidates) }
}
