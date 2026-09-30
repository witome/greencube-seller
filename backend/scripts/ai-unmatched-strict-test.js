/**
 * 卡AA 需求1 自测：AI 不许把「清单里没有的菜」配成近亲商品（2026-09-30）
 *
 * 验什么：
 *   llm.parser.ts 两个 system prompt（单句版 + ops 多轮版）加入硬规则后——
 *   ① 静态断言：两版提示词都包含「近亲不许配」规则全文 + 强化后的「原话进 unmatched」措辞；
 *   ② 行为断言（真 LlmParser + 本地严格假模型，真实 HTTP 往返）：
 *      - 「杏鲍菇2斤」「荷兰豆10斤」「牛肉3斤」「牛油果2个」（清单里没有，且杏鲍菇/牛肉
 *        与清单里的香菇金针菇/五花肉是近亲）→ 模型 items 为空、unmatched 含原话；
 *        单句口径全空单必须抛错降级（绝不给客户空草稿），多轮口径 ops 为空。
 *      - 「五花肉5斤」「土豆10斤」（清单里真实存在）→ 正常命中。
 *
 * 假模型做法沿用了 scripts/ai-fake-model.js 的既有套路（OpenAI 兼容 /chat/completions），
 * 但决策器是「严格版」：只按 system 提示词里清单的**名称精确对得上**判定，
 * 对不上的一律进 unmatched —— 这正是新硬规则要求真模型做到的行为。
 * （生产真 Key 探针由 Hermes 另行执行，本脚本只跑本地假模型链路。）
 *
 * 运行（必须先构建，保证测的是当前源码的编译产物）：
 *   cd backend && npm run build && node scripts/ai-unmatched-strict-test.js
 */
const http = require('http')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const SRC_PARSER = path.join(ROOT, 'src', 'modules', 'ai', 'parser', 'llm.parser.ts')
const DIST_PARSER = path.join(ROOT, 'dist', 'modules', 'ai', 'parser', 'llm.parser.js')

let passCount = 0
let failCount = 0
const failLines = []
function check(name, ok, detail) {
  if (ok) {
    passCount++
    console.log(`  PASS  ${name}`)
  } else {
    failCount++
    failLines.push(`${name}${detail ? ' ← ' + detail : ''}`)
    console.log(`  FAIL  ${name}${detail ? ' ← ' + detail : ''}`)
  }
}

// ─────────────────────────────────────────────
// 0) 前置：dist 必须存在且不旧于 src（防止测到旧编译产物）
// ─────────────────────────────────────────────
if (!fs.existsSync(DIST_PARSER)) {
  console.error('✗ 未找到 dist 编译产物，请先执行：cd backend && npm run build')
  process.exit(1)
}
if (fs.statSync(SRC_PARSER).mtimeMs > fs.statSync(DIST_PARSER).mtimeMs) {
  console.error('✗ dist 落后于 src（llm.parser.ts 改过但没重新构建），请先执行：cd backend && npm run build')
  process.exit(1)
}

// ─────────────────────────────────────────────
// 1) 本地严格假模型（OpenAI 兼容 /chat/completions）
// ─────────────────────────────────────────────
/** 从 system 提示词里解析商品清单（与 ai-fake-model.js 同款正则，清单格式：id | 名称 | 单位 | 规格 | 单价） */
function parseProducts(system) {
  const out = []
  for (const line of String(system || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([\d.]+)\s*元\s*$/)
    if (m) out.push({ id: Number(m[1]), name: m[2], unit: m[3], price: Number(m[5]) })
  }
  return out
}

const extractQty = (sentence) => {
  const m = sentence.match(/(\d+(?:\.\d+)?)\s*(斤|公斤|千克|颗|个|把|箱|枚|份|盒|条|包)/)
  return m ? { qty: Number(m[1]), unit: m[2], qtyText: `${m[1]}${m[2]}` } : null
}

/**
 * 严格决策：只有「客户句子里原样出现清单商品名」才算对得上；
 * 对不上的一律进 unmatched —— 新硬规则的机械执行版。
 */
function strictDecide(sentence, products) {
  const hits = []
  for (const p of products) {
    if (!sentence.includes(p.name)) continue
    const at = sentence.indexOf(p.name)
    const q = extractQty(sentence.slice(at)) || extractQty(sentence) || { qty: 1, unit: p.unit, qtyText: `1${p.unit}` }
    hits.push({ p, q })
  }
  return hits
}

