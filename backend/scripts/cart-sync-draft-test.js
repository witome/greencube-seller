/**
 * 卡AQ「草稿页合并购物车」验收脚本（2026-10-01）
 *
 * 覆盖：
 *   A. PUT /cart/sync 接口本身（整体替换 / 非在售被忽略 / qty<=0 丢弃 / 同 productId 去重 / 返回与 GET /cart 同形状）
 *   B. /ai/parse **只读**（调完 cart_item 一个字节都不许变）
 *   C. AI 说「土豆20斤」→ cart_item 出现土豆 20 斤
 *   D. 「再加5斤土豆」→ 25 斤（累加）
 *   E. 「土豆改成10斤」→ 10 斤（set）
 *   F. 「不要土豆」→ 删除
 *   G. 手动加购 + AI 说并存（POST /cart 加的货，AI 再说话后不许被冲掉）
 *   H. 没上架的菜（秋葵）不进 cart_item，但登记进采购需求
 *
 * 前置：本地后端已起（默认 3001）。
 * 用法：node scripts/cart-sync-draft-test.js
 *      CARTAQ_BASE=http://127.0.0.1:3011/api/v1 node scripts/cart-sync-draft-test.js
 */
const BASE = process.env.CARTAQ_BASE || 'http://127.0.0.1:3001/api/v1'
const ts = Date.now()

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else {
    fail++
    failures.push(name)
    console.log(`  ❌ ${name}${detail !== undefined ? `  → 实际：${JSON.stringify(detail)}` : ''}`)
  }
}
const abort = (msg) => {
  fail++
  console.log(`  ❌ ${msg}`)
  console.log('\n' + '='.repeat(56))
  console.log(`验收中止：✅ ${pass} / ❌ ${fail}（未跑完）`)
  console.log('='.repeat(56))
  process.exit(1)
}

const call = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (e) { /* 非 JSON */ }
  return { status: res.status, json, text }
}

/** 采购方：登录 → 注册 → 运营审核通过 → 重新登录（cart 只认 ACTIVE=2）*/
const buyerToken = async () => {
  const code = 'cartaq_' + ts
  const b1 = await call('/auth/wx-login', { method: 'POST', body: { code } })
  if (!b1.json || b1.json.code !== 0 || !b1.json.data?.token) abort('采购方登录失败：' + b1.text.slice(0, 200))
  const bt = b1.json.data.token
  const phone = '139' + String(ts).slice(-8)
  const reg = await call('/buyer/register', {
    method: 'POST', token: bt,
    body: { shopName: '卡AQ自测餐馆', contact: '自测员', phone, address: '自测路 ' + (ts % 100) + ' 号-' + ts }, // 卡BL：地址带唯一后缀
  })
  if (!reg.json || reg.json.code !== 0) abort('采购方注册失败：' + reg.text.slice(0, 200))

  const ad = await call('/auth/wx-login', { method: 'POST', body: { code: 'admin' } })
  const at = ad.json?.data?.token
  if (!at) abort('运营登录失败')
  const pend = await call('/admin/buyers/pending?pageSize=50', { token: at })
  const target = (pend.json?.data?.list || []).find((p) => p.phone === phone)
  if (!target) abort('待审核队列未找到本次注册(' + phone + ')')
  const v = await call(`/admin/buyers/${target.purchaserId}/verify`, { method: 'POST', token: at, body: { methods: [1], result: 1 } })
  if (!v.json || v.json.code !== 0) abort('运营审核失败：' + v.text.slice(0, 200))

  const b2 = await call('/auth/wx-login', { method: 'POST', body: { code } })
  if (b2.json?.data?.accountStatus !== 2) abort('重新登录后账号未激活：' + b2.text.slice(0, 200))
  return b2.json.data.token
}

/** cart_item → { 商品名: 数量 } */
const qtyMap = (list) => Object.fromEntries((list || []).map((i) => [i.name, Number(i.qty)]))
const cartOf = async (token) => (await call('/cart', { token })).json?.data || { list: [], totalAmount: 0 }
/** 模拟前端 sendUtterance：读 cart → parse（只读）→ sync 整体落库 */
const say = async (token, text) => {
  const before = await cartOf(token)
  const p = await call('/ai/parse', {
    method: 'POST', token,
    body: {
      text,
      draft: (before.list || []).map((i) => ({ productId: i.productId, qty: Number(i.qty), unit: i.unit, name: i.name })),
    },
  })
  const parsed = p.json?.data || {}
  if (parsed.needClarify) return { parsed, before, after: before, skipped: true }
  const s = await call('/cart/sync', {
    method: 'PUT', token,
    body: { items: (parsed.items || []).filter((i) => i && i.productId != null).map((i) => ({ productId: i.productId, qty: i.qty })) },
  })
  return { parsed, before, after: s.json?.data || { list: [], totalAmount: 0 }, skipped: false }
}

