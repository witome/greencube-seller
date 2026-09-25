import { Injectable } from '@nestjs/common'
import { cnToNum } from './parser.util'
import { SupplierProductRow, SupplierTurnResult, SupplierVoiceOp } from './supplier.types'

/**
 * 供应商「语音报量 / 改价」· 规则版（卡U ③，2026-09-25）
 *
 * 定位与大模型版的关系，同采购方 RuleParser/LlmParser：**大模型永远不是单点**，
 * 没 Key / 超时 / 报错 / 一个商品都没匹配上时由它兜底 —— 表现是「今天AI有点笨」，
 * 绝不是「用不了」。
 *
 * 规则口径（认「菜名 + 价格 + 数量」的固定语序，按标点切段逐段认）：
 *   - 「西红柿三块八」     → setPrice 3.8（X块Y 口语钱数）
 *   - 「西红柿三十八」     → setPrice 38（裸数字默认当改价 —— 供应商单独报一个数，最常见是报价）
 *   - 「今天有两百斤」     → setSupply 200
 *   - 「土豆五斤」名下没有  → unmatched「土豆」
 */

@Injectable()
export class SupplierRuleParser {
  /** 与采购方 rule.parser 同源的 keyword 生成（全名 / 括号内容 / 去修饰前缀），但**只对本供应商名下商品** */
  private keywords(name: string): string[] {
    const set = new Set<string>()
    set.add(name)
    const paren = name.match(/[（(](.*?)[)）]/)
    if (paren) set.add(paren[1])
    const noParen = name.replace(/[（(].*?[)）]/g, '').replace(/\d+/g, '').trim()
    if (noParen && noParen !== name) set.add(noParen)
    const core = noParen.replace(/^(大|本地|山东|精选|新鲜|有机|精品)/, '')
    if (core.length >= 2 && core !== noParen) set.add(core)
    return [...set].filter((k) => k.length >= 2)
  }

  async parse(text: string, products: SupplierProductRow[]): Promise<SupplierTurnResult> {
    const raw = (text || '').trim()
    const ops: SupplierVoiceOp[] = []
    const unmatched: string[] = []
    const usedKeywords = new Set<string>()

    // 按标点切段，每段最多认一个商品（原型 v2 刻意没做「一次说好几个菜」的多菜混说，这里够用）
    const segments = raw.split(/[，,。；;、\s]+/).map((s) => s.trim()).filter(Boolean)
    let lastHit: SupplierProductRow | null = null // 「西红柿三块八，今天有两百斤」的后半段靠它承接

    for (const seg of segments) {
      // ① 长关键词优先匹配本段商品（关键词全句去重，避免「大白菜/白菜001」重复命中）
      let hit: { p: SupplierProductRow; kw: string } | null = null
      for (const p of [...products].sort((a, b) => b.name.length - a.name.length)) {
        for (const kw of [...this.keywords(p.name)].sort((a, b) => b.length - a.length)) {
          if (usedKeywords.has(kw)) continue
          if (seg.includes(kw)) {
            hit = { p, kw }
            usedKeywords.add(kw)
            break
          }
        }
        if (hit) break
      }

      const rest = hit ? seg.slice(seg.indexOf(hit.kw) + hit.kw.length) : ''
      const parsed = hit ? this.extractValues(rest) : null

      if (hit && parsed) {
        if (parsed.price !== null) {
          ops.push({ op: 'setPrice', productId: hit.p.productId, value: parsed.price, valueText: parsed.priceText! })
        }
        if (parsed.qty !== null) {
          ops.push({ op: 'setSupply', productId: hit.p.productId, value: parsed.qty, valueText: parsed.qtyText! })
        }
        lastHit = hit.p
        // 段里有商品但没有认出任何数字 → 当「只是提到了菜」处理，不 unmatched（不制造噪声）
        continue
      }

      // ② 没匹配上商品：剥掉数字/单位/套话后剩下的部分当「菜名」交给上层找候选
      const nameLike = this.stripNonName(seg)
      if (nameLike.length >= 1 && this.looksLikeItem(seg)) {
        // 数值要从「菜名之后」的片段提取（与命中分支同一口径），整段提取会把菜名咬在前面提取失败
        const restSeg = seg.toLowerCase().includes(nameLike.toLowerCase())
          ? seg.slice(seg.indexOf(nameLike) + nameLike.length)
          : seg
        let parsed0 = this.extractValues(restSeg)
        if (parsed0.price === null && parsed0.qty === null) parsed0 = this.extractValues(seg)
        if (parsed0.price !== null) {
          unmatched.push(nameLike)
          ops.push({ op: 'setPrice', value: parsed0.price, valueText: parsed0.priceText!, name: nameLike })
        } else if (parsed0.qty !== null) {
          unmatched.push(nameLike)
          ops.push({ op: 'setSupply', value: parsed0.qty, valueText: parsed0.qtyText!, name: nameLike })
        }
      } else if (lastHit) {
        // ③ 无菜名的后续段（「今天有两百斤」）→ 挂到最近一个命中商品上（口语承接，验收标准句就长这样）
        const parsed1 = this.extractValues(seg)
        if (parsed1.price !== null) {
          ops.push({ op: 'setPrice', productId: lastHit.productId, value: parsed1.price, valueText: parsed1.priceText! })
        }
        if (parsed1.qty !== null) {
          ops.push({ op: 'setSupply', productId: lastHit.productId, value: parsed1.qty, valueText: parsed1.qtyText! })
        }
      }
    }

    return { ops, unmatched }
  }

