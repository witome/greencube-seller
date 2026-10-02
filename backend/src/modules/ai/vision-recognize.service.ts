import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import * as fs from 'fs'
import * as path from 'path'

/**
 * 拍照快速上架 · 视觉识别（卡BP 2026-10-02）
 *
 * 供货商拍/选一张菜的照片 → 百炼视觉模型（qwen-vl-plus，OpenAI 兼容协议）识别，
 * 只给「商品名称 / 分类 / 计量方式」三个**建议值**用于表单预填。
 *
 * ── 红线（写死在代码里，不靠模型自觉）──
 * 1. AI 绝不落库：本服务只读图片、只返回建议值，任何写库通道都与这里无关。
 *    供货价 / 日可供量 / 规格文本 一律不在识别范围（模型想给也不收）。
 * 2. 服务端硬校验（sanitizeRecognize，可单测）：
 *    · categoryId 不在「该供应商已授权分类（supplier_category）」内 → 置 null；
 *    · weighType 只认 1/2，其它 → 置 null；
 *    · name 截断到 100 字（与 Product.name VarChar(100) 同口径），空/非字符串 → null。
 * 3. 失败 / 超时 / 返回垃圾 → **不抛错**，返回全空建议（parser:'none'），
 *    前端表单留空走手填，绝不阻断提交链路（与 /ai/parse 同一兜底口径）。
 *
 * ── 降级开关 ──
 * AI_PARSE_MODE=rule 或未配 DASHSCOPE_API_KEY → 直接返回空建议（不调模型、不报错）。
 *
 * ── 配置（backend/.env）──
 * AI_VL_MODEL       默认 qwen-vl-plus
 * AI_VL_TIMEOUT_MS  默认 9000（识别中前端有 loading，超时即降级）
 * DASHSCOPE_API_KEY / AI_PARSE_BASE_URL 复用现有配置
 */

/// 识别建议（给前端表单预填用；全空 = 识别失败/降级，前端静默手填）
export type RecognizeSuggestion = {
  name: string | null
  categoryId: number | null
  categoryName: string | null
  weighType: number | null
  parser: 'vl' | 'none'
}

/**
 * 模型输出 → 合法建议（**服务端硬校验**，不依赖提示词自觉）。
 * 独立导出为纯函数：自测脚本可直接 require dist 验证「越权分类被丢弃」等分支。
 *
 * @param raw        模型返回的原始解析对象（可能是任意垃圾）
 * @param authorized 授权分类表：categoryId(字符串) → 分类名
 */
export function sanitizeRecognize(
  raw: any,
  authorized: Map<string, string>,
): RecognizeSuggestion {
  const empty: RecognizeSuggestion = { name: null, categoryId: null, categoryName: null, weighType: null, parser: 'vl' }
  if (!raw || typeof raw !== 'object') return empty

  // name：字符串才收，截断 100（模型偶尔废话，硬截）
  let name: string | null = null
  if (typeof raw.name === 'string' && raw.name.trim()) name = raw.name.trim().slice(0, 100)

  // categoryId：必须在该供应商已授权分类内，否则丢弃（防跨分类越权预填）
  let categoryId: number | null = null
  let categoryName: string | null = null
  const cid = Number(raw.categoryId)
  if (Number.isFinite(cid) && authorized.has(String(cid))) {
    categoryId = cid
    categoryName = authorized.get(String(cid)) || null
  }

  // weighType：只认 1 称重 / 2 固定规格
  let weighType: number | null = null
  const wt = Number(raw.weighType)
  if (wt === 1 || wt === 2) weighType = wt

  return { name, categoryId, categoryName, weighType, parser: 'vl' }
}

@Injectable()
export class VisionRecognizeService {
  private readonly logger = new Logger('AiVisionRecognize')

  // 与 UploadService 同一目录口径：backend/uploads
  // （源码 __dirname = backend/src/modules/ai，dist 运行时 = backend/dist/modules/ai，三层 .. 到 backend 根）
  private uploadDir = path.join(__dirname, '..', '..', '..', 'uploads')

  constructor(private prisma: PrismaService) {}

