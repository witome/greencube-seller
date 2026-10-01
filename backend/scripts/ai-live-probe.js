/**
 * 真 Key 探针：确认真实模型按新 prompt 输出 matched 字段，且配错时服务端护栏能拦。
 *
 * 用途（一次性验证，不常跑）：改完 prompt / match-guard 后，用真实 DASHSCOPE_API_KEY
 * 打几轮，看模型是否真的会给每个商品带 matched、配错时 matched 是否暴露原话。
 * 消耗极少量额度（qwen-flash，几句 <1 分钱）。
 *
 * 运行：cd backend && npm run build && node scripts/ai-live-probe.js
 */
const fs = require('fs')
const path = require('path')

const BACKEND = path.join(__dirname, '..')
// 手工加载 .env（与 demand-test.js 同款，已存在的环境变量优先）
try {
  const envTxt = fs.readFileSync(path.join(BACKEND, '.env'), 'utf8')
  for (const line of envTxt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
} catch (e) {
  console.error('读取 backend/.env 失败：', e.message)
  process.exit(1)
}

const DIST_PARSER = path.join(BACKEND, 'dist', 'modules', 'ai', 'parser', 'llm.parser.js')
const DIST_GUARD = path.join(BACKEND, 'dist', 'modules', 'ai', 'parser', 'match-guard.js')

async function main() {
  const { LlmParser } = require(DIST_PARSER)
  const guard = require(DIST_GUARD)
  const parser = new LlmParser()

  const PRODUCTS = [
    { id: 1, name: '五花肉', unit: '斤', specText: '新鲜', weighType: 1, salePrice: 13.5 },
    { id: 2, name: '土豆', unit: '斤', specText: '黄心', weighType: 1, salePrice: 2.3 },
    { id: 3, name: '香菇', unit: '斤', specText: '鲜香菇', weighType: 1, salePrice: 8.0 },
    { id: 4, name: '金针菇', unit: '斤', specText: '', weighType: 1, salePrice: 6.5 },
    { id: 5, name: '大白菜', unit: '斤', specText: '', weighType: 1, salePrice: 1.8 },
    { id: 6, name: '上海青', unit: '斤', specText: '', weighType: 1, salePrice: 3.2 },
  ]

  const key = process.env.DASHSCOPE_API_KEY
  const baseUrl = (process.env.AI_PARSE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')
  const model = process.env.AI_PARSE_MODEL || 'qwen-flash'
  if (!key) { console.error('✗ 未配置 DASHSCOPE_API_KEY'); process.exit(1) }

  const systemPrompt = parser.systemPromptForOps(PRODUCTS)
  const emptyDraft = { items: [], deliveryDate: '', remark: '' }

  async function callModel(userContent) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) { const d = await res.text().catch(() => ''); throw new Error(`HTTP ${res.status}: ${d.slice(0, 200)}`) }
    const json = await res.json()
    return json?.choices?.[0]?.message?.content || ''
  }

  const sentences = ['杏鲍菇2斤', '苦瓜3斤', '大白菜20斤 秋葵5斤', '土豆10斤', '牛肉3斤']

  console.log(`model=${model}`)
  for (const s of sentences) {
    const user = `当前草稿（JSON；items 是已经在这张单上的商品，qty 已统一为斤）：\n${JSON.stringify(emptyDraft)}\n\n客户这次说的话（只对这句话判断要做什么操作）：\n${s}`
    console.log(`\n=== 「${s}」 ===`)
    let content
    try {
      content = await callModel(user)
    } catch (e) {
      console.log(`  调用失败：${e.message}`)
      continue
    }
    console.log(`  模型原始输出：${content}`)
    // 服务端护栏复核：把模型输出里的 ops 逐个过 match-guard
    try {
      const obj = JSON.parse(content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
      const ops = Array.isArray(obj?.ops) ? obj.ops : []
      const byId = new Map(PRODUCTS.map((p) => [String(p.id), p]))
      const candidates = []
      for (const op of ops) {
        const p = byId.get(String(op?.productId))
        if (!p) continue
        candidates.push({ product: p, matched: typeof op?.matched === 'string' ? op.matched.trim() : undefined })
      }
      const g = guard.filterMisMatched(s, candidates)
      console.log(`  护栏结果：保留 ${g.ok.length} 条，丢弃 ${g.rejectedTexts.length + g.rejectedUnnamed} 条，missingMatched=${g.missingMatched}，rejected=${JSON.stringify(g.rejectedTexts)}`)
    } catch (e) {
      console.log(`  护栏复核失败：${e.message}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
