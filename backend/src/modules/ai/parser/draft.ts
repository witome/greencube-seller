import { AiOp, DraftChange, DraftLine, ParsedItem, ProductRow } from './parser.types'
import { normalizeQtyToJin } from './parser.util'

/**
 * 多轮草稿合并引擎（2026-09-24）——**整个项目里唯一一处「把操作作用到草稿」的实现**
 *
 * 铁律：合并只在这一处做。前端不做合并、别的模块也不做合并，否则又会回到
 * 「同一个说法两个数 / 同一张单两份清单」的老毛病（2026-09-24 大辉拍板口径）。
 *
 * 输入：① 前端回传的当前草稿行 ② 这一句话解析出的操作 ops ③ 在售商品行
 * 输出：合并后的完整 items（含服务端回填的价格/金额） + 本次每条变化 changes
 *
 * 护栏（口径写死在这里，不散落在各调用点）：
 * - 单张草稿 ≤ 20 项：超出的**新增**直接忽略并在 changes 里说明（已加的不动）
 * - 单个数量 ≤ 9999：超出截断到 9999 并在 changes 里说明
 * - ops 里的 productId 不在「草稿 ∪ 在售商品清单」里 → 丢弃（模型编的 id 一律不认）
 */
export const MAX_DRAFT_ITEMS = 20
export const MAX_ITEM_QTY = 9999

interface WorkLine {
  productId: number
  qty: number
  unit: string
  qtyText?: string
}

/** 把前端回传的草稿清洗成可信的草稿行：只留在售商品、数量为正、去掉重复 */
export function normalizeDraftLines(input: unknown, products: ProductRow[]): DraftLine[] {
  if (!Array.isArray(input)) return []
  const byId = new Map<string, ProductRow>()
  for (const p of products) byId.set(String(p.id), p)

  const out: DraftLine[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const id = Number((raw as any).productId)
    if (!Number.isFinite(id) || id <= 0) continue
    if (!byId.has(String(id))) continue // 商品已下架/不存在 → 不带进草稿
    if (seen.has(String(id))) continue
    const qty = Number((raw as any).qty)
    if (!Number.isFinite(qty) || qty <= 0) continue
    seen.add(String(id))
    out.push({
      productId: id,
      qty: Math.min(qty, MAX_ITEM_QTY),
      unit: typeof (raw as any).unit === 'string' ? (raw as any).unit : undefined,
      name: typeof (raw as any).name === 'string' ? (raw as any).name : undefined,
    })
    if (out.length >= MAX_DRAFT_ITEMS) break
  }
  return out
}

/** 降级路径用：把「这一句单独解析出来的清单」当成一串 add（相加），保证已加的商品一个不丢 */
export function itemsToAddOps(items: ParsedItem[]): AiOp[] {
  return (items || []).map((it) => ({
    op: 'add' as const,
    productId: it.productId,
    qty: it.qty, // ⚠️ 这里已经是「斤」（parser 侧换算过），unit 传商品单位，避免二次换算
    unit: it.unit,
    qtyText: it.qtyText,
  }))
}

export interface ApplyResult {
  items: ParsedItem[]
  changes: DraftChange[]
}