// 每次请求的模型原始输出留痕（单句口径的 items/unmatched 断言从这里取）
let lastReply = null

const server = http.createServer((req, res) => {
  if (!req.url.endsWith('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    return res.end('{"error":"not found"}')
  }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let messages = []
    try { messages = JSON.parse(body).messages || [] } catch (e) { /* 忽略 */ }
    const system = (messages.find((m) => m.role === 'system') || {}).content || ''
    const user = (messages.find((m) => m.role === 'user') || {}).content || ''
    const products = parseProducts(system)
    // 多轮口径的 user 消息带「当前草稿」头，单句口径就是客户原话
    const isTurn = user.includes('当前草稿')
    const marker = '客户这次说的话'
    const idx = user.indexOf(marker)
    const sentence = isTurn && idx >= 0 ? user.slice(idx + marker.length).replace(/^[^\n]*\n/, '').trim() : user.trim()

    const hits = strictDecide(sentence, products)
    let content
    if (!isTurn) {
      content = JSON.stringify({
        items: hits.map(({ p, q }) => ({ productId: p.id, qty: q.qty, unit: q.unit, qtyText: q.qtyText })),
        deliveryDate: /明天/.test(sentence) ? '明天' : '',
        remark: '',
        unmatched: hits.length ? [] : [sentence],
      })
    } else {
      content = JSON.stringify({
        ops: hits.map(({ p, q }) => ({ op: 'add', productId: p.id, qty: q.qty, unit: q.unit, qtyText: q.qtyText })),
        deliveryDate: '',
        remark: '',
        unmatched: hits.length ? [] : [sentence],
        needClarify: '',
      })
    }
    lastReply = { sentence, isTurn, content, parsed: JSON.parse(content) }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
  })
})

