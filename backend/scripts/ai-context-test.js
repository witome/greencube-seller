/**
 * AI 下单「多轮上下文」验收脚本（2026-09-24）
 *
 * 一个对话 = 一张草稿：每句话都作用在传进来的 draft 上，响应返回合并后的完整 items。
 * 本脚本逐轮打本地 /api/ai/parse 并断言，**贴原始输出**，供人工与 Hermes 复核。
 *
 * 前置：
 *   ① 本地假模型服务已起：node scripts/ai-fake-model.js   （默认 3951）
 *   ② 本地后端已起（AI_PARSE_BASE_URL 指向假模型）：
 *      AI_PARSE_MODE=llm AI_PARSE_BASE_URL=http://127.0.0.1:3951/v1 DASHSCOPE_API_KEY=fake-local \
 *        PORT=3001 node dist/main.js
 *
 * 用法（在 backend 目录）：
 *   node scripts/ai-context-test.js                     # ①-⑧ 多轮断言
 *   node scripts/ai-context-test.js --only-legacy       # ⑨ 不传 draft（老前端）→ 原始输出，用于改动前后比对
 *   node scripts/ai-context-test.js --degrade           # 降级路径（垃圾/500/超时/没匹配上）→ 按 add 合并
 *   node scripts/ai-context-test.js --inject            # 模型塞价格 / 编造 productId → 必须被丢弃
 *   AI_TEST_BASE=http://127.0.0.1:3011/api/v1 node scripts/ai-context-test.js
 */
const BASE = process.env.AI_TEST_BASE || 'http://127.0.0.1:3001/api/v1'
const FAKE = process.env.AI_FAKE_BASE || 'http://127.0.0.1:3951'

