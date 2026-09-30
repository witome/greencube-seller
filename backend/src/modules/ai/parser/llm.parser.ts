import { Injectable, Logger } from '@nestjs/common'
import { AiOp, DraftContext, IParser, LlmTurnResult, ParseResult, ParsedItem, ProductRow } from './parser.types'
import { normalizeQtyToJin, resolveDeliveryDate } from './parser.util'

/**
 * 大模型解析器（阿里云百炼 · OpenAI 兼容协议）
 *
 * ── 红线（写死在代码里，不靠自觉）──
 * 1. 模型只做一件事：把客户这句话对应成**操作**（买哪个商品、多少数量、add/set/remove/clear）。
 *    名称 / 规格 / 单价 / 金额**一律由后端从 product 表回填** —— 模型输出里的任何价格字段都被丢掉。
 *    模型编一个价就是钱的事，所以它在结构上根本碰不到价格。
 * 2. 只能从给定清单里挑商品（按 productId）；挑不到、或者编了一个清单外的 id → 直接丢弃，不硬猜。
 * 3. 解析不出任何商品 → 抛错，由 AiService 降级到规则版（绝不返回「空草稿」给客户）。
 *
 * ── 两个入口 ──
 *   parse()     单句口径（老前端不传 draft 时走这里，行为与 2026-09-23 版完全一致）
 *   parseTurn() 多轮口径（请求带了 draft；模型返回 ops，由服务端合并到草稿上）
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

  /** 单句口径：一句话 = 一张完整清单（老前端 / 老用法） */
  async parse(text: string, products: ProductRow[]): Promise<ParseResult> {
    const raw = (text || '').trim()

    // 可能抛错（网络/超时/返回垃圾）—— 全部交给 AiService 兜底降级，这里不做 try/catch
    const modelOutput = await this.callModel(this.systemPrompt(products), raw)
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

  /**
   * 多轮口径：把「这句话要做什么」解析成 ops（不产出新清单，也不碰价格）。
   * 抛错 = 这次没用（网络/超时/垃圾/格式完全不对）→ AiService 降级到规则版按 add 合并。
   */
  async parseTurn(text: string, products: ProductRow[], draft: DraftContext): Promise<LlmTurnResult> {
    const raw = (text || '').trim()
    const modelOutput = await this.callModel(this.systemPromptForOps(products), this.opsUserContent(draft, raw))
    const obj = this.extractJson(modelOutput)

    const hasOps = Array.isArray(obj?.ops)
    const hasItems = Array.isArray(obj?.items)
    const clarify = typeof obj?.needClarify === 'string' ? obj.needClarify.trim() : ''
    // 三个关键字段一个都没有 → 模型没按格式回答，当垃圾处理（让上层降级）
    if (!hasOps && !hasItems && !clarify) throw new Error('模型未按 ops 格式回答')

    // ⚠️ 只取「操作/商品/数量/单位」四个白名单字段：模型塞进来的 price / amount / total 一律进不来
    let ops: AiOp[] = (hasOps ? obj.ops : []).filter((o: any) => o && typeof o === 'object' && typeof o.op === 'string')
    // 兼容网：模型偶尔仍按老格式回 items（一句话一个清单）→ 当成 add 用，绝不丢客户的话
    if (!ops.length && !clarify && hasItems) {
      ops = obj.items
        .filter((it: any) => it && it.productId !== undefined)
        .map((it: any) => ({
          op: 'add' as const,
          productId: it.productId,
          qty: it.qty,
          unit: it.unit,
          qtyText: it.qtyText,
        }))
    }

    const unmatched = (Array.isArray(obj?.unmatched) ? obj.unmatched : [])
      .filter((x: any) => typeof x === 'string' && x.trim())
      .map((s: string) => s.trim())

    return {
      ops,
      deliveryDate: typeof obj?.deliveryDate === 'string' ? obj.deliveryDate.trim() : '',
      remark: typeof obj?.remark === 'string' ? obj.remark.trim() : '',
      unmatched,
      needClarify: clarify || undefined,
    }
  }

  // ── 调模型 ──
  private async callModel(systemPrompt: string, userContent: string): Promise<string> {
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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
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

  /** 商品清单文本（system 提示词里**位置固定**的那一段，别在前面插会变的内容，否则吃不到上下文缓存价） */
  private productList(products: ProductRow[]): string {
    return products
      .map((p) => `${Number(p.id)} | ${p.name} | ${p.unit || '斤'} | ${p.specText || '无'} | ${Number(p.salePrice)}元`)
      .join('\n')
  }

  // ── 提示词（单句口径）：商品清单是固定前缀（同一批商品反复调用能吃到上下文缓存价）──
  private systemPrompt(products: ProductRow[]): string {
    return `你是生鲜采购下单助手。客户用一句口语说明要买什么，你要把这句话里的菜对应到下面给定的「在售商品清单」上。

硬规则（必须遵守）：
1. 只能从清单里挑商品，用清单给出的 id 填 productId。禁止编造清单里没有的商品。
2. 禁止输出任何价格、金额、合计 —— 价格由系统自己算，你只管「买哪个、买多少」。
3. 数量照客户原话填：客户说「两颗」就填 qty=2、unit="颗"；说「50斤」就填 qty=50、unit="斤"。称重商品不要自己去换算成斤，系统会算。
4. 同一个商品只出现一次。
5. 清单里没有的菜名，哪怕与清单里某个菜是近亲、看起来像同一种东西，也绝对不许配。例如：客户要杏鲍菇而清单只有香菇/金针菇 → 必须进 unmatched，不许配成香菇；客户要牛肉而清单只有猪肉 → 必须进 unmatched。判断标准只有一个：客户说的名字与清单商品名称是否对得上，不按「长得像、是一类东西」判断。
6. 没能对应上清单的菜名，必须把客户原话一字不差地放进 unmatched 数组：不要丢弃、不要缩写改写、不要猜成别的商品，更不许强行配一个「长得像」的商品凑数。
7. 只输出 JSON，不要解释、不要 markdown 代码块。格式固定为：
{"items":[{"productId":1,"qty":50,"unit":"斤","qtyText":"50斤"}],"deliveryDate":"","remark":"","unmatched":[]}
8. deliveryDate 只能填「今天」「明天」「后天」三者之一；客户没提时间就填空字符串。remark 放客户的其他要求（如「要嫩一点的」），没有就填空字符串。

在售商品清单（格式：id | 名称 | 单位 | 规格 | 单价）：
${this.productList(products)}`
  }

  // ── 提示词（多轮口径）：商品清单仍是固定前缀；**当前草稿放在 user 消息里**（插在清单前面会让缓存失效）──
  private systemPromptForOps(products: ProductRow[]): string {
    return `你是生鲜采购下单助手。客户在与你的对话里**一句一句**说他要买什么、要改什么。
整段对话只有**一张草稿**；你不需要重新输出整张清单，只需要判断**客户这一句话要做什么操作**，用 ops 表示。
系统会把你的 ops 作用到当前草稿上（当前草稿在用户消息里给你）。

四种操作：
- add    ：把数量**加进去**（默认就是 add）
- set    ：把某个商品的数量**设置成**新值（覆盖）
- remove ：把某个商品从草稿里**去掉**
- clear  ：整张草稿**全部清空**

硬规则（必须遵守）：
1. 只能从清单里挑商品，用清单给出的 id 填 productId。禁止编造清单里没有的商品。
2. 禁止输出任何价格、金额、合计 —— 价格由系统自己算，你只管「买哪个、买多少、做什么操作」。
3. 数量照客户原话填：客户说「两颗」就填 qty=2、unit="颗"；说「50斤」就填 qty=50、unit="斤"。称重商品不要自己换算成斤，系统会算。
4. 操作判断（重要）：
   - 客户再报一次同样的商品 → 默认是 **add（相加）**。例如草稿里已有「猪肉 5斤」，客户说「再加5斤猪肉」→ 输出 add 5斤（系统会累加成 10 斤），**不要**输出整张清单。
   - 只有出现「改成 / 换成 / 只要 / 改为 / 就」这类词才用 **set**。例如「土豆改成20斤」→ set 20斤。
   - 「不要了 / 去掉 / 删掉」→ remove；「都不要了 / 全不要了」→ clear（ops 里只放一条 {"op":"clear"}）。
5. 客户用「那个 / 它」指代、而草稿里不止一个候选、你无法确定指的是哪一个 → **绝对不要猜**：
   ops 留空，只回 needClarify 反问。例如 {"ops":[],"needClarify":"你说的是五花肉还是土豆？"}
   能确定指的是哪一个时，照常输出对应的 op。
6. 客户这句话只提了配送时间或其他要求（没提商品）→ ops 留空，只填 deliveryDate / remark。例如「明天早上送」→ {"ops":[],"deliveryDate":"明天"}。
7. 只输出 JSON，不要解释、不要 markdown 代码块。格式固定为：
{"ops":[{"op":"add","productId":1,"qty":50,"unit":"斤","qtyText":"50斤"}],"deliveryDate":"","remark":"","unmatched":[],"needClarify":""}
8. deliveryDate 只能填「今天」「明天」「后天」三者之一；客户这句话没提时间就填空字符串（系统会沿用草稿里的日期）。remark 放客户的其他要求，没有就填空字符串。
9. 清单里没有的菜名，哪怕与清单里某个菜是近亲、看起来像同一种东西，也绝对不许配。例如：客户要杏鲍菇而清单只有香菇/金针菇 → 必须进 unmatched，不许配成香菇；客户要牛肉而清单只有猪肉 → 必须进 unmatched。判断标准只有一个：客户说的名字与清单商品名称是否对得上，不按「长得像、是一类东西」判断。
10. 客户这句话里没能对应上清单的菜名，必须把客户原话一字不差地放进 unmatched 数组：不要丢弃、不要缩写改写、不要猜成别的商品，更不许强行配一个「长得像」的商品凑数。

在售商品清单（格式：id | 名称 | 单位 | 规格 | 单价）：
${this.productList(products)}`
  }

  /** 多轮口径的 user 消息：先给当前草稿，再给客户这句话（模型只对这句话做操作） */
  private opsUserContent(draft: DraftContext, raw: string): string {
    const lines = (draft.items || []).map((it) => ({
      productId: it.productId,
      qty: it.qty,
      unit: it.unit || '斤',
      name: it.name || '',
    }))
    const current = {
      items: lines,
      deliveryDate: draft.deliveryDate || '',
      remark: draft.remark || '',
    }
    return `当前草稿（JSON；items 是已经在这张单上的商品，qty 已统一为斤）：
${JSON.stringify(current)}

客户这次说的话（只对这句话判断要做什么操作）：
${raw}`
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