// ─────────────────────────────────────────────
// 2) 起服务 → 跑用例 → 收尾
// ─────────────────────────────────────────────
// 环境变量先钉死为本地假模型（覆盖 shell 里可能存在的真实 Key，保证不外呼）
process.env.DASHSCOPE_API_KEY = 'fake-local-strict-test'
process.env.AI_PARSE_BASE_URL = '' // 起服务后回填
process.env.AI_PARSE_TIMEOUT_MS = '8000'
process.env.AI_PARSE_JSON_MODE = '1'

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  process.env.AI_PARSE_BASE_URL = `http://127.0.0.1:${port}/v1`

  // require dist 产物（构建后的真实现，私有方法在 JS 运行时同样可调）
  const { LlmParser } = require(DIST_PARSER)
  const parser = new LlmParser()

  // 与真实在售清单同构：故意放进「近亲」——香菇/金针菇（对杏鲍菇）、五花肉（对牛肉）
  const PRODUCTS = [
    { id: 1, name: '五花肉', unit: '斤', specText: '新鲜', weighType: 1, salePrice: 13.5 },
    { id: 2, name: '土豆', unit: '斤', specText: '黄心', weighType: 1, salePrice: 2.3 },
    { id: 3, name: '香菇', unit: '斤', specText: '鲜香菇', weighType: 1, salePrice: 8.0 },
    { id: 4, name: '金针菇', unit: '斤', specText: '', weighType: 1, salePrice: 6.5 },
    { id: 5, name: '上海青', unit: '斤', specText: '', weighType: 1, salePrice: 3.2 },
  ]

  const UNMATCHED_CASES = ['杏鲍菇2斤', '荷兰豆10斤', '牛肉3斤', '牛油果2个']
  const NORMAL_CASES = [
    { text: '五花肉5斤', productId: 1, name: '五花肉', qty: 5 },
    { text: '土豆10斤', productId: 2, name: '土豆', qty: 10 },
  ]

  try {
    // ── 3) 静态断言：两个 prompt 都含新硬规则 ──
    console.log('\n[1/3] 提示词静态断言（单句版 + ops 多轮版同口径）')
    const sp1 = parser.systemPrompt(PRODUCTS)
    const sp2 = parser.systemPromptForOps(PRODUCTS)
    const MUST_HAVE = [
      '哪怕与清单里某个菜是近亲、看起来像同一种东西，也绝对不许配',
      '客户要杏鲍菇而清单只有香菇/金针菇',
      '必须进 unmatched，不许配成香菇',
      '客户要牛肉而清单只有猪肉',
      '判断标准只有一个：客户说的名字与清单商品名称是否对得上',
      '不要猜成别的商品',
      '一字不差',
    ]
    for (const [label, sp] of [['单句版', sp1], ['ops多轮版', sp2]]) {
      for (const frag of MUST_HAVE) {
        check(`${label} 提示词含「${frag.slice(0, 18)}…」`, sp.includes(frag))
      }
    }
    // 强化条：原话必须一字不差进 unmatched（不许丢弃/缩写/强配）
    check('单句版强化条位置：紧跟近亲规则之后、JSON格式条之前',
      sp1.indexOf('一字不差') < sp1.indexOf('只输出 JSON'))
    check('ops多轮版强化条位置：紧跟近亲规则之后',
      sp2.indexOf('一字不差') > sp2.indexOf('近亲') && sp2.indexOf('一字不差') < sp2.indexOf('在售商品清单'))

    // ── 4) 行为断言 · 单句口径 ──
    console.log('\n[2/3] 单句口径（parse）：清单外菜名 → 全空单抛错降级 + 模型输出 items 空 / unmatched 含原话')
    for (const text of UNMATCHED_CASES) {
      let threw = null
      try { await parser.parse(text, PRODUCTS) } catch (e) { threw = e }
      check(`「${text}」单句 parse 抛错降级（不给空草稿）`, !!threw, threw ? '' : '未抛错')
      const r = lastReply || {}
      check(`「${text}」模型 items 为空`, Array.isArray(r.parsed?.items) && r.parsed.items.length === 0, JSON.stringify(r.parsed?.items))
      check(`「${text}」unmatched 含原话`, Array.isArray(r.parsed?.unmatched) && r.parsed.unmatched.includes(text), JSON.stringify(r.parsed?.unmatched))
    }
    for (const c of NORMAL_CASES) {
      let r = null
      let err = null
      try { r = await parser.parse(c.text, PRODUCTS) } catch (e) { err = e }
      check(`「${c.text}」正常命中（不抛错）`, !!r && !err, err ? String(err.message) : '')
      const it = r && r.items && r.items[0]
      check(`「${c.text}」命中商品 id/name 正确`, !!it && it.productId === c.productId && it.name === c.name, it ? `${it.productId}/${it.name}` : 'items 空')
      check(`「${c.text}」数量正确`, !!it && it.qty === c.qty, it ? String(it.qty) : '')
      check(`「${c.text}」unmatched 为空`, !!r && Array.isArray(r.unmatched) && r.unmatched.length === 0)
    }

    // ── 5) 行为断言 · ops 多轮口径 ──
    console.log('\n[3/3] ops 多轮口径（parseTurn）：清单外菜名 → ops 空 + unmatched 含原话')
    const emptyDraft = { items: [], deliveryDate: '', remark: '' }
    for (const text of UNMATCHED_CASES) {
      const r = await parser.parseTurn(text, PRODUCTS, emptyDraft)
      check(`「${text}」多轮 ops 为空`, Array.isArray(r.ops) && r.ops.length === 0, JSON.stringify(r.ops))
      check(`「${text}」多轮 unmatched 含原话`, Array.isArray(r.unmatched) && r.unmatched.includes(text), JSON.stringify(r.unmatched))
      check(`「${text}」多轮不触发 needClarify`, !r.needClarify)
    }
    for (const c of NORMAL_CASES) {
      const r = await parser.parseTurn(c.text, PRODUCTS, emptyDraft)
      const op = r.ops && r.ops[0]
      check(`「${c.text}」多轮 add 命中正确商品`, !!op && op.op === 'add' && op.productId === c.productId, JSON.stringify(r.ops))
      check(`「${c.text}」多轮 unmatched 为空`, Array.isArray(r.unmatched) && r.unmatched.length === 0)
    }
  } catch (e) {
    failCount++
    failLines.push(`脚本异常：${e && e.stack ? e.stack.split('\n')[0] : String(e)}`)
    console.error(e)
  } finally {
    server.close()
  }

  console.log(`\n========== 卡AA 需求1 自测结果：${passCount} 通过 / ${failCount} 失败 ==========`)
  if (failLines.length) {
    console.log('失败明细：')
    for (const l of failLines) console.log('  - ' + l)
    process.exit(1)
  }
  process.exit(0)
})
