/**
 * 本地「假模型服务」—— 只为自测 AI 下单的 ops 多轮口径，**不要在生产用**
 *
 * 为什么需要它：本机没有（也不许借生产）DASHSCOPE_API_KEY，但 ops 路径、合并、changes 生成、
 * 「模型塞价格被丢弃」「编造 productId 被丢弃」这些恰恰必须在真实 HTTP 往返上验。
 * 做法：起一个 OpenAI 兼容的 /chat/completions，按客户原话分支返回给定的 ops JSON，
 * 再把后端 AI_PARSE_BASE_URL 指过来 + 随便给个假 DASHSCOPE_API_KEY。
 *
 * 用法：
 *   node scripts/ai-fake-model.js                # 默认监听 3951
 *   FAKE_MODEL_PORT=3951 FAKE_MODEL_LOG=xxx.jsonl node scripts/ai-fake-model.js
 *   # 后端侧（不写 .env，用行内环境变量覆盖）：
 *   AI_PARSE_MODE=llm AI_PARSE_BASE_URL=http://127.0.0.1:3951/v1 DASHSCOPE_API_KEY=fake-local \
 *     AI_PARSE_TIMEOUT_MS=8000 PORT=3001 npm run dev
 *
 * 切换行为（验降级/防注入）：
 *   curl http://127.0.0.1:3951/__mode?name=garbage     # 返回非 JSON 废话
 *   curl http://127.0.0.1:3951/__mode?name=empty       # 返回空内容
 *   curl http://127.0.0.1:3951/__mode?name=http500     # 返回 500
 *   curl http://127.0.0.1:3951/__mode?name=hang        # 一直不返回（验超时降级）
 *   curl http://127.0.0.1:3951/__mode?name=priced      # ops 里塞价格/金额（必须被丢弃）
 *   curl http://127.0.0.1:3951/__mode?name=fakeid      # ops 里塞清单外 productId（必须被丢弃）
 *   curl http://127.0.0.1:3951/__mode?name=nomatch     # ops 空 + items 空（等同「一个都没匹配上」）
 *   curl http://127.0.0.1:3951/__mode?name=ops         # 回到正常 ops 分支（默认）
 */
const http = require('http')
const fs = require('fs')

const PORT = Number(process.env.FAKE_MODEL_PORT || process.argv[2] || 3951)
const LOG = process.env.FAKE_MODEL_LOG || ''
let mode = 'ops'

// 客户口语 → 商品名（假模型自己扛口语别名；无 Key 时规则版匹配不到这类别名，属已知限制）
const ALIAS = [
  ['猪肉', '五花肉'], ['五花肉', '五花肉'],
  ['大白菜', '大白菜'], ['小白菜', '大白菜'],
  ['土豆', '土豆'], ['上海青', '上海青'],
  ['大姜', '大姜'], ['老姜', '大姜'], ['姜', '大姜'],
  ['小葱', '小葱'], ['葱', '小葱'],
].sort((a, b) => b[0].length - a[0].length)

const logLine = (obj) => {
  if (!LOG) return
  try { fs.appendFileSync(LOG, JSON.stringify(obj) + '\n') } catch (e) { /* 日志失败不影响服务 */ }
}

/** 从 system 提示词里解析商品清单（后端把它作为固定前缀放在 system）*/
function parseProducts(system) {
  const out = []
  for (const line of String(system || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([\d.]+)\s*元\s*$/)
    if (m) out.push({ id: Number(m[1]), name: m[2], unit: m[3], spec: m[4], price: Number(m[5]) })
  }
  return out
}

/** 从 user 消息里取出「客户这次说的话」与「当前草稿」*/
function parseUser(content) {
  const text = String(content || '')
  const marker = '客户这次说的话'
  const idx = text.indexOf(marker)
  let sentence = text
  let draft = { items: [], deliveryDate: '', remark: '' }
  if (idx >= 0) {
    sentence = text.slice(idx + marker.length).replace(/^[^\n]*\n/, '').trim()
    const head = text.slice(0, idx)
    const a = head.indexOf('{')
    const b = head.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try { draft = JSON.parse(head.slice(a, b + 1)) } catch (e) { /* 草稿解析失败当空草稿 */ }
    }
  }
  return { sentence, draft: draft || { items: [] } }
}

const resolveProduct = (products, sentence) => {
  const all = resolveAll(products, sentence)
  return all.length ? all[0].p : null
}

/** 一句话里提到的所有商品（各取自己后面那个数量），用于「一次说完整清单」的老用法 */
function resolveAll(products, sentence) {
  const out = []
  for (const [kw, target] of ALIAS) {
    const at = sentence.indexOf(kw)
    if (at < 0) continue
    const p = products.find((x) => x.name.includes(target))
    if (!p || out.some((o) => o.p.id === p.id)) continue
    // 短关键词落进已命中的长关键词里（如「大白菜」命中后「白菜」不再重复）→ 跳过
    if (out.some((o) => o.kw.includes(kw))) continue
    const after = sentence.slice(at + kw.length, at + kw.length + 12)
    const q = extractQty(after)
    out.push({ p, q, kw })
  }
  // 「再加5斤猪肉」这类数量在菜名**前面**的说法：整句只提了一个商品时，退回整句取数量
  if (out.length === 1 && !out[0].q) out[0].q = extractQty(sentence)
  return out
}

