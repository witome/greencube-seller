import { Injectable, Logger } from '@nestjs/common'
import { IParser, ParseResult, ParsedItem, ProductRow } from './parser.types'
import { normalizeQtyToJin, resolveDeliveryDate } from './parser.util'

/**
 * 大模型解析器（阿里云百炼 · OpenAI 兼容协议）
 *
 * ── 红线（写死在代码里，不靠自觉）──
 * 1. 模型只做一件事：把客户这句话里的菜**对应到清单里哪个商品、多少数量**。
 *    名称 / 规格 / 单价 / 金额**一律由后端从 product 表回填** —— 模型输出里的任何价格字段都被丢掉。
 *    模型编一个价就是钱的事，所以它在结构上根本碰不到价格。
 * 2. 只能从给定清单里挑商品（按 productId）；挑不到、或者编了一个清单外的 id → 直接丢弃，不硬猜。
 * 3. 解析不出任何商品 → 抛错，由 AiService 降级到规则版（绝不返回「空草稿」给客户）。
 *
 * ── 配置（全在 backend/.env，没配 Key 时一律走规则版）──
 * DASHSCOPE_API_KEY   必填，没有它 enabled=false
 * AI_PARSE_BASE_URL   默认 https://dashscope.aliyuncs.com/compatible-mode/v1（华北2 北京）
 * AI_PARSE_MODEL      默认 qwen-flash（以百炼控制台「模型列表」为准）
 * AI_PARSE_TIMEOUT_MS 默认 8000，超时即降级
 * AI_PARSE_JSON_MODE  默认 1（要求模型只回 JSON）；如该模型不支持 response_format 就设 0
 */
@Injectable()
export class LlmParser implements IParser {
  readonly name = 'llm' as const

  private readonly logger = new Logger('AiLlmParser')

  /** 有 Key 才可用。没 Key 时不报错、不告警，静默走规则版（这才是「不配也能跑」） */
  get enabled(): boolean {
    return !!process.env.DASHSCOPE_API_KEY
  }

  async parse(text: string, products: ProductRow[]): Promise<ParseResult> {
    const raw = (text || '').trim()

    // 可能抛错（网络/超时/返回垃圾）—— 全部交给 AiService 兜底降级，这里不做 try/catch
    const modelOutput = await this.callModel(raw, products)
    const draft = this.extractJson(modelOutput)

    const byId = new Map<string, ProductRow>()
    for (const p of products) byId.set(String(p.id), p)

    const items: ParsedItem[] = []
    const seen = new Set<string>()
    const draftItems = Array.isArray(draft?.items) ? draft.items : []
    for (const it of draftItems) {
      const p = byId.get(String(it?.productId))
      if (!p) continue // 模型编的 id / 清单外的商品 → 丢弃
      if (seen.has(String(p.id))) continue // 同一商品重复 → 只留第一条
      seen.add(String(p.id))

      const price = Number(p.salePrice)
      const qtyNum = Number(it?.qty)
      const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1
      // 单位照客户原话收，换算成斤交给我们自己的唯一口径（不让模型算斤，避免两处口径）
      const unit = typeof it?.unit === 'string' && it.unit.trim() ? it.unit.trim() : (p.unit || '斤')
      const qtyJin = normalizeQtyToJin(qty, unit, p.weighType, p.specText)
      const qtyText =
        typeof it?.qtyText === 'string' && it.qtyText.trim() ? it.qtyText.trim() : `${qty}${unit}`

      items.push({
        productId: Number(p.id),
        name: p.name,
        unit: p.unit || '斤',
        specText: p.specText,
        weighType: p.weighType,
        qty: qtyJin,
        qtyText,
        price,
        amount: Math.round(qtyJin * price * 100) / 100,
      })
    }

    // 一个都没匹配上 → 抛错降级（规则版说不定能匹配上，绝不给客户一张空草稿）
    if (!items.length) throw new Error('大模型未匹配到任何在售商品')

    // 日期：模型可能没填，或填了「明天」以外的说法 → 统一用共享口径再判一次原话（两处都错了才算错）
    const modelDate = typeof draft?.deliveryDate === 'string' ? draft.deliveryDate.trim() : ''
    const deliveryDate = resolveDeliveryDate(modelDate || raw)

    const remark = typeof draft?.remark === 'string' ? draft.remark.trim() : ''
    const unmatched = (Array.isArray(draft?.unmatched) ? draft.unmatched : [])
      .filter((x: any) => typeof x === 'string' && x.trim())
      .map((s: string) => s.trim())

    const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100

    return {
      items,
      remark,
      deliveryDateLabel: deliveryDate.label,
      deliveryDate: deliveryDate.iso,
      total,
      matchedCount: items.length,
      hasUnmatched: unmatched.length > 0,
      rawText: raw,
      parser: 'llm',
      unmatched,
    }
  }

