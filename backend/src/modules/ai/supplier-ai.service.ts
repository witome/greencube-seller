import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { SupplierLlmParser } from './parser/supplier.llm.parser'
import { SupplierRuleParser } from './parser/supplier.rule.parser'
import { checkNumber, extractNumberCandidates } from './parser/supplier-voice.util'
import {
  SupplierDraftItem,
  SupplierParseResult,
  SupplierProductRow,
  SupplierTurnResult,
  SupplierUnmatchedItem,
  SupplierVoiceOp,
} from './parser/supplier.types'
import { SupplierAuditTrailDto, SupplierParseDto } from './dto/supplier-parse.dto'

/**
 * 供应商「语音报量 / 改价」调度器（卡U ③，2026-09-25）
 *
 * 与采购方 AiService 同一套骨架（AI_PARSE_MODE 调度 + 大模型失败自动降级规则版），
 * 但**完全独立的一条链路**：/ai/parse 的行为与响应一个字节都没动（已上生产）。
 *
 * 🔒 归属红线：商品只能匹配「该供应商名下（product_supplier_link）× 被授权分类
 *    （supplier_category）× 在售（status=1）」三者之交 —— 与 supplier-goods 模块的
 *    归属校验同一口径。模型给的 productId 超出这个交集 → 丢弃/转 unmatched。
 *
 * 🔒 数字红线：所有数值过安全阀（原文数字串 vs 结果数值），不一致 → 前端必须三选一，
 *    没认过不许提交。
 *
 * 🔒 落库红线：本服务**只解析不落库**。改可供量走 PUT /supplier-goods/:id/stock（免审）、
 *    改价走 POST /supplier-goods/:id/change（审核制）—— 通道与手填完全一致。
 */
@Injectable()
export class SupplierAiService {
  private readonly logger = new Logger('AiSupplierService')

  constructor(
    private prisma: PrismaService,
    private readonly ruleParser: SupplierRuleParser,
    private readonly llmParser: SupplierLlmParser,
    private readonly audit: AuditService,
  ) {}

  async parse(userId: bigint, dto: SupplierParseDto): Promise<SupplierParseResult> {
    const raw = (dto.text || '').trim()
    const { rows, byId } = await this.loadMyProducts(userId)

    const mode = (process.env.AI_PARSE_MODE || 'auto').trim().toLowerCase()
    const tryLlm = mode !== 'rule' && this.llmParser.enabled

    // ── ① 大模型优先（失败/垃圾/一个都没匹配上 → 自动降级规则版）──
    let turn: SupplierTurnResult | null = null
    let parserName: 'rule' | 'llm' = 'rule'
    if (tryLlm) {
      try {
        const t = await this.llmParser.parse(raw, rows)
        // 模型产物先过一遍归属校验：productId 不在名下 → 若带菜名转 unmatched，否则丢弃
        const ops = this.validateOps(t.ops, byId)
        const merged: SupplierTurnResult = { ...t, ops }
        if (merged.ops.length || merged.needClarify || merged.unmatched.length) {
          turn = merged
          parserName = 'llm'
        }
      } catch (e: any) {
        this.logger.warn(`供应商语音大模型解析失败，已自动降级规则版：${e?.message || e}`)
      }
    }

    // ── ② 降级：规则版（没 Key / 超时 / 大模型一个都没匹配上）──
    if (!turn) {
      const t = await this.ruleParser.parse(raw, rows)
      turn = { ...t, ops: this.validateOps(t.ops, byId) }
      parserName = 'rule'
    }

    // ── ③ 组装响应（含草稿合并 + 安全阀 + unmatched 候选）──
    return this.compose(raw, dto, turn, parserName, byId, rows)
  }

