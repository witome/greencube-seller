import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

/**
 * AI 客服下单引擎（MVP 规则/关键词解析版）
 * 输入自然语言（如「土豆50斤，白菜两颗，要嫩一点的，明天早上送到」），
 * 匹配在售商品 + 提取数量/备注/配送日期，输出订单草稿。
 * 后续可替换为大模型解析，接口结构保持不变。
 */

/// 中文数字 → 阿拉伯数字（支持 一/二/两/三…十、十五、五十、一百二 等）
const CN_DIGIT: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

function cnToNum(s: string): number | null {
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

interface ParsedItem {
  productId: number
  name: string
  unit: string
  specText: string | null
  weighType: number
  qty: number
  qtyText: string
  price: number
  amount: number
}

export interface ParseResult {
  items: ParsedItem[]
  remark: string
  deliveryDateLabel: string
  deliveryDate: string
  total: number
  matchedCount: number
  hasUnmatched: boolean
  rawText: string
}

@Injectable()
export class AiService {
  constructor(private prisma: PrismaService) {}

  async parse(text: string): Promise<ParseResult> {
    const raw = (text || '').trim()
    const products = await this.prisma.product.findMany({
      where: { status: 1 },
      orderBy: { id: 'asc' },
    })

    const items: ParsedItem[] = []
    const matchedKeywords: { keyword: string; index: number }[] = []
    const usedKeywords = new Set<string>()

    // ① 逐商品匹配 + 提取数量（按 id 升序，先到先得；关键词去重，避免「大白菜」「白菜001」重复匹配）
    for (const p of products) {
      const keywords = this.keywords(p.name)
      let hitIndex = -1
      let hitKeyword = ''
      // 长关键词优先（更精确）
      for (const kw of [...keywords].sort((a, b) => b.length - a.length)) {
        if (usedKeywords.has(kw)) continue
        const idx = raw.indexOf(kw)
        if (idx >= 0) {
          hitIndex = idx
          hitKeyword = kw
          usedKeywords.add(kw)
          break
        }
      }
      if (hitIndex < 0) continue

      const qtyResult = this.extractQty(raw, hitIndex + hitKeyword.length)
      let qty = qtyResult.num
      // 称重商品用「颗/个/把」等份数单位时，按规格换算成斤（如「约 2 斤/颗」）
      if (p.weighType === 1 && ['颗', '个', '把'].includes(qtyResult.unit) && p.specText) {
        const perUnit = this.specJinPerUnit(p.specText)
        if (perUnit) qty = Math.round(qtyResult.num * perUnit * 10) / 10
      }
      const price = Number(p.salePrice)
      items.push({
        productId: Number(p.id),
        name: p.name,
        unit: p.unit || '斤',
        specText: p.specText,
        weighType: p.weighType,
        qty,
        qtyText: qtyResult.text,
        price,
        amount: Math.round(qty * price * 100) / 100,
      })
      matchedKeywords.push({ keyword: hitKeyword, index: hitIndex })
    }

    // ② 配送日期：今天/明天/后天，默认明天
    const deliveryDate = this.extractDate(raw)

    // ③ 备注：去掉商品关键词、数量词、配送时间表述后，剩余的片段
    const remark = this.extractRemark(raw, matchedKeywords)

    // ④ 合计
    const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100

    return {
      items,
      remark,
      deliveryDateLabel: deliveryDate.label,
      deliveryDate: deliveryDate.iso,
      total,
      matchedCount: items.length,
      hasUnmatched: this.hasUnmatched(raw, items, matchedKeywords),
      rawText: raw,
    }
  }

  // ── 生成商品匹配关键词：全名 / 去括号 / 括号内容 / 去数字 / 去修饰前缀 ──
  private keywords(name: string): string[] {
    const set = new Set<string>()
    set.add(name)
    const paren = name.match(/[（(](.*?)[)）]/)
    if (paren) set.add(paren[1])
    const noParen = name.replace(/[（(].*?[)）]/g, '').replace(/\d+/g, '').trim()
    if (noParen && noParen !== name) set.add(noParen)
    // 去掉常见修饰前缀（大/本地/山东/精选/新鲜等）
    const core = noParen.replace(/^(大|本地|山东|精选|新鲜|有机|精品)/, '')
    if (core.length >= 2 && core !== noParen) set.add(core)
    return [...set].filter((k) => k.length >= 2)
  }

  // ── 提取商品名后的数量：支持「50斤」「两颗」「一箱」「三把」「2个」等 ──
  private extractQty(text: string, fromIndex: number): { num: number; unit: string; text: string } {
    const after = text.slice(fromIndex)
    const m = after.match(/^\s*[，,、.。；;]?\s*(?:(\d+(?:\.\d+)?)|([零一二两三四五六七八九十百]+))\s*(斤|公斤|千克|颗|个|把|箱|枚|份|盒|条|包)?/)
    if (!m) return { num: 1, unit: '', text: '1' }
    const num = m[1] ? Number(m[1]) : (cnToNum(m[2]) ?? 1)
    const unit = m[3] || ''
    const display = m[1] ? `${m[1]}${unit}` : `${m[2]}${unit}`
    return { num: num > 0 ? num : 1, unit, text: display || String(num) }
  }

  // ── 从规格文本提取「约 X 斤/单位」的 X（用于份数 → 斤换算）──
  private specJinPerUnit(spec: string): number | null {
    const m = spec.match(/(\d+(?:\.\d+)?)\s*斤/)
    return m ? Number(m[1]) : null
  }

  // ── 配送日期解析 ──
  private extractDate(text: string): { label: string; iso: string } {
    const day = (offset: number) => {
      const d = new Date()
      d.setDate(d.getDate() + offset)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
    if (/(今天|今日)/.test(text)) return { label: '今天', iso: day(0) }
    if (/(后天)/.test(text)) return { label: '后天', iso: day(2) }
    // 默认明天（次日达）
    return { label: '明天', iso: day(1) }
  }

  // ── 备注提取：按标点切分，去掉含商品/数量/配送时间的片段 ──
  private extractRemark(text: string, matched: { keyword: string; index: number }[]): string {
    const segments = text.split(/[，,、。；;\s]+/).map((s) => s.trim()).filter(Boolean)
    const drop = (seg: string) => {
      // 含商品关键词
      if (matched.some((m) => seg.includes(m.keyword))) return true
      // 纯数量
      if (/^[\d零一二两三四五六七八九十百十]+(斤|公斤|千克|颗|个|把|箱|枚|份|盒|条|包)?$/.test(seg)) return true
      // 配送时间表述
      if (/(今天|今日|明天|明日|后天|早上|上午|中午|下午|晚上|送到|送达|配送)/.test(seg)) return true
      return false
    }
    const kept = segments.filter((s) => !drop(s))
    return kept.join('，') || ''
  }

  // ── 判断是否有未识别的内容（供前端提示） ──
  private hasUnmatched(text: string, items: ParsedItem[], matched: { keyword: string; index: number }[]): boolean {
    // 粗略判断：文本里还有「数字+单位」但没被匹配进 items（比如「一箱鸡蛋」里鸡蛋无对应商品）
    const qtyPattern = /(?:[零一二两三四五六七八九十百十]+|\d+(?:\.\d+)?)\s*(斤|公斤|千克|颗|个|把|箱|枚|份|盒|条|包)/g
    let count = 0
    let m: RegExpExecArray | null
    while ((m = qtyPattern.exec(text)) !== null) count++
    return count > items.length
  }
}
