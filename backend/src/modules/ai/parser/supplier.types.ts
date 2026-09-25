/**
 * 供应商「语音报量 / 改价」· 共享类型（卡U，2026-09-25）
 *
 * ⚠️ 与采购方 ParseResult 完全独立（不同业务、不同页面消费）；
 *    采购方 parser.types.ts 一个字段都不动。
 */

/** 供应商名下、在被授权分类里的在售商品行（解析器的可见范围 —— 超出范围的一律不认） */
export interface SupplierProductRow {
  productId: number
  name: string
  unit: string
  weighType: number
  /** 该供应商自己的供货价（不是销售价；供应商不见销售价） */
  supplyPrice: number
  dailySupply: number
}

/** 一句话解析出的操作（模型/规则版只产出「操作」，价格数值必须能在原文里找到依据） */
export interface SupplierVoiceOp {
  op: 'setPrice' | 'setSupply'
  /** 能匹配上才有；匹配不上由服务端转成 unmatched（绝不瞎猜） */
  productId?: number
  value: number
  /** 原话片段（如「三块八」「两百斤」），留痕/展示用 */
  valueText?: string
  /** 匹配不上的菜名原话（服务端拿它找候选；模型/规则版填了它就不填 productId） */
  name?: string
}

/** 数字安全阀结论（卡U ②：原文数字串 vs 模型给出的数字，不一致就不许提交） */
export interface SupplierNumberCheck {
  value: number
  /** true = 与原文数字串一致（确认页仍会显示出来让用户看一眼） */
  consistent: boolean
  /** 不一致时的三选一选项（含从原文里捞出来的最近候选） */
  options?: number[]
}

/** 合并后草稿的一行：商品 + 当前库里值 + 本次要改的值 + 每个值的数字安全阀结论 */
export interface SupplierDraftItem {
  productId: number
  name: string
  unit: string
  /** 当前库里的供货价（审核制变更的起点） */
  supplyPrice: number
  /** 当前库里的日可供量（免审即时生效的起点） */
  dailySupply: number
  setPrice?: number
  setSupply?: number
  priceCheck?: SupplierNumberCheck
  supplyCheck?: SupplierNumberCheck
}

/** 没匹配上商品的「菜名 + 说到的值」——前端列候选让用户挑，挑中后值直接套上（绝不编商品） */
export interface SupplierUnmatchedItem {
  name: string
  op: 'setPrice' | 'setSupply'
  value: number
  valueText?: string
  numberCheck: SupplierNumberCheck
}

/** POST /ai/supplier-parse 的响应 */
export interface SupplierParseResult {
  rawText: string
  parser: 'rule' | 'llm'
  /** 合并后的完整草稿（一个对话 = 一张草稿） */
  draft: SupplierDraftItem[]
  /** 没匹配上名下商品的菜名 */
  unmatched: string[]
  /** unmatched 对应的「说到的值 + 安全阀」（用户挑完候选后套用） */
  unmatchedDetails: SupplierUnmatchedItem[]
  /** unmatched 的最近候选（该供应商名下、授权分类内的在售商品，最多 5 个） */
  candidates: { productId: number; name: string; unit: string; supplyPrice: number; dailySupply: number }[]
  hasUnmatched: boolean
  needClarify?: string
}

/** 解析器（规则版/LLM 版）对一句话的产出 */
export interface SupplierTurnResult {
  ops: SupplierVoiceOp[]
  unmatched: string[]
  needClarify?: string
}