  async recognize(userId: bigint, imagePath: string): Promise<RecognizeSuggestion> {
    const empty: RecognizeSuggestion = { name: null, categoryId: null, categoryName: null, weighType: null, parser: 'none' }

    // ── 降级开关（与 /ai/parse 同一口径）：rule 模式 / 没配 Key → 空建议，前端手填 ──
    const mode = (process.env.AI_PARSE_MODE || 'auto').trim().toLowerCase()
    const key = process.env.DASHSCOPE_API_KEY
    if (mode === 'rule' || !key) return empty

    // ── 图片地址白名单：只收本站 /uploads/ 相对路径（防外链 SSRF / 目录穿越）──
    const p = (imagePath || '').trim()
    if (!p.startsWith('/uploads/') || p.length > 255 || p.includes('..')) return empty

    // ── 供应商授权分类（categoryId 硬校验的依据）──
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } })
    if (!supplier) return empty
    const authCats = await this.prisma.supplierCategory.findMany({
      where: { supplierId: supplier.id },
      include: { category: true },
    })
    const authorized = new Map<string, string>()
    for (const c of authCats) authorized.set(String(c.categoryId), c.category.name)

    // ── 读本地图片 → base64 data URI（比拼外网回拉 URL 稳）──
    const filename = p.slice('/uploads/'.length)
    const filePath = path.join(this.uploadDir, filename)
    let dataUri: string
    try {
      if (!fs.existsSync(filePath)) return empty
      const buf = fs.readFileSync(filePath)
      if (!buf.length) return empty
      // 兜底限长：8MB（上传层已限 5MB，这里防御历史遗留大图）
      if (buf.length > 8 * 1024 * 1024) return empty
      const ext = (filename.split('.').pop() || 'jpg').toLowerCase()
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      dataUri = `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      return empty
    }

    // ── 调视觉模型（失败/超时/垃圾 → 空建议，绝不抛错阻断）──
    try {
      const raw = await this.callModel(authorized, dataUri)
      const out = sanitizeRecognize(raw, authorized)
      // 模型啥也没认出来（三字段全空）→ 按失败口径返回（前端不弹「识别成功」）
      if (!out.name && !out.categoryId && !out.weighType) return empty
      return out
    } catch (e: any) {
      this.logger.warn(`拍照识别失败，已降级为手填：${e?.message || e}`)
      return empty
    }
  }

  private async callModel(authorized: Map<string, string>, dataUri: string): Promise<any> {
    const baseUrl = (process.env.AI_PARSE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')
    const model = process.env.AI_VL_MODEL || 'qwen-vl-plus'
    const timeoutMs = Number(process.env.AI_VL_TIMEOUT_MS || 9000)

    const catList = [...authorized.entries()].map(([id, name]) => `${id} | ${name}`).join('\n')
    const prompt = `你是生鲜批发市场的商品拍照识别助手。这张照片里是市场里的一个菜/商品，请识别它。

只输出 JSON，不要解释、不要 markdown 代码块。格式固定为：
{"name":"商品名称","categoryId":分类id,"weighType":1 或 2}

字段规则：
1. name：商品名，参照市场叫法（如「山东大姜（老姜）」「西红柿（粉果）」「大白菜」），不超过 20 字。
2. categoryId：只能从下面给你的「可用分类清单」里选 id，禁止编造清单外的分类。
3. weighType：散装按斤称重卖的是 1（称重）；按个/袋/箱等固定规格卖的是 2（固定规格）。拿不准就填 1。
4. 照片里不是菜/食品类商品，或实在认不出来 → 输出 {"name":"","categoryId":0,"weighType":0}。

可用分类清单（格式：id | 名称）：
${catList || '（该供应商暂无可用分类）'}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 9000)

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: dataUri } },
                { type: 'text', text: prompt },
              ],
            },
          ],
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`视觉模型接口返回 ${res.status}：${detail.slice(0, 200)}`)
      }

      const json: any = await res.json()
      const content = json?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) throw new Error('视觉模型返回内容为空')
      return this.extractJson(content)
    } finally {
      clearTimeout(timer)
    }
  }

  /** 容错取 JSON：模型偶尔裹 ```json 或加一句废话（与 llm.parser 同一套容错） */
  private extractJson(s: string): any {
    let t = (s || '').trim()
    t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    const i = t.indexOf('{')
    const j = t.lastIndexOf('}')
    if (i >= 0 && j > i) t = t.slice(i, j + 1)
    const parsed = JSON.parse(t)
    if (!parsed || typeof parsed !== 'object') throw new Error('视觉模型返回的不是 JSON 对象')
    return parsed
  }
}
