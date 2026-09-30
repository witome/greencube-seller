/**
 * match-guard 服务端护栏自测（2026-09-30 补全 parseTurn 后）
 *
 * 验什么：模型「把没上架的菜配成近亲菜」时，单句口径与多轮口径都要被
 * 服务端硬护栏拦下 —— 配错的那条丢弃、客户原话字眼进 unmatched。
 *
 * 与 ai-unmatched-strict-test.js 的区别：那边的假模型是「严格版」（永不配错），
 * 只能验 prompt 措辞与诚实路径；本脚本的假模型是「故意配错版」，专门验护栏。
 *
 * 运行：cd backend && npm run build && node scripts/ai-match-guard-test.js
 */
const http = require('http')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const DIST_PARSER = path.join(ROOT, 'dist', 'modules', 'ai', 'parser', 'llm.parser.js')
const DIST_GUARD = path.join(ROOT, 'dist', 'modules', 'ai', 'parser', 'match-guard.js')

let passCount = 0
let failCount = 0
const failLines = []
function check(name, ok, detail) {
  if (ok) { passCount++; console.log(`  PASS  ${name}`) }
  else { failCount++; failLines.push(`${name}${detail ? ' ← ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' ← ' + detail : ''}`) }
}

if (!fs.existsSync(DIST_PARSER)) { console.error('✗ 先构建：cd backend && npm run build'); process.exit(1) }

// ── 故意配错的假模型：把「杏鲍菇」配成「香菇」（matched 诚实报原话），把「秋葵」配成「豆角」 ──
const server = http.createServer((req, res) => {
  if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end('{}') }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let messages = []
    try { messages = JSON.parse(body).messages || [] } catch (e) { /* 忽略 */ }
    const user = (messages.find((m) => m.role === 'user') || {}).content || ''
    const isTurn = user.includes('当前草稿')
    const marker = '客户这次说的话'
    const idx = user.indexOf(marker)
    const sentence = isTurn && idx >= 0 ? user.slice(idx + marker.length).replace(/^[^\n]*\n/, '').trim() : user.trim()

    // 配错映射：近亲菜 → 清单里真实商品 id（香菇=3、五花肉=1、土豆=2）
    let content
    if (sentence.includes('杏鲍菇')) {
      // 故意配错：香菇 id=3，matched 诚实写「杏鲍菇」
      content = isTurn
        ? JSON.stringify({ ops: [{ op: 'add', productId: 3, qty: 2, unit: '斤', qtyText: '2斤', matched: '杏鲍菇' }], deliveryDate: '', remark: '', unmatched: [], needClarify: '' })
        : JSON.stringify({ items: [{ productId: 3, qty: 2, unit: '斤', qtyText: '2斤', matched: '杏鲍菇' }], deliveryDate: '', remark: '', unmatched: [] })
    } else if (sentence.includes('秋葵')) {
      // 故意配错：土豆 id=2，matched 诚实写「秋葵」
      content = isTurn
        ? JSON.stringify({ ops: [{ op: 'add', productId: 2, qty: 5, unit: '斤', qtyText: '5斤', matched: '秋葵' }], deliveryDate: '', remark: '', unmatched: [], needClarify: '' })
        : JSON.stringify({ items: [{ productId: 2, qty: 5, unit: '斤', qtyText: '5斤', matched: '秋葵' }], deliveryDate: '', remark: '', unmatched: [] })
    } else if (sentence.includes('土豆')) {
      // 正确命中：土豆 id=2，matched=「土豆」
      content = isTurn
        ? JSON.stringify({ ops: [{ op: 'add', productId: 2, qty: 10, unit: '斤', qtyText: '10斤', matched: '土豆' }], deliveryDate: '', remark: '', unmatched: [], needClarify: '' })
        : JSON.stringify({ items: [{ productId: 2, qty: 10, unit: '斤', qtyText: '10斤', matched: '土豆' }], deliveryDate: '', remark: '', unmatched: [] })
    } else {
      // 默认：不配错，空 ops / 空 items
      content = isTurn
        ? JSON.stringify({ ops: [], deliveryDate: '', remark: '', unmatched: [sentence], needClarify: '' })
        : JSON.stringify({ items: [], deliveryDate: '', remark: '', unmatched: [sentence] })
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
  })
})

