/**
 * AI 下单解析器 · 共享类型（前后端契约）
 *
 * ⚠️ ParseResult 的字段**只增不改**：
 * 前端 `kefu.vue` / `ai-confirm.vue` 直接消费这个结构，删字段或改名会静默把确认页打空。
 * 2026-09-23 新增 `parser` / `unmatched` 两个字段（纯新增，老前端忽略即可）。
 */

export interface ParsedItem {
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
  /** 本次由哪个解析器产出（2026-09-23 新增，诊断用；LLM 失败会自动降级成 rule） */
  parser?: 'rule' | 'llm'
  /** 没能对应上在售商品的菜名（原话），给前端提示用（2026-09-23 新增） */
  unmatched?: string[]
}

/** 解析器输入：在售商品行（直接来自 prisma.product.findMany） */
export interface ProductRow {
  id: any
  name: string
  unit: string | null
  specText: string | null
  weighType: number
  salePrice: any
}

/** 解析器契约：规则版与 LLM 版都实现它，AiService 只认这个接口 */
export interface IParser {
  readonly name: 'rule' | 'llm'
  parse(text: string, products: ProductRow[]): Promise<ParseResult>
}