  // ── 调模型 ──
  private async callModel(text: string, products: ProductRow[]): Promise<string> {
    const key = process.env.DASHSCOPE_API_KEY
    if (!key) throw new Error('未配置 DASHSCOPE_API_KEY')

    const baseUrl = (process.env.AI_PARSE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')
    const model = process.env.AI_PARSE_MODEL || 'qwen-flash'
    const timeoutMs = Number(process.env.AI_PARSE_TIMEOUT_MS || 8000)
    const useJsonMode = (process.env.AI_PARSE_JSON_MODE || '1') !== '0'

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8000)

    try {
      const body: any = {
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: this.systemPrompt(products) },
          { role: 'user', content: text },
        ],
      }
      if (useJsonMode) body.response_format = { type: 'json_object' }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`模型接口返回 ${res.status}：${detail.slice(0, 200)}`)
      }

      const json: any = await res.json()
      const content = json?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) throw new Error('模型返回内容为空')
      return content
    } finally {
      clearTimeout(timer)
    }
  }

  // ── 提示词：商品清单是固定前缀（同一批商品反复调用能吃到上下文缓存价）──
  private systemPrompt(products: ProductRow[]): string {
    const list = products
      .map((p) => `${Number(p.id)} | ${p.name} | ${p.unit || '斤'} | ${p.specText || '无'} | ${Number(p.salePrice)}元`)
      .join('\n')

    return `你是生鲜采购下单助手。客户用一句口语说明要买什么，你要把这句话里的菜对应到下面给定的「在售商品清单」上。

硬规则（必须遵守）：
1. 只能从清单里挑商品，用清单给出的 id 填 productId。禁止编造清单里没有的商品。
2. 禁止输出任何价格、金额、合计 —— 价格由系统自己算，你只管「买哪个、买多少」。
3. 数量照客户原话填：客户说「两颗」就填 qty=2、unit="颗"；说「50斤」就填 qty=50、unit="斤"。称重商品不要自己去换算成斤，系统会算。
4. 同一个商品只出现一次。
5. 没能对应上清单的菜名，原话放进 unmatched 数组（不要猜成别的商品）。
6. 只输出 JSON，不要解释、不要 markdown 代码块。格式固定为：
{"items":[{"productId":1,"qty":50,"unit":"斤","qtyText":"50斤"}],"deliveryDate":"","remark":"","unmatched":[]}
7. deliveryDate 只能填「今天」「明天」「后天」三者之一；客户没提时间就填空字符串。remark 放客户的其他要求（如「要嫩一点的」），没有就填空字符串。

在售商品清单（格式：id | 名称 | 单位 | 规格 | 单价）：
${list}`
  }

  // ── 容错取 JSON：模型偶尔会裹上 ```json 或加一句废话 ──
  private extractJson(s: string): any {
    let t = (s || '').trim()
    t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    const i = t.indexOf('{')
    const j = t.lastIndexOf('}')
    if (i >= 0 && j > i) t = t.slice(i, j + 1)
    const parsed = JSON.parse(t)
    if (!parsed || typeof parsed !== 'object') throw new Error('模型返回的不是 JSON 对象')
    return parsed
  }
}
