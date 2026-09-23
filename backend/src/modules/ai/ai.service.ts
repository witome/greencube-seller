import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { LlmParser } from './parser/llm.parser'
import { RuleParser } from './parser/rule.parser'
import { ParseResult } from './parser/parser.types'

// 向后兼容：原来从本文件导出的 ParseResult 仍可从这里 import
export type { ParseResult, ParsedItem } from './parser/parser.types'

/**
 * AI 客服下单引擎（调度器）
 *
 * 2026-09-23 重构：原来的规则解析逻辑整体搬到 `parser/rule.parser.ts`（逻辑一行没改），
 * 本类只负责「选哪个解析器 + 出错怎么办」。
 *
 * 解析器选择（AI_PARSE_MODE）：
 *   auto（默认） 配了 DASHSCOPE_API_KEY 就用大模型，否则用规则版
 *   llm          只试大模型（失败**仍**降级规则版）
 *   rule         强制规则版（省钱 / 大模型出问题时运维侧的兜底开关）
 *
 * 🔒 硬约束：**大模型永远不是单点**。超时、报错、返回垃圾、一个商品都没匹配上 ——
 * 全部自动降级到规则版；用户体感是「今天AI有点笨」，绝不会是「下不了单」。
 * 对外的 `POST /ai/parse` 路径、入参、返回结构全不变（只多两个诊断字段，见 parser.types.ts）。
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(
    private prisma: PrismaService,
    private readonly ruleParser: RuleParser,
    private readonly llmParser: LlmParser,
  ) {}

  async parse(text: string): Promise<ParseResult> {
    const raw = (text || '').trim()

    const products = await this.prisma.product.findMany({
      where: { status: 1 },
      orderBy: { id: 'asc' },
    })

    const mode = (process.env.AI_PARSE_MODE || 'auto').trim().toLowerCase()
    const tryLlm = mode !== 'rule' && this.llmParser.enabled

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
}