  /** 从商品名之后的片段提取「价格 / 数量」 */
  private extractValues(after: string): {
    price: number | null; priceText?: string
    qty: number | null; qtyText?: string
  } {
    let price: number | null = null
    let priceText: string | undefined
    let qty: number | null = null
    let qtyText: string | undefined

    const t = after.trim()
    const NUM = '([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十百]+)'
    const SMALL = '([0-9]|[零一二三四五六八九])'

    // 价格形态 1：X块Y / X块 / X元Y（三块八 → 3.8）
    const m1 = t.match(new RegExp(`^\\s*(?:是|改|价格|供货价|价)?\\s*${NUM}\\s*[块元]\\s*${SMALL}?`, ''))
    if (m1) {
      const x = /^\d/.test(m1[1]) ? Number(m1[1]) : cnToNum(m1[1])
      if (x != null && x > 0) {
        if (m1[2] !== undefined) {
          const y = /\d/.test(m1[2]) ? Number(m1[2]) : cnToNum(m1[2])
          if (y != null) {
            price = Math.round((x + y / 10) * 100) / 100
            priceText = `${m1[1]}块${m1[2]}`
          }
        } else {
          price = x
          priceText = `${m1[1]}块`
        }
      }
    }

    // 价格形态 2：小数直说（3.8 / 3块8 都盖不住的「三块」已盖住）
    if (price === null) {
      const m2 = t.match(/^\s*(?:是|改|价格|供货价|价)?\s*(\d+\.\d+)/)
      if (m2) {
        price = Number(m2[1])
        priceText = m2[1]
      }
    }

    // 数量：今天有/备/给 + 数字 + 单位（斤/公斤/千克/把/箱/颗/个…；公斤、千克按 2 折算，其余原样）
    const m3 = t.match(new RegExp(`(?:今天|今日|每日|现在)?(?:有|备|给|供应|可供)?\\s*${NUM}\\s*(斤|公斤|千克|把|箱|颗|个|枚|份|盒|条|包)`, ''))
    if (m3) {
      const n = /^\d/.test(m3[1]) ? Number(m3[1]) : cnToNum(m3[1])
      if (n != null && n > 0) {
        // 公斤/千克按 2 折算；其余单位（斤/把/箱…）原样（日可供量本来就按商品单位计）
        qty = m3[2] === '公斤' || m3[2] === '千克' ? Math.round(n * 2 * 100) / 100 : n
        qtyText = `${m3[1]}${m3[2]}`
      }
    }

    // 裸数字（没带块/元/斤）且还没认出价格 → 默认当改价（报一个孤零零的数，最常见是报价）
    if (price === null && qty === null) {
      const m4 = t.match(new RegExp(`^\\s*(?:是|改|价格|供货价|价)?\\s*${NUM}\\s*$`, ''))
      if (m4) {
        const n = /^\d/.test(m4[1]) ? Number(m4[1]) : cnToNum(m4[1])
        if (n != null && n > 0) {
          price = n
          priceText = m4[1]
        }
      }
    }

    return { price, priceText, qty, qtyText }
  }

  /** 剥掉数字/单位/套话，剩下的当菜名候选（「土豆五斤」→「土豆」） */
  private stripNonName(seg: string): string {
    return seg
      .replace(new RegExp(`[0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十百]+`, 'g'), '')
      .replace(/(斤|公斤|千克|块|元|今天|今日|每日|现在|有|备|给|供应|可供|是|改|价格|供货价|价|左右|大概|差不多)/g, '')
      .trim()
  }

  /** 这段像不像「在说一个菜」：含数字或长度 ≥2（避免把「今天」这种纯套话当菜名） */
  private looksLikeItem(seg: string): boolean {
    if (/[0-9零一二两三四五六七八九十百]/.test(seg)) return true
    return seg.length >= 2 && !/(今天|今日|明天|后天|谢谢|你好)/.test(seg)
  }
}