process.env.DASHSCOPE_API_KEY = 'fake-local-match-guard-test'
process.env.AI_PARSE_BASE_URL = ''
process.env.AI_PARSE_TIMEOUT_MS = '8000'
process.env.AI_PARSE_JSON_MODE = '1'

server.listen(0, '127.0.0.1', async () => {
  process.env.AI_PARSE_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`
  const { LlmParser } = require(DIST_PARSER)
  const parser = new LlmParser()
  const guard = require(DIST_GUARD)

  const PRODUCTS = [
    { id: 1, name: '五花肉', unit: '斤', specText: '新鲜', weighType: 1, salePrice: 13.5 },
    { id: 2, name: '土豆', unit: '斤', specText: '黄心', weighType: 1, salePrice: 2.3 },
    { id: 3, name: '香菇', unit: '斤', specText: '鲜香菇', weighType: 1, salePrice: 8.0 },
    { id: 4, name: '金针菇', unit: '斤', specText: '', weighType: 1, salePrice: 6.5 },
  ]
  const emptyDraft = { items: [], deliveryDate: '', remark: '' }

  try {
    console.log('\n[1/3] 单句口径 parse()：模型把「杏鲍菇」配成「香菇」→ 护栏丢弃 → 抛错降级（不给空草稿）')
    let threw = null
    try { await parser.parse('杏鲍菇2斤', PRODUCTS) } catch (e) { threw = e }
    check('「杏鲍菇2斤」单句抛错降级', !!threw, threw ? '' : '未抛错（配错的香菇进了 items？）')

    console.log('\n[2/3] 多轮口径 parseTurn()：配错 op 被丢弃、原话进 unmatched')
    const r1 = await parser.parseTurn('杏鲍菇2斤', PRODUCTS, emptyDraft)
    check('「杏鲍菇2斤」多轮 ops 被清空', Array.isArray(r1.ops) && r1.ops.length === 0, JSON.stringify(r1.ops))
    check('「杏鲍菇2斤」多轮 unmatched 含「杏鲍菇」', Array.isArray(r1.unmatched) && r1.unmatched.includes('杏鲍菇'), JSON.stringify(r1.unmatched))

    const r2 = await parser.parseTurn('秋葵5斤', PRODUCTS, emptyDraft)
    check('「秋葵5斤」多轮 ops 被清空', Array.isArray(r2.ops) && r2.ops.length === 0, JSON.stringify(r2.ops))
    check('「秋葵5斤」多轮 unmatched 含「秋葵」', Array.isArray(r2.unmatched) && r2.unmatched.includes('秋葵'), JSON.stringify(r2.unmatched))

    console.log('\n[3/3] 正确命中不受护栏误伤')
    const r3 = await parser.parseTurn('土豆10斤', PRODUCTS, emptyDraft)
    const op = r3.ops && r3.ops[0]
    check('「土豆10斤」多轮 op 保留且命中土豆', !!op && op.productId === 2, JSON.stringify(r3.ops))
    check('「土豆10斤」多轮 unmatched 为空', Array.isArray(r3.unmatched) && r3.unmatched.length === 0, JSON.stringify(r3.unmatched))

    // 护栏纯函数自证：matched 缺省 → 通过（宁松不严）
    const missing = guard.filterMisMatched('土豆10斤', [{ product: PRODUCTS[1], matched: undefined }])
    check('matched 缺省 → 通过（兜底方向）', missing.ok.length === 1 && missing.rejectedTexts.length === 0)
  } catch (e) {
    failCount++
    failLines.push(`脚本异常：${e && e.stack ? e.stack.split('\n')[0] : String(e)}`)
    console.error(e)
  } finally {
    server.close()
  }

  console.log(`\n========== match-guard 自测结果：${passCount} 通过 / ${failCount} 失败 ==========`)
  if (failLines.length) { console.log('失败明细：'); for (const l of failLines) console.log('  - ' + l); process.exit(1) }
  process.exit(0)
})
