// 卡B 取证：setSupplierCategories 事务 + 前置校验（越权/失权脏数据防线）
// 运行：node 自测证据/_tx-guard-proof-20260919.js   （需后端已启动在 3001 端口）
//
// 设计（对着旧实现的反例取证）：
//   旧实现：deleteMany(清空授权) → createMany(重建)。
//   若 createMany 失败（重复 id 撞 @@unique → P2002，无效 id 撞 FK → P2003），
//   抛裸 5001 且 deleteMany 已提交 —— 供应商授权被清空 = 失权脏数据。
//   新实现：① 重复/无效 id 先查再写，落业务码 1001；② 先清后建同事务，要么都成要么都不成。
//
// 断言：
//   A 重复 id  → code=1001，且授权快照与调用前完全一致（未被清空）
//   B 无效 id  → code=1001，且授权快照与调用前完全一致（未被清空）
//   C 收尾：还原授权快照，调用成功且快照一致
const BASE = 'http://localhost:3001/api/v1'

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

let passed = 0, failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name) }
  else { failed++; console.log('  ❌ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')) }
}

const key = (ids) => JSON.stringify([...ids].map(Number).sort((a, b) => a - b))

async function main() {
  console.log('='.repeat(60))
  console.log('卡B 取证 · setSupplierCategories 事务 + 前置校验')
  console.log('='.repeat(60) + '\n')

  const admin = await call('POST', '/auth/wx-login', { code: 'admin' })
  const at = admin.data.token
  if (!at) { console.log('  ❌ 运营登录失败'); process.exit(1) }

  // 找一个「当前已有授权」的供应商，最能暴露「被清空」的反例
  const suppliers = (await call('GET', '/admin/suppliers', null, at)).data || []
  let targetId = null, snapshot = null
  for (const s of suppliers) {
    const cats = await call('GET', `/admin/suppliers/${s.supplierId}/categories`, null, at)
    if ((cats.data || []).length > 0) {
      targetId = s.supplierId
      snapshot = (cats.data || []).map((c) => Number(c.categoryId))
      break
    }
  }
  if (targetId === null) {
    // 兜底：无任何已授权供应商时，取第一个分类自建一份授权
    const cats = (await call('GET', '/admin/categories', null, at)).data || []
    const first = cats[0]?.id
    const s0 = suppliers[0]?.supplierId
    if (!first || !s0) { console.log('  ❌ 无可用供应商/分类，无法取证'); process.exit(1) }
    targetId = s0
    snapshot = [first]
    await call('PUT', `/admin/suppliers/${targetId}/categories`, { categoryIds: snapshot }, at)
  }
  console.log(`  取证对象：供应商 #${targetId}，调用前授权快照 = ${key(snapshot)}\n`)

  // ── A. 重复 id ──
  console.log('【A. 分类 id 重复（旧实现：createMany 撞 @@unique → 裸 5001 + 授权已被清空）】')
  const dupIds = [snapshot[0], snapshot[0]]
  const dup = await call('PUT', `/admin/suppliers/${targetId}/categories`, { categoryIds: dupIds }, at)
  check('A1 返回业务码 1001（不是裸 5001）', dup.code === 1001, dup)
  const afterA = (await call('GET', `/admin/suppliers/${targetId}/categories`, null, at)).data || []
  check('A2 授权未被清空（与调用前快照一致）', key(afterA.map((c) => c.categoryId)) === key(snapshot), {
    before: key(snapshot), after: key(afterA.map((c) => c.categoryId)),
  })
  console.log()

  // ── B. 无效分类 id ──
  console.log('【B. 分类 id 不存在（旧实现：createMany 撞 FK → 裸 5001 + 授权已被清空）】')
  const badIds = [999999]
  const bad = await call('PUT', `/admin/suppliers/${targetId}/categories`, { categoryIds: badIds }, at)
  check('B1 返回业务码 1001（不是裸 5001）', bad.code === 1001, bad)
  const afterB = (await call('GET', `/admin/suppliers/${targetId}/categories`, null, at)).data || []
  check('B2 授权未被清空（与调用前快照一致）', key(afterB.map((c) => c.categoryId)) === key(snapshot), {
    before: key(snapshot), after: key(afterB.map((c) => c.categoryId)),
  })
  console.log()

  // ── C. 收尾：还原快照 ──
  console.log('【C. 收尾还原（合法入参 happy path 不受影响）】')
  const restore = await call('PUT', `/admin/suppliers/${targetId}/categories`, { categoryIds: snapshot }, at)
  check('C1 合法入参设置成功', restore.code === 0, restore)
  const afterC = (await call('GET', `/admin/suppliers/${targetId}/categories`, null, at)).data || []
  check('C2 还原后与原始快照一致（现场无残留）', key(afterC.map((c) => c.categoryId)) === key(snapshot), {
    before: key(snapshot), after: key(afterC.map((c) => c.categoryId)),
  })

  console.log('\n' + '='.repeat(60))
  console.log(`取证结果：✅ 通过 ${passed} 项 / ❌ 失败 ${failed} 项`)
  console.log('='.repeat(60))
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