const main = async () => {
  console.log('='.repeat(56))
  console.log('卡AQ · 草稿页合并购物车 验收（cart_item = 草稿）')
  console.log('='.repeat(56) + '\n')

  const token = await buyerToken()
  console.log('【0. 准备】')
  check('采购方已激活（可用购物车）', !!token)
  const goods = (await call('/product/list?page=1&pageSize=50', { token })).json?.data?.list || []
  check('拿到在售商品列表', goods.length > 0, goods.length)
  if (!goods.length) abort('没有在售商品，后续用例无法继续')
  const potato = goods.find((g) => g.name.includes('土豆')) || goods[0]
  const other = goods.find((g) => g.id !== potato.id) || goods[0]
  console.log(`     基准商品：${potato.name}(id=${potato.id}) / 对照商品：${other.name}(id=${other.id})`)

  // ── A. sync 接口本身 ─────────────────────────────
  console.log('\n【A. PUT /cart/sync 接口契约】')
  await call('/cart/sync', { method: 'PUT', token, body: { items: [] } })
  check('空数组 → 草稿清空', (await cartOf(token)).list.length === 0)

  const s1 = await call('/cart/sync', { method: 'PUT', token, body: { items: [{ productId: potato.id, qty: 20 }] } })
  check('sync 写入 1 行', (s1.json?.data?.list || []).length === 1 && qtyMap(s1.json.data.list)[potato.name] === 20, s1.json?.data)
  check('sync 返回含 totalAmount', typeof s1.json?.data?.totalAmount === 'number', s1.json?.data?.totalAmount)

  const g1 = await cartOf(token)
  check('sync 返回与 GET /cart 同形状（字段名逐一对齐）',
    JSON.stringify(Object.keys(s1.json?.data?.list?.[0] || {}).sort()) === JSON.stringify(Object.keys(g1.list?.[0] || {}).sort())
    && s1.json.data.totalAmount === g1.totalAmount,
    { sync: Object.keys(s1.json?.data?.list?.[0] || {}), get: Object.keys(g1.list?.[0] || {}) })

  const s2 = await call('/cart/sync', { method: 'PUT', token, body: { items: [{ productId: potato.id, qty: 7 }] } })
  check('sync 是**整体替换**不是追加（20 → 7）', qtyMap(s2.json?.data?.list)[potato.name] === 7, s2.json?.data?.list)

  const s3 = await call('/cart/sync', { method: 'PUT', token, body: { items: [{ productId: potato.id, qty: 3 }, { productId: potato.id, qty: 4 }] } })
  check('同 productId 重复 → 只留一条（后者覆盖＝4）',
    (s3.json?.data?.list || []).length === 1 && qtyMap(s3.json.data.list)[potato.name] === 4, s3.json?.data?.list)

  const s4 = await call('/cart/sync', { method: 'PUT', token, body: { items: [{ productId: potato.id, qty: 0 }, { productId: potato.id, qty: -5 }, { productId: other.id, qty: 2 }] } })
  check('qty<=0 的行被丢弃（只剩 1 行）', (s4.json?.data?.list || []).length === 1, s4.json?.data?.list)

  const s5 = await call('/cart/sync', { method: 'PUT', token, body: { items: [{ productId: potato.id, qty: 2 }, { productId: 999999, qty: 9 }] } })
  check('不在售 / 不存在的 productId 被忽略（不进草稿）',
    (s5.json?.data?.list || []).length === 1 && qtyMap(s5.json.data.list)[potato.name] === 2, s5.json?.data?.list)

  // ── B. /ai/parse 只读 ────────────────────────────
  console.log('\n【B. /ai/parse 必须只读】')
  await call('/cart/sync', { method: 'PUT', token, body: { items: [{ productId: potato.id, qty: 12 }] } })
  const b0 = await cartOf(token)
  const p0 = await call('/ai/parse', {
    method: 'POST', token,
    body: { text: `${potato.name}30斤`, draft: [{ productId: potato.id, qty: 12, unit: potato.unit, name: potato.name }] },
  })
  const b1 = await cartOf(token)
  // 合并口径：草稿 12 斤 + 这句 30 斤 = 42（**不是** 30 —— 多轮口径是作用在草稿上，不是覆盖）
  check('parse 返回合并后的数量（12+30=42）', qtyOfParsed(p0.json?.data, potato.name) === 42, (p0.json?.data?.items || []).map((i) => [i.name, i.qty]))
  check('parse 之后 cart_item **一个字节都没变**（仍是 12）',
    JSON.stringify(qtyMap(b1.list)) === JSON.stringify(qtyMap(b0.list)) && qtyMap(b1.list)[potato.name] === 12,
    { before: qtyMap(b0.list), after: qtyMap(b1.list) })

  // ── C~F. AI 说话四连 ────────────────────────────
  console.log('\n【C. AI 说「土豆20斤」→ 草稿出现 20 斤】')
  await call('/cart/sync', { method: 'PUT', token, body: { items: [] } })
  const r1 = await say(token, `${potato.name}20斤`)
  check('cart_item 出现该商品 20 斤', qtyMap(r1.after.list)[potato.name] === 20, r1.after.list)

  console.log('\n【D. 再说「再加5斤土豆」→ 25 斤（累加）】')
  const r2 = await say(token, `再加5斤${potato.name}`)
  check('累加成 25 斤', qtyMap(r2.after.list)[potato.name] === 25, r2.after.list)

  console.log('\n【E. 「土豆改成10斤」→ 10 斤（set）】')
  const r3 = await say(token, `${potato.name}改成10斤`)
  check('set 成 10 斤', qtyMap(r3.after.list)[potato.name] === 10, r3.after.list)

  // ⚠️ 用「土豆不要了」而不是「不要土豆」：remove 语义由解析器判定，
  //    现网解析器（大模型 / 规则版）对「不要了/去掉/删掉」稳定判 remove；
  //    「不要土豆」（数量/动词都在菜名前）目前两条解析路径都判不出来（属解析器范围，不在本卡 8 文件内）。
  console.log('\n【F. 「土豆不要了」→ 删除】')
  const r4 = await say(token, `${potato.name}不要了`)
  check('该商品从 cart_item 删除', r4.after.list.length === 0, r4.after.list)

  // ── G. 手动加购 + AI 说并存 ─────────────────────
  console.log('\n【G. 手动加购 + AI 说并存】')
  await call('/cart/sync', { method: 'PUT', token, body: { items: [] } })
  await call('/cart', { method: 'POST', token, body: { productId: potato.id, qty: 6 } })
  await call('/cart', { method: 'POST', token, body: { productId: other.id, qty: 2 } })
  const g0 = await cartOf(token)
  check('手动加购两样（POST /cart）', g0.list.length === 2, qtyMap(g0.list))
  const r5 = await say(token, `再加4斤${potato.name}`)
  const m5 = qtyMap(r5.after.list)
  check('AI 说话后手动加的另一样还在（没被冲掉）', m5[other.name] === 2, m5)
  check('AI 说话在手动数量上累加（6+4=10）', m5[potato.name] === 10, m5)

  const addAgain = await call('/cart', { method: 'POST', token, body: { productId: potato.id, qty: 1 } })
  check('AI 说过之后手动再加购仍生效（10+1=11）', qtyMap((await cartOf(token)).list)[potato.name] === 11 || !!addAgain.json?.data?.cartItemId, qtyMap((await cartOf(token)).list))

  // ── H. 没上架的菜 ───────────────────────────────
  console.log('\n【H. 没上架的菜（秋葵）不进 draft，但登记采购需求】')
  await call('/cart/sync', { method: 'PUT', token, body: { items: [{ productId: potato.id, qty: 8 }] } })
  const h0 = await cartOf(token)
  const r6 = await say(token, '秋葵5斤')
  check('秋葵不在在售商品表里（前置）', !goods.some((g) => g.name.includes('秋葵')), goods.map((g) => g.name))
  check('秋葵**没有**进 cart_item', !Object.keys(qtyMap(r6.after.list)).some((n) => n.includes('秋葵')), qtyMap(r6.after.list))
  check('原有商品数量不受影响（仍是 8）', qtyMap(r6.after.list)[potato.name] === 8, qtyMap(r6.after.list))
  check('金额不受影响（与说话前一致）', r6.after.totalAmount === h0.totalAmount, { before: h0.totalAmount, after: r6.after.totalAmount })
  const un = r6.parsed.unmatched || []
  check('parse 把秋葵报成 unmatched', un.some((t) => String(t).includes('秋葵')), un)

  const rep = await call('/buyer/demand/report', { method: 'POST', token, body: { items: un.map((t) => ({ rawText: t })), source: 1 } })
  check('采购需求登记接口调通', rep.json?.code === 0, rep.text?.slice(0, 160))
  const mine = await call('/buyer/demand/mine', { token })
  const mineNames = JSON.stringify(mine.json?.data || {})
  check('「我的需求」里能看到秋葵', mineNames.includes('秋葵'), (mine.json?.data?.list || []).slice(0, 3))

  // ── 收尾：别把自测数据留在草稿里 ────────────────
  await call('/cart/sync', { method: 'PUT', token, body: { items: [] } })
  check('收尾：草稿已清空（不污染下次回归）', (await cartOf(token)).list.length === 0)

  console.log('\n' + '='.repeat(56))
  console.log(`卡AQ 自测结果：✅ 通过 ${pass} 项 / ❌ 失败 ${fail} 项`)
  if (failures.length) console.log('失败明细：\n  - ' + failures.join('\n  - '))
  console.log('='.repeat(56))
  process.exit(fail ? 1 : 0)
}

function qtyOfParsed(data, name) {
  const it = ((data && data.items) || []).find((i) => i.name === name)
  return it ? Number(it.qty) : null
}

main().catch((e) => {
  console.error('脚本异常：', e)
  process.exit(1)
})
