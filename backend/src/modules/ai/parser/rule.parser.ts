import { Injectable } from '@nestjs/common'
import { IParser, ParseResult, ParsedItem, ProductRow } from './parser.types'
import { cnToNum, normalizeQtyToJin, resolveDeliveryDate } from './parser.util'

/**
 * 规则 / 关键词解析版（原 ai.service.ts 的逻辑，2026-09-23 原样平移到这里，一行逻辑没改）
 *
 * 它的定位变了：从「唯一的解析器」变成「大模型的降级兜底」——
 * 大模型没配 Key、超时、返回垃圾时，用户仍然能靠它下单（表现为「今天AI有点笨」，而不是「下不了单」）。
 * ⚠️ 这份实现要一直留着，别删。
 */
@Injectable()
export class RuleParser implements IParser {
  readonly name = 'rule' as const

  async parse(text: string, products: ProductRow[]): Promise<ParseResult> {
    const raw = (text || '').trim()

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
      // 称重商品用「颗/个/把」等份数单位时，按规格换算成斤（换算口径见 parser.util.normalizeQtyToJin）
      const qty = normalizeQtyToJin(qtyResult.num, qtyResult.unit, p.weighType, p.specText)
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
    const deliveryDate = resolveDeliveryDate(raw)

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
      parser: 'rule',
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