  /** 商品可见范围：名下 × 授权分类 × 在售（与 supplier-goods 归属校验同口径） */
  private async loadMyProducts(userId: bigint): Promise<{
    rows: SupplierProductRow[]
    byId: Map<number, SupplierProductRow>
  }> {
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } })
    if (!supplier) throw new BizException(ErrorCode.FORBIDDEN, '当前账号不是供应商')

    const [links, authCats] = await Promise.all([
      this.prisma.productSupplierLink.findMany({
        where: { supplierId: supplier.id },
        include: { product: true },
      }),
      this.prisma.supplierCategory.findMany({ where: { supplierId: supplier.id } }),
    ])
    const authorized = new Set(authCats.map((c) => String(c.categoryId)))

    const rows: SupplierProductRow[] = []
    for (const link of links) {
      const p = link.product
      // 在售 + 被授权分类，缺一不可（待审核/已下架/未授权分类的商品不进解析范围）
      if (p.status !== 1) continue
      if (!authorized.has(String(p.categoryId))) continue
      rows.push({
        productId: Number(p.id),
        name: p.name,
        unit: p.unit || '斤',
        weighType: p.weighType,
        supplyPrice: Number(link.supplyPrice),
        dailySupply: Number(link.dailySupply),
      })
    }
    const byId = new Map<number, SupplierProductRow>()
    for (const r of rows) byId.set(r.productId, r)
    return { rows, byId }
  }

  /** 模型/规则版产物过归属校验：productId 不在名下 → 带菜名的转 unmatched，裸的丢弃 */
  private validateOps(ops: SupplierVoiceOp[], byId: Map<number, SupplierProductRow>): SupplierVoiceOp[] {
    const out: SupplierVoiceOp[] = []
    for (const op of ops || []) {
      if (!op || (op.op !== 'setPrice' && op.op !== 'setSupply')) continue
      if (!Number.isFinite(op.value) || op.value <= 0) continue
      if (op.productId !== undefined && byId.has(Number(op.productId))) {
        out.push({ ...op, productId: Number(op.productId), name: undefined })
      } else if (op.name && op.name.trim()) {
        // 名下没有这个商品：保留「菜名 + 说到的值」给用户挑候选（绝不自己编 productId）
        out.push({ op: op.op, value: op.value, valueText: op.valueText, name: op.name.trim() })
      }
      // 没有 productId 也没有菜名 → 无法归属，丢弃
    }
    return out
  }

  private async compose(
    raw: string,
    dto: SupplierParseDto,
    turn: SupplierTurnResult,
    parserName: 'rule' | 'llm',
    byId: Map<number, SupplierProductRow>,
    rows: SupplierProductRow[],
  ): Promise<SupplierParseResult> {
    const numberCandidates = extractNumberCandidates(raw)

    // ── 草稿合并：一个对话 = 一张「待提交变更」草稿（合并只有这一处实现）──
    // 记录「本轮新引入」的值：安全阀只对**本轮识别原文**里说出的数做比对；
    // 上一轮带过来的值在它自己那一轮已经认过，不拿本轮原文重判（否则每轮都要重认一遍）。
    const touchedThisTurn = new Set<string>()
    const draftMap = new Map<number, { setPrice?: number; setSupply?: number }>()
    for (const line of dto.draft || []) {
      const id = Number(line.productId)
      if (!byId.has(id)) continue // 商品已不在名下/不在售 → 不带进草稿
      const cur = draftMap.get(id) || {}
      if (Number.isFinite(line.setPrice) && (line.setPrice as number) > 0) cur.setPrice = Number(line.setPrice)
      if (Number.isFinite(line.setSupply) && (line.setSupply as number) >= 0) cur.setSupply = Number(line.setSupply)
      draftMap.set(id, cur)
    }
    for (const op of turn.ops) {
      if (op.productId === undefined) continue // unmatched 的由用户挑完候选再进草稿
      const cur = draftMap.get(op.productId) || {}
      if (op.op === 'setPrice') {
        cur.setPrice = op.value
        touchedThisTurn.add(op.productId + ':price')
      } else {
        cur.setSupply = op.value
        touchedThisTurn.add(op.productId + ':supply')
      }
      draftMap.set(op.productId, cur)
    }

    const draft: SupplierDraftItem[] = []
    for (const [productId, pending] of draftMap) {
      const p = byId.get(productId)
      if (!p) continue
      const item: SupplierDraftItem = {
        productId,
        name: p.name,
        unit: p.unit,
        supplyPrice: p.supplyPrice,
        dailySupply: p.dailySupply,
      }
      if (pending.setPrice !== undefined) {
        item.setPrice = pending.setPrice
        // 本轮说出的 → 与本轮识别原文比对；上一轮带过来的 → 那一轮已认过，直接放行（确认页仍会展示）
        item.priceCheck = touchedThisTurn.has(productId + ':price')
          ? checkNumber(pending.setPrice, numberCandidates)
          : { value: pending.setPrice, consistent: true }
      }
      if (pending.setSupply !== undefined) {
        item.setSupply = pending.setSupply
        item.supplyCheck = touchedThisTurn.has(productId + ':supply')
          ? checkNumber(pending.setSupply, numberCandidates)
          : { value: pending.setSupply, consistent: true }
      }
      draft.push(item)
    }

    // ── unmatched：「菜名 + 说到的值」+ 候选（名下最接近的几个，绝不编商品）──
    const unmatched: string[] = []
    const unmatchedDetails: SupplierUnmatchedItem[] = []
    for (const op of turn.ops) {
      if (op.productId !== undefined || !op.name) continue
      if (!unmatched.includes(op.name)) unmatched.push(op.name)
      unmatchedDetails.push({
        name: op.name,
        op: op.op,
        value: op.value,
        valueText: op.valueText,
        numberCheck: checkNumber(op.value, numberCandidates),
      })
    }
    for (const name of turn.unmatched || []) {
      if (!unmatched.includes(name)) unmatched.push(name)
    }

    const candidates = this.findCandidates(unmatched, rows)

    const result: SupplierParseResult = {
      rawText: raw,
      parser: parserName,
      draft,
      unmatched,
      unmatchedDetails,
      candidates,
      hasUnmatched: unmatched.length > 0,
    }
    if (turn.needClarify) result.needClarify = turn.needClarify
    return result
  }

  /** unmatched 菜名 → 名下最近候选（包含关系优先，取前 5；没有就空 —— 前端提示「新品要先上架」） */
  private findCandidates(names: string[], rows: SupplierProductRow[]) {
    if (!names.length) return []
    const out: { productId: number; name: string; unit: string; supplyPrice: number; dailySupply: number }[] = []
    for (const name of names) {
      const hit = rows.filter((p) => {
        if (p.name.includes(name)) return true
        // 菜名 vs 商品名（去掉括号备注/数字/修饰前缀后）互含
        const core = p.name.replace(/[（(].*?[)）]/g, '').replace(/\d+/g, '').trim()
        return core.length >= 2 && (name.includes(core) || core.includes(name))
      })
      for (const p of hit.slice(0, 5)) {
        if (!out.some((o) => o.productId === p.productId)) {
          out.push({ productId: p.productId, name: p.name, unit: p.unit, supplyPrice: p.supplyPrice, dailySupply: p.dailySupply })
        }
      }
    }
    return out.slice(0, 5)
  }

  /**
   * 语音报量留痕（卡U ④）：把「识别原文 + 提交值」写进**现有**审计日志。
   * ⚠️ 不新增表、不改 schema —— 用 AuditService.log（audit_log 表现成字段 before/after）。
   *    防御：只允许给「自己名下」的商品留痕，不接受伪造 productId。
   */
  async auditTrail(userId: bigint, dto: SupplierAuditTrailDto) {
    const { byId } = await this.loadMyProducts(userId)
    for (const entry of dto.entries || []) {
      const id = Number(entry.productId)
      if (!byId.has(id)) continue // 不在名下 → 拒绝留痕（防止拿接口往审计里塞脏数据）
      await this.audit.log({
        operatorId: userId,
        action: 'VOICE_SUPPLIER_REPORT',
        entity: 'product',
        entityId: id,
        before: { rawText: dto.rawText },
        after: { op: entry.op, value: entry.value },
      })
    }
    return { logged: (dto.entries || []).length }
  }
}