export function applyOps(draft: DraftLine[], ops: AiOp[], products: ProductRow[]): ApplyResult {
  const byId = new Map<string, ProductRow>()
  for (const p of products) byId.set(String(p.id), p)

  // 用 Map 保序：草稿原顺序在前，新加的商品按出现顺序追加
  const work = new Map<string, WorkLine>()
  for (const line of draft) {
    const p = byId.get(String(line.productId))
    if (!p) continue
    work.set(String(line.productId), {
      productId: Number(p.id),
      qty: line.qty,
      unit: p.unit || '斤',
    })
  }

  const changes: DraftChange[] = []
  const unitOf = (p: ProductRow) => p.unit || '斤'

  /** 单条数量守卫：超出上限截断，并在 changes 里说明 */
  const clampQty = (qty: number, change: DraftChange): { value: number; clamped: boolean } => {
    if (qty > MAX_ITEM_QTY) {
      change.note = `单个数量上限 ${MAX_ITEM_QTY}，已按 ${MAX_ITEM_QTY} 计`
      return { value: MAX_ITEM_QTY, clamped: true }
    }
    return { value: qty, clamped: false }
  }

  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || typeof op !== 'object') continue
    const kind = (op as any).op

    // ── clear：清空整张草稿（口径 3）──
    if (kind === 'clear') {
      if (!work.size) continue
      const removed = [...work.values()]
      changes.push({
        type: 'clear',
        productId: 0,
        name: '全部商品',
        unit: '',
        fromQty: removed.length,
        toQty: 0,
        delta: -removed.length,
        text: `已清空全部 ${removed.length} 项`,
      })
      work.clear()
      continue
    }

    if (kind !== 'add' && kind !== 'set' && kind !== 'remove') continue // 非法操作 → 丢弃

    // ── 商品必须真实存在：草稿没有、在售清单也没有的 productId → 丢弃 ──
    const id = Number((op as any).productId)
    if (!Number.isFinite(id) || id <= 0) continue
    const p = byId.get(String(id))
    if (!p) continue

    const key = String(p.id)
    const cur = work.get(key) || null
    const unit = typeof (op as any).unit === 'string' && (op as any).unit.trim() ? (op as any).unit.trim() : unitOf(p)

    // ── remove ──
    if (kind === 'remove') {
      if (!cur) continue // 草稿里本来就没有 → 无事发生，不留噪声气泡
      work.delete(key)
      changes.push({
        type: 'remove',
        productId: Number(p.id),
        name: p.name,
        unit: cur.unit,
        fromQty: cur.qty,
        toQty: 0,
        delta: -cur.qty,
        text: `移除 ${p.name} ${cur.qty}${cur.unit}`,
      })
      continue
    }

    // ── add / set 都需要一个数量 ──
    const rawQty = Number((op as any).qty)
    if (!Number.isFinite(rawQty) || rawQty <= 0) continue
    // 单位照客户原话，换算成斤交给我们自己的唯一口径（不让模型算斤）
    const qtyJin = normalizeQtyToJin(rawQty, unit, p.weighType, p.specText)
    if (!Number.isFinite(qtyJin) || qtyJin <= 0) continue

    const opQtyText = typeof (op as any).qtyText === 'string' && (op as any).qtyText.trim() ? (op as any).qtyText.trim() : ''

    if (kind === 'add') {
      if (cur) {
        const change: DraftChange = {
          type: 'add',
          productId: Number(p.id),
          name: p.name,
          unit: cur.unit,
          fromQty: cur.qty,
          toQty: cur.qty,
          delta: qtyJin,
          text: '',
        }
        const { value: next } = clampQty(Math.round((cur.qty + qtyJin) * 100) / 100, change)
        change.toQty = next
        change.delta = Math.round((next - cur.qty) * 100) / 100
        change.text = `${p.name} ${cur.qty}${cur.unit} → ${next}${cur.unit}`
        cur.qty = next
        changes.push(change)
      } else {
        // 新增：受 20 项上限约束
        if (work.size >= MAX_DRAFT_ITEMS) {
          changes.push({
            type: 'add',
            productId: Number(p.id),
            name: p.name,
            unit: unitOf(p),
            fromQty: 0,
            toQty: 0,
            delta: 0,
            text: `单张草稿最多 ${MAX_DRAFT_ITEMS} 项，未加入 ${p.name}`,
            note: `已达 ${MAX_DRAFT_ITEMS} 项上限`,
          })
          continue
        }
        const change: DraftChange = {
          type: 'add',
          productId: Number(p.id),
          name: p.name,
          unit: unitOf(p),
          fromQty: 0,
          toQty: 0,
          delta: qtyJin,
          text: '',
        }
        const { value: next, clamped } = clampQty(qtyJin, change)
        change.toQty = next
        change.delta = next
        change.text = `新增 ${p.name} ${next}${unitOf(p)}`
        // 截断过就别再用客户原话的数量文案（会出现「9999斤」配「99999斤」的错位）
        work.set(key, { productId: Number(p.id), qty: next, unit: unitOf(p), qtyText: clamped ? undefined : opQtyText || undefined })
        changes.push(change)
      }
      continue
    }

    // ── set：设置成某个数量（「改成 / 换成 / 只要」）；草稿里没有就等同新增 ──
    if (cur) {
      const change: DraftChange = {
        type: 'set',
        productId: Number(p.id),
        name: p.name,
        unit: cur.unit,
        fromQty: cur.qty,
        toQty: 0,
        delta: 0,
        text: '',
      }
      const { value: next } = clampQty(qtyJin, change)
      change.toQty = next
      change.delta = Math.round((next - cur.qty) * 100) / 100
      change.text = `${p.name} ${cur.qty}${cur.unit} → ${next}${cur.unit}`
      cur.qty = next
      changes.push(change)
    } else {
      if (work.size >= MAX_DRAFT_ITEMS) {
        changes.push({
          type: 'set',
          productId: Number(p.id),
          name: p.name,
          unit: unitOf(p),
          fromQty: 0,
          toQty: 0,
          delta: 0,
          text: `单张草稿最多 ${MAX_DRAFT_ITEMS} 项，未加入 ${p.name}`,
          note: `已达 ${MAX_DRAFT_ITEMS} 项上限`,
        })
        continue
      }
      const change: DraftChange = {
        type: 'set',
        productId: Number(p.id),
        name: p.name,
        unit: unitOf(p),
        fromQty: 0,
        toQty: 0,
        delta: qtyJin,
        text: '',
      }
      const { value: next, clamped } = clampQty(qtyJin, change)
      change.toQty = next
      change.delta = next
      change.text = `新增 ${p.name} ${next}${unitOf(p)}`
      work.set(key, { productId: Number(p.id), qty: next, unit: unitOf(p), qtyText: clamped ? undefined : opQtyText || undefined })
      changes.push(change)
    }
  }

  // ── 生成合并后的清单：价格/金额一律由服务端从 product 表回填（模型碰不到钱）──
  const items: ParsedItem[] = []
  for (const line of work.values()) {
    const p = byId.get(String(line.productId))
    if (!p) continue
    const price = Number(p.salePrice)
    const qty = Math.round(line.qty * 100) / 100
    const unit = p.unit || '斤'
    items.push({
      productId: Number(p.id),
      name: p.name,
      unit,
      specText: p.specText,
      weighType: p.weighType,
      qty,
      qtyText: line.qtyText || `${qty}${unit}`,
      price,
      amount: Math.round(qty * price * 100) / 100,
    })
  }

  return { items, changes }
}

/** 草稿内容指纹（FNV-1a 32 位）——同一份草稿指纹相同，供 Hermes 复核/排查比对用 */
export function draftFingerprint(items: ParsedItem[]): string {
  const key = items.map((i) => `${i.productId}:${i.qty}`).sort().join(',')
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