const extractQty = (sentence) => {
  const m = sentence.match(/(\d+(?:\.\d+)?|[零一二两三四五六七八九十百]+)\s*(斤|公斤|千克|颗|个|把|箱|枚|份|盒|条|包)/)
  if (!m) return null
  const cn = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  const qty = /^\d/.test(m[1]) ? Number(m[1]) : (cn[m[1]] ?? 1)
  return { qty, unit: m[2], qtyText: `${m[1]}${m[2]}` }
}

const extractDate = (sentence) => {
  if (/后天/.test(sentence)) return '后天'
  if (/明天|明日/.test(sentence)) return '明天'
  if (/今天|今日/.test(sentence)) return '今天'
  return ''
}

/** 核心分支：客户这句话 → ops（等价的老口径 items 一并给出，供老代码基线比对用）*/
function buildDecision(sentence, draft, products) {
  const draftItems = Array.isArray(draft.items) ? draft.items : []
  const date = extractDate(sentence)
  const remark = /嫩一点/.test(sentence) ? '要嫩一点的' : ''
  const qty = extractQty(sentence)
  const p = resolveProduct(products, sentence)
  const mk = (op, product, q) => ({ op, productId: product.id, qty: q.qty, unit: q.unit, qtyText: q.qtyText })

  // ① 全清
  if (/都不要了|全都不要|全不要|都取消|清空/.test(sentence)) {
    return { ops: [{ op: 'clear' }], items: [], deliveryDate: date, remark }
  }
  // ② 指代 + 多个商品 → 反问（草稿不动）
  const hasRef = /那个|它|这俩|这些/.test(sentence)
  if (hasRef && !p && draftItems.length >= 2) {
    const names = draftItems.map((x) => x.name || `#${x.productId}`)
    return {
      needClarify: `你说的是${names.slice(0, 2).join('还是')}？`,
      ops: [], items: [], deliveryDate: '', remark: '',
    }
  }
  // ③ 移除
  if (p && /不要了|去掉|删掉|删除|取消|不加了/.test(sentence)) {
    return { ops: [{ op: 'remove', productId: p.id }], items: [], deliveryDate: date, remark }
  }
  // ④ 设置（改成 / 换成 / 只要）
  if (p && /改成|换成|只要|改为/.test(sentence) && qty) {
    return { ops: [mk('set', p, qty)], items: [{ productId: p.id, qty: qty.qty, unit: qty.unit, qtyText: qty.qtyText }], deliveryDate: date, remark }
  }
  // ⑤ 相加（再加 / 再来 / 直接说菜名）；一句话提到多个商品时一次给多条 add
  const hits = resolveAll(products, sentence).filter((x) => x.q)
  if (hits.length) {
    return {
      ops: hits.map((x) => mk('add', x.p, x.q)),
      items: hits.map((x) => ({ productId: x.p.id, qty: x.q.qty, unit: x.q.unit, qtyText: x.q.qtyText })),
      deliveryDate: date, remark,
    }
  }
  // ⑥ 只提时间 → 只有日期变
  if (date) return { ops: [], items: [], deliveryDate: date, remark }
  // ⑦ 什么都没对上
  return { ops: [], items: [], deliveryDate: '', remark, unmatched: [sentence] }
}

function buildContent(sentence, draft, products) {
  if (mode === 'nomatch') return JSON.stringify({ ops: [], items: [], deliveryDate: '', remark: '', unmatched: [sentence] })
  const d = buildDecision(sentence, draft, products)
  const payload = { ...d }
  if (mode === 'priced') {
    // 模型越权塞价格/金额 —— 后端必须丢掉（红线：模型碰不到钱）
    payload.ops = [{ op: 'add', productId: (products[0] || {}).id, qty: 3, unit: '斤', qtyText: '3斤', price: 0.01, amount: 0.03 }]
    payload.items = [{ productId: (products[0] || {}).id, qty: 3, unit: '斤', qtyText: '3斤', price: 0.01, amount: 0.03 }]
    payload.total = 0.03
    payload.price = 0.01
  }
  if (mode === 'fakeid') {
    const real = resolveProduct(products, sentence) || products[0] || { id: 0 }
    payload.ops = [
      { op: 'add', productId: 999999, qty: 7, unit: '斤', qtyText: '7斤' }, // 清单外 → 必须丢
      { op: 'add', productId: real.id, qty: 2, unit: '斤', qtyText: '2斤' },
    ]
    payload.items = payload.ops.map((o) => ({ productId: o.productId, qty: o.qty, unit: o.unit, qtyText: o.qtyText }))
  }
  return JSON.stringify(payload)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')

  if (url.pathname === '/__mode') {
    const name = url.searchParams.get('name')
    if (name) mode = name
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ mode }))
  }

  if (!url.pathname.endsWith('/chat/completions')) {
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
    const { sentence, draft } = parseUser(user)

    const reply = (status, content) => {
      logLine({ at: new Date().toISOString(), mode, sentence, draftItems: (draft.items || []).length, products: products.length, status, content })
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
    }

    if (mode === 'http500') return reply(500, '')
    if (mode === 'garbage') return reply(200, '亲，我不太明白您要买什么呢～')
    if (mode === 'empty') return reply(200, '')
    if (mode === 'hang') return setTimeout(() => reply(200, '{}'), 30000) // 拖过后端超时阈值，验超时降级

    reply(200, buildContent(sentence, draft, products))
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[假模型服务] 已启动 http://127.0.0.1:${PORT}/v1  mode=${mode}  log=${LOG || '(不落盘)'}`)
})
