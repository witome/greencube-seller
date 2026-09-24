/**
 * AI 下单解析器 · 共享类型（前后端契约）
 *
 * ⚠️ ParseResult 的字段**只增不改**：
 * 前端 `kefu.vue` / `ai-confirm.vue` 直接消费这个结构，删字段或改名会静默把确认页打空。
 * 2026-09-23 新增 `parser` / `unmatched`；2026-09-24 新增 `changes` / `needClarify` / `draftVersion`
 * —— 全部是**可选字段**，老前端忽略即可（未传 draft 时服务端也不返回它们，老前端看到的字节完全一致）。
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
  /** 本次每条变化（2026-09-24 新增，仅当请求带了 draft 时返回）——气泡显示「五花肉 5斤 → 10斤」 */
  changes?: DraftChange[]
  /** 需要反问时的问题文本（2026-09-24 新增）；带这个字段时草稿**一定没动** */
  needClarify?: string
  /** 合并后草稿的内容指纹（2026-09-24 新增，诊断/比对用：同一份草稿指纹相同） */
  draftVersion?: string
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

// ────────────────────────────────────────────────────────────
// 多轮上下文（2026-09-24）：整个对话就是**一张草稿**
// ────────────────────────────────────────────────────────────

/** 当前草稿行（前端回传）；**不传 draft = 空草稿 = 老前端行为完全不变** */
export interface DraftLine {
  productId: number
  qty: number
  unit?: string
  name?: string
}

/** 请求侧的草稿上下文（AiService/LLM 内部使用） */
export interface DraftContext {
  items: DraftLine[]
  deliveryDate?: string
  remark?: string
}

/**
 * 大模型对**这一句话**的操作（而不是新清单）。
 * ⚠️ 模型碰不到价格：ops 里只有「买哪个、多少、什么操作」，价格由服务端从 product 表回填。
 */
export interface AiOp {
  op: 'add' | 'set' | 'remove' | 'clear'
  productId?: number | string
  qty?: number | string
  unit?: string
  qtyText?: string
}

/** 一条变化记录（供前端气泡显示） */
export interface DraftChange {
  type: 'add' | 'set' | 'remove' | 'clear'
  productId: number
  name: string
  unit: string
  fromQty: number
  toQty: number
  delta: number
  /** 服务端生成的中文说明（唯一口径，前端直接显示，不要在前端再拼一遍） */
  text: string
  /** 护栏触发说明（数量截断 / 超 20 项被忽略） */
  note?: string
}

/** 一句话的解析结论（LLM 版多轮契约） */
export interface LlmTurnResult {
  ops: AiOp[]
  deliveryDate?: string
  remark?: string
  unmatched?: string[]
  needClarify?: string
}
