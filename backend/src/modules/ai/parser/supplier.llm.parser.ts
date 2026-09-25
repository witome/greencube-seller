import { Injectable, Logger } from '@nestjs/common'
import { SupplierProductRow, SupplierTurnResult, SupplierVoiceOp } from './supplier.types'

/**
 * 供应商「语音报量 / 改价」· 大模型解析器（卡U ③，2026-09-25）
 *
 * 🔒 红线（结构上锁死，不靠模型自觉）：
 * 1. 只能对「该供应商名下、且在被授权分类里」的在售商品操作（清单由服务端给定）；
 *    清单外的 productId 服务端一律丢弃，绝不瞎猜（调用侧还会再验一遍）。
 * 2. 模型只产出操作（setPrice/setSupply + 数值）；数值是否站得住由**数字安全阀**
 *    （supplier-voice.util.ts，对识别原文）另行校验，不一致就不许提交。
 * 3. 清单里没有的菜名 → unmatched（服务端拿它找候选给用户挑），绝不编商品。
 *
 * 配置与采购方 LlmParser 同源（DASHSCOPE_API_KEY / AI_PARSE_MODE / AI_PARSE_TIMEOUT_MS）；
 * AI_PARSE_MODE=rule 时本解析器根本不会被调用（调度在 SupplierAiService）。
 */
@Injectable()
export class SupplierLlmParser {
  private readonly logger = new Logger('AiSupplierLlmParser')

  get enabled(): boolean {
    return !!process.env.DASHSCOPE_API_KEY
  }

  async parse(text: string, products: SupplierProductRow[]): Promise<SupplierTurnResult> {
    const raw = (text || '').trim()
    const modelOutput = await this.callModel(this.systemPrompt(products), raw)
    const obj = this.extractJson(modelOutput)

    const clarify = typeof obj?.needClarify === 'string' ? obj.needClarify.trim() : ''
    if (!Array.isArray(obj?.ops) && !clarify) throw new Error('模型未按 ops 格式回答')

    // ⚠️ 白名单字段：op / productId / value / valueText / name，其余（价格解释、理由…）一律丢弃
    const ops: SupplierVoiceOp[] = (Array.isArray(obj?.ops) ? obj.ops : [])
      .filter((o: any) => o && typeof o === 'object' && (o.op === 'setPrice' || o.op === 'setSupply'))
      .map((o: any) => ({
        op: o.op as 'setPrice' | 'setSupply',
        productId: o.productId !== undefined ? Number(o.productId) : undefined,
        value: Number(o.value),
        valueText: typeof o.valueText === 'string' ? o.valueText : undefined,
        name: typeof o.name === 'string' ? o.name : undefined,
      }))
      .filter((o: any) => Number.isFinite(o.value) && o.value > 0)

    const unmatched = (Array.isArray(obj?.unmatched) ? obj.unmatched : [])
      .filter((x: any) => typeof x === 'string' && x.trim())
      .map((s: string) => s.trim())

    return { ops, unmatched, needClarify: clarify || undefined }
  }

  // ── 调模型（与采购方 LlmParser 同一套环境变量与超时口径；单独实现是为了不动采购方文件的一个字节）──
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

  private systemPrompt(products: SupplierProductRow[]): string {
    const list = products
      .map((p) => `${p.productId} | ${p.name} | ${p.unit} | 当前供货价${p.supplyPrice}元 | 当前日可供量${p.dailySupply}${p.unit}`)
      .join('\n')
    return `你是生鲜供应商的报量/改价助手。供应商（多为年纪偏大的菜农）用一句口语报「今日可供量」或「供货价」，你要把这句话对应到下面给定的「我的商品清单」上。

硬规则（必须遵守）：
1. 只能对清单里的商品操作，productId 用清单给出的 id。清单里没有的菜名，原话菜名放进 unmatched 数组，禁止猜成别的商品。
2. value 必须照供应商原话里的数字：中文数字要换算成阿拉伯数字，如「三块八」=3.8、「三十八」=38、「两百」=200。
3. 说的是价格（多少钱）→ setPrice；说的是可供量（多少斤）→ setSupply。一句话可以两者都有（如「西红柿三块八，今天有两百斤」→ 两条 ops）。
4. 禁止输出清单之外的解释、理由；只输出 JSON，不要 markdown 代码块。格式固定为：
{"ops":[{"op":"setPrice","productId":1,"value":3.8,"valueText":"三块八"},{"op":"setSupply","productId":1,"value":200,"valueText":"两百斤"}],"unmatched":[],"needClarify":""}
5. 供应商这句话含糊到无法判断是价还是量 → ops 留空，只回 needClarify。

我的商品清单（格式：id | 名称 | 单位 | 当前供货价 | 当前日可供量）：
${list}`
  }

  // ── 容错取 JSON（与采购方同口径）──
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