const ONLY_LEGACY = process.argv.includes('--only-legacy')
const DEGRADE = process.argv.includes('--degrade')
const INJECT = process.argv.includes('--inject')
const GUARD = process.argv.includes('--guard')

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail !== undefined ? `  → 实际：${JSON.stringify(detail)}` : ''}`) }
}

const call = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (e) { /* 非 JSON 原样返回 */ }
  return { status: res.status, json, text }
}

const login = async () => {
  const r = await call('/auth/wx-login', { method: 'POST', body: { code: 'admin' } })
  const token = r.json?.data?.token
  if (!token) throw new Error('登录失败：' + r.text.slice(0, 200))
  return token
}

const names = (items) => (items || []).map((i) => i.name)
const qtyMap = (items) => Object.fromEntries((items || []).map((i) => [i.name, i.qty]))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const changeTexts = (r) => (r.changes || []).map((c) => c.text)
const setMode = async (name) => {
  const r = await fetch(`${FAKE}/__mode?name=${name}`)
  const j = await r.json()
  console.log(`  [假模型] 模式 → ${j.mode}`)
}

/** 逐轮对话定义：draft 为上轮响应合并后的草稿（由 runner 维护）*/
const TURNS = [
  {
    id: '①', text: '猪肉5斤',
    items: { 五花肉: 5 }, date: '明天', parser: 'llm',
    changes: ['五花肉'],
    note: '【验收①】大辉原例第 1 句',
  },
  {
    id: '②', text: '再加5斤猪肉',
    items: { 五花肉: 10 }, date: '明天', parser: 'llm',
    changes: ['5斤', '10斤'],
    note: '【验收②】⭐ 大辉原例第 2 句：必须 10 斤（原来会被覆盖成 5 斤）',
  },
  {
    id: '③-1', text: '土豆5斤',
    items: { 五花肉: 10, 土豆: 5 }, parser: 'llm',
    note: '【前置】先让草稿里有土豆 5 斤，下一句的「改成」才有东西可改',
  },
  {
    id: '③-2', text: '土豆改成20斤',
    items: { 五花肉: 10, 土豆: 20 }, parser: 'llm',
    changes: ['土豆'],
    note: '【验收③】「改成」= set，结果必须是 20 斤（不是 5+20=25）',
  },
  {
    id: '④-1', text: '大白菜两颗',
    items: { 五花肉: 10, 土豆: 20, 大白菜: 4 }, parser: 'llm',
    note: '【前置】称重商品「两颗」按规格换算 2×约2斤/颗 = 4 斤（合并路径仍走同一换算口径）',
  },
  {
    id: '④-2', text: '大白菜不要了',
    items: { 五花肉: 10, 土豆: 20 }, parser: 'llm',
    changes: ['大白菜'],
    note: '【验收④】remove：移除大白菜，其余不动',
  },
  {
    id: '⑥', text: '明天早上送',
    items: { 五花肉: 10, 土豆: 20 }, date: '明天', parser: 'llm',
    noChange: true,
    note: '【验收⑥】只改日期、商品不动',
  },
  {
    id: '⑦', text: '那个不要了',
    items: { 五花肉: 10, 土豆: 20 }, parser: 'llm',
    clarify: '你说的是',
    noChange: true,
    note: '【验收⑦】多商品 + 指代 → 反问一句、草稿不动（不许猜）',
  },
  {
    id: '⑤', text: '都不要了',
    items: {}, parser: 'llm',
    note: '【验收⑤】clear：草稿清空',
  },
]

/** 沿用口径：新句子没提日期/备注 → 保持草稿原值 */
const KEEP_TURNS = [
  { id: '⑨', text: '土豆5斤，要嫩一点的，今天送到', items: { 土豆: 5 }, date: '今天', remark: '要嫩一点的' },
  { id: '⑩', text: '再加5斤土豆', items: { 土豆: 10 }, date: '今天', remark: '要嫩一点的', note: '没提日期/备注 → 沿用草稿原值' },
]

/** 老用法：不传 draft（模拟老前端），行为必须与改动前完全一致 */
const LEGACY_TURNS = [
  { id: '⑪', text: '土豆50斤，大白菜两颗' },
  { id: '⑫', text: '猪肉5斤' },
]

const draftOf = (resp) => (resp.items || []).map((i) => ({ productId: i.productId, qty: i.qty, unit: i.unit, name: i.name }))

async function runTurns(token, turns, draft, state) {
  for (const t of turns) {
    console.log(`\n──────── ${t.id} 「${t.text}」${t.note ? '  · ' + t.note : ''} ────────`)
    const payload = { text: t.text }
    if (!t.legacy) {
      payload.draft = draft
      payload.draftDeliveryDate = state.deliveryDate
      payload.draftRemark = state.remark
    }
    console.log('  请求体:', JSON.stringify(payload))
    const r = await call('/ai/parse', { method: 'POST', token, body: payload })
    console.log('  原始响应:', r.text)
    const d = r.json?.data
    if (r.json?.code !== 0) { check(`${t.id} 接口 code=0（无业务错）`, false, r.json); continue }
    check(`${t.id} 接口 code=0（无业务错）`, true)

    if (t.legacy) continue

    if (t.items) check(`${t.id} 合并后清单 = ${JSON.stringify(t.items)}`, same(qtyMap(d.items), t.items), qtyMap(d.items))
    if (t.date) check(`${t.id} 日期 = ${t.date}`, d.deliveryDateLabel === t.date, d.deliveryDateLabel)
    if (t.remark !== undefined) check(`${t.id} 备注 = ${t.remark}`, d.remark === t.remark, d.remark)
    if (t.parser) check(`${t.id} 解析器 = ${t.parser}`, d.parser === t.parser, d.parser)
    if (t.changes) {
      const texts = changeTexts(d).join(' | ')
      for (const kw of t.changes) check(`${t.id} changes 含「${kw}」`, texts.includes(kw), texts)
    }
    if (t.clarify) check(`${t.id} 返回 needClarify 反问`, typeof d.needClarify === 'string' && d.needClarify.includes(t.clarify), d.needClarify)
    if (t.noChange) check(`${t.id} changes 为空（草稿未动）`, (d.changes || []).length === 0, changeTexts(d))
    if (t.items === undefined) check(`${t.id} 未指定清单断言（跳过）`, true)

    // 更新本地草稿（模拟前端：整段对话一张草稿）
    draft.length = 0
    draft.push(...draftOf(d))
    state.deliveryDate = d.deliveryDate
    state.remark = d.remark
    console.log(`  → 草稿现为 ${JSON.stringify(draft.map((x) => `${x.name} ${x.qty}${x.unit}`))}  日期=${d.deliveryDateLabel}  备注=${d.remark}`)
  }
  return { draft, state }
}

async function main() {
  console.log(`# AI 下单多轮上下文验收  base=${BASE}  fake=${FAKE}`)
  console.log(`# 时间 ${new Date().toISOString()}`)

  // ── 护栏单测：直接打编译产物里的合并引擎（不经过 HTTP，省得为它造 20+ 个商品）──
  if (GUARD) {
    const path = require('path')
    const draftMod = require(path.join(__dirname, '..', 'dist', 'modules', 'ai', 'parser', 'draft.js'))
    const products = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1, name: `测试商品${i + 1}`, unit: '斤', specText: null, weighType: 1, salePrice: 1,
    }))
    console.log('\n===== 护栏单测（parser/draft.js 直调）=====')

    // ① 单张草稿 ≤ 20 项
    const draft20 = products.slice(0, 20).map((p) => ({ productId: p.id, qty: 1 }))
    let r = draftMod.applyOps(draft20, [{ op: 'add', productId: 21, qty: 2, unit: '斤' }], products)
    console.log('  第21项 add → items=' + r.items.length + ' changes=' + JSON.stringify(r.changes.map((c) => c.text)))
    check('≤20 项：第 21 个新商品被忽略（仍是 20 项）', r.items.length === 20, r.items.length)
    check('≤20 项：changes 里说明了原因', r.changes.length === 1 && /最多 20 项/.test(r.changes[0].text), r.changes)

    // ② 单个数量 ≤ 9999（截断 + 说明）
    r = draftMod.applyOps([{ productId: 1, qty: 5 }], [{ op: 'add', productId: 1, qty: 99999, unit: '斤' }], products)
    console.log('  99999斤 add → ' + JSON.stringify(r.changes[0]))
    check('≤9999：数量截断到 9999', r.items[0].qty === 9999, r.items[0].qty)
    check('≤9999：changes 里说明了截断', /9999/.test(r.changes[0].note || ''), r.changes[0].note)

    // ③ 清单外的 productId → 丢弃
    r = draftMod.applyOps([], [{ op: 'add', productId: 999999, qty: 3, unit: '斤' }], products)
    check('清单外 productId 被丢弃（草稿仍为空）', r.items.length === 0 && r.changes.length === 0, r)

    // ④ 空草稿 clear → 无事发生、不留噪声
    r = draftMod.applyOps([], [{ op: 'clear' }], products)
    check('空草稿 clear 不产生噪声 changes', r.changes.length === 0, r.changes)

    // ⑤ 数量相加（唯一合并口径）
    r = draftMod.applyOps([{ productId: 1, qty: 5 }], [{ op: 'add', productId: 1, qty: 5, unit: '斤' }], products)
    check('同商品 add 相加（5+5=10）', r.items[0].qty === 10, r.items[0].qty)
    check('变化文案 = 「测试商品1 5斤 → 10斤」', r.changes[0].text === '测试商品1 5斤 → 10斤', r.changes[0].text)
    return
  }

  const token = await login()
  console.log('登录成功，token 已获取')

  if (ONLY_LEGACY) {
    // ⑨ 老前端（不传 draft）：只打原始输出，供改动前后逐字比对
    console.log('\n===== 不传 draft（模拟老前端）=====')
    for (const t of LEGACY_TURNS) {
      const r = await call('/ai/parse', { method: 'POST', token, body: { text: t.text } })
      console.log(`LEGACY ${t.id} text=${t.text}`)
      console.log(`RAW ${JSON.stringify(r.json?.data)}`)
    }
    return
  }

  if (INJECT) {
    console.log('\n===== 模型塞价格 / 编造 productId → 必须被丢弃 =====')
    await setMode('priced')
    let r = await call('/ai/parse', { method: 'POST', token, body: { text: '大白菜3斤' } })
    console.log('  原始响应(priced):', r.text)
    let d = r.json?.data
    const it = (d?.items || [])[0]
    check('priced：返回清单仍是 1 项', (d?.items || []).length === 1, d?.items?.length)
    check('priced：单价被后端按 product 表回填（0.99），不是模型塞的 0.01', it?.price === 0.99, it?.price)
    check('priced：金额 = 数量×回填单价（3×0.99=2.97）', it?.amount === 2.97, it?.amount)
    check('priced：总价不含模型塞的 0.03', d?.total === 2.97, d?.total)
    check('priced：响应里没有模型塞的 price/total 顶层字段', d?.price === undefined && d?.amount === undefined, { price: d?.price, amount: d?.amount })

    await setMode('fakeid')
    r = await call('/ai/parse', { method: 'POST', token, body: { text: '土豆2斤' } })
    console.log('  原始响应(fakeid):', r.text)
    d = r.json?.data
    check('fakeid：编造的 productId=999999 被丢弃', !(d?.items || []).some((x) => x.productId === 999999), names(d?.items))
    check('fakeid：同批次合法商品仍生效（土豆 2斤）', qtyMap(d?.items).土豆 === 2, qtyMap(d?.items))
    await setMode('ops')

    // 数量上限（走真实 HTTP：模型报一个离谱数量）
    r = await call('/ai/parse', { method: 'POST', token, body: { text: '土豆99999斤', draft: [] } })
    console.log('  原始响应(数量上限):', r.text)
    d = r.json?.data
    check('数量上限：99999 斤被截断到 9999', d?.items?.[0]?.qty === 9999, d?.items?.[0]?.qty)
    check('数量上限：changes 里说明了截断', /9999/.test((d?.changes || [])[0]?.note || ''), (d?.changes || [])[0])
    return
  }

  if (DEGRADE) {
    console.log('\n===== 降级路径：没 Key / 超时 / 报错 / 垃圾 / 没匹配上 → 按 add 合并 =====')
    console.log('# 用「菜名 + 数量」的语序（规则版只认这个语序），断言重点：不返回业务错、parser 降级为 rule、已加商品一个不丢')
    const scenarios = [
      { mode: 'garbage', label: '模型返回垃圾（非 JSON）' },
      { mode: 'empty', label: '模型返回空内容' },
      { mode: 'http500', label: '模型接口 500' },
      { mode: 'hang', label: '模型不返回（超时 6s）' },
      { mode: 'nomatch', label: '模型一个商品都没匹配上' },
    ]
    const turns = [
      { text: '土豆5斤', expect: { 土豆: 5 } },
      { text: '再要土豆5斤', expect: { 土豆: 10 } },
      { text: '上海青10斤', expect: { 土豆: 10, 上海青: 10 } },
      { text: '再要上海青10斤', expect: { 土豆: 10, 上海青: 20 } },
    ]
    for (const s of scenarios) {
      console.log(`\n──── 降级场景：${s.label}（假模型 mode=${s.mode}）────`)
      await setMode(s.mode)
      const draft = []
      const state = { deliveryDate: '', remark: '' }
      for (const t of turns) {
        const payload = { text: t.text, draft: [...draft], draftDeliveryDate: state.deliveryDate, draftRemark: state.remark }
        const r = await call('/ai/parse', { method: 'POST', token, body: payload })
        console.log(`  请求 ${JSON.stringify(payload)}`)
        console.log(`  原始响应 ${r.text}`)
        const d = r.json?.data
        check(`${s.mode}｜「${t.text}」code=0 不返回业务错`, r.json?.code === 0, r.json)
        check(`${s.mode}｜「${t.text}」parser 降级为 rule`, d?.parser === 'rule', d?.parser)
        check(`${s.mode}｜「${t.text}」合并后清单 = ${JSON.stringify(t.expect)}`, same(qtyMap(d?.items), t.expect), qtyMap(d?.items))
        draft.length = 0
        draft.push(...draftOf(d || {}))
        state.deliveryDate = d?.deliveryDate
        state.remark = d?.remark
      }
      check(`${s.mode}｜已加商品一个没丢（2 项）`, draft.length === 2, draft.map((x) => x.name))
    }
    await setMode('ops')
    return
  }

  // 主链路 ①-⑧
  console.log('\n===== 多轮上下文（一个对话 = 一张草稿）=====')
  let draft = []
  let state = { deliveryDate: '', remark: '' }
  const out = await runTurns(token, TURNS, draft, state)
  draft = out.draft

  // 沿用口径 ⑨⑩
  console.log('\n===== 新句子没提日期/备注 → 沿用草稿原值 =====')
  draft = []
  state = { deliveryDate: '', remark: '' }
  await runTurns(token, KEEP_TURNS, draft, state) // 断言在轮内（⑩ 校验日期/备注沿用）

  // 老用法 ⑪⑫ 与「不传 draft」一致性由 --only-legacy 单独取证
  console.log('\n===== 老用法（一次说完整清单，不传 draft）=====')
  for (const t of LEGACY_TURNS) {
    const r = await call('/ai/parse', { method: 'POST', token, body: { text: t.text } })
    console.log(`  请求体: ${JSON.stringify({ text: t.text })}`)
    console.log(`  原始响应: ${r.text}`)
    const d = r.json?.data
    check(`${t.id} 「${t.text}」code=0`, r.json?.code === 0, r.json)
    check(`${t.id} 至少识别出 1 个商品`, (d?.items || []).length >= 1, names(d?.items))
    check(`${t.id} 未带 draft 时不返回 changes（老前端看到的字段与改动前一致）`, d?.changes === undefined, d?.changes)
    check(`${t.id} 未带 draft 时不返回 needClarify`, d?.needClarify === undefined, d?.needClarify)
  }
}

main()
  .then(() => {
    console.log(`\n===== 汇总：${pass} 通过 / ${fail} 失败 =====`)
    if (failures.length) console.log('失败项：\n- ' + failures.join('\n- '))
    process.exit(fail ? 1 : 0)
  })
  .catch((e) => { console.error('脚本异常：', e); process.exit(2) })
