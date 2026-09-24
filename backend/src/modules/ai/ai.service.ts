import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { LlmParser } from './parser/llm.parser'
import { RuleParser } from './parser/rule.parser'
import { ParseResult, DraftContext } from './parser/parser.types'
import { applyOps, draftFingerprint, itemsToAddOps, normalizeDraftLines, ApplyResult } from './parser/draft'
import { resolveTurnDeliveryDate } from './parser/parser.util'

// 向后兼容：原来从本文件导出的 ParseResult 仍可从这里 import
export type { ParseResult, ParsedItem } from './parser/parser.types'

/**
 * AI 客服下单引擎（调度器）
 *
 * 2026-09-23 重构：原来的规则解析逻辑整体搬到 `parser/rule.parser.ts`（逻辑一行没改），
 * 本类只负责「选哪个解析器 + 出错怎么办」。
 * 2026-09-24 多轮上下文：整个对话就是**一张草稿**——
 *   · 请求带 `draft` → 走多轮口径：模型给 ops，服务端把 ops 作用到草稿上（合并只有一处实现：parser/draft.ts）
 *   · 请求不带 `draft` → 走老口径，行为与 2026-09-23 版**完全一致**（老前端不受影响）
 *
 * 解析器选择（AI_PARSE_MODE）：
 *   auto（默认） 配了 DASHSCOPE_API_KEY 就用大模型，否则用规则版
 *   llm          只试大模型（失败**仍**降级规则版）
 *   rule         强制规则版（省钱 / 大模型出问题时运维侧的兜底开关）
 *
 * 🔒 硬约束：**大模型永远不是单点**。超时、报错、返回垃圾、一个商品都没匹配上 ——
 * 全部自动降级到规则版；多轮口径下再统一**按 add 合并**（同 productId 相加、新商品追加），
 * 绝不丢已经加进草稿的商品。用户体感是「今天AI有点笨」，绝不会是「下不了单」。
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(
    private prisma: PrismaService,
    private readonly ruleParser: RuleParser,
    private readonly llmParser: LlmParser,
  ) {}

  /**
   * @param text      客户这一句话
   * @param draft     当前草稿（**不传 = 老前端行为完全不变**）
   */
  async parse(text: string, draft?: DraftContext): Promise<ParseResult> {
    const raw = (text || '').trim()

    const products = await this.prisma.product.findMany({
      where: { status: 1 },
      orderBy: { id: 'asc' },
    })

    const mode = (process.env.AI_PARSE_MODE || 'auto').trim().toLowerCase()
    const tryLlm = mode !== 'rule' && this.llmParser.enabled

    // ── ① 老口径：请求没带 draft（老前端 / 一次性说完整清单）→ 一个字都没改 ──
    if (draft === undefined) {
      if (tryLlm) {
        try {
          return await this.llmParser.parse(raw, products)
        } catch (e: any) {
          // 只记一行告警、不打断请求：客户照常用规则版下单
          this.logger.warn(`大模型解析失败，已自动降级规则版：${e?.message || e}`)
        }
      }
      return this.ruleParser.parse(raw, products)
    }

    // ── ② 多轮口径：这句话作用在当前草稿上 ──
    const draftLines = normalizeDraftLines(draft.items, products)
    const keepDate = draft.deliveryDate
    const keepRemark = draft.remark || ''

    if (tryLlm) {
      try {
        const turn = await this.llmParser.parseTurn(raw, products, { items: draftLines, deliveryDate: keepDate, remark: keepRemark })

        const date = resolveTurnDeliveryDate(raw, turn.deliveryDate, keepDate)
        const remark = turn.remark && turn.remark.trim() ? turn.remark.trim() : keepRemark

        // 需要反问 → 草稿**一定不动**（口径 2：不确定就反问，不许猜）
        if (turn.needClarify) {
          const held = applyOps(draftLines, [], products)
          return this.compose(raw, held, date, remark, 'llm', turn.unmatched || [], false, turn.needClarify)
        }

        // 模型这一句没给出任何可执行操作（= 一个都没匹配上）→ 再用规则版兜一刀，按 add 合并。
        // 注意：这只是**补充**，不是推翻 —— 模型已经给出的日期/备注照用，草稿里已有的商品一个不动。
        if (!turn.ops.length) {
          const retry = await this.ruleParser.parse(raw, products)
          if (retry.items.length) {
            const applied = applyOps(draftLines, itemsToAddOps(retry.items), products)
            const remark2 = remark || retry.remark || keepRemark
            return this.compose(raw, applied, date, remark2, 'rule', retry.unmatched || [], retry.hasUnmatched)
          }
          const held = applyOps(draftLines, [], products)
          return this.compose(raw, held, date, remark, 'llm', turn.unmatched || [], false)
        }

        const applied = applyOps(draftLines, turn.ops, products)
        return this.compose(raw, applied, date, remark, 'llm', turn.unmatched || [], false)
      } catch (e: any) {
        this.logger.warn(`大模型多轮解析失败，已自动降级规则版（按 add 合并）：${e?.message || e}`)
      }
    }

    // ── ③ 降级：规则版 + 全部当 add 合并（已加的商品一个不丢）──
    const fallback = await this.ruleParser.parse(raw, products)
    const applied = applyOps(draftLines, itemsToAddOps(fallback.items), products)
    // 日期/备注：新句子没提就沿用草稿原值（不能被规则版的「默认明天」覆盖）
    const date = resolveTurnDeliveryDate(raw, undefined, keepDate)
    const remark = fallback.remark && fallback.remark.trim() ? fallback.remark.trim() : keepRemark
    return this.compose(raw, applied, date, remark, 'rule', fallback.unmatched || [], fallback.hasUnmatched)
  }

  /** 组装响应：原字段语义一律不变，多轮相关字段是**纯新增** */
  private compose(
    raw: string,
    applied: ApplyResult,
    date: { label: string; iso: string },
    remark: string,
    parser: 'rule' | 'llm',
    unmatched: string[],
    extraUnmatched: boolean,
    needClarify?: string,
  ): ParseResult {
    const items = applied.items
    const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100
    const result: ParseResult = {
      items,
      remark,
      deliveryDateLabel: date.label,
      deliveryDate: date.iso,
      total,
      matchedCount: items.length,
      hasUnmatched: unmatched.length > 0 || extraUnmatched,
      rawText: raw,
      parser,
      unmatched,
      changes: applied.changes,
      draftVersion: draftFingerprint(items),
    }
    if (needClarify) result.needClarify = needClarify
    return result
  }
}
