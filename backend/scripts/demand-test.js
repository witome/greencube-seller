/**
 * 采购需求登记 + 到货主动通知 · 后端验收脚本（本地真跑）
 *
 * 前置（两条都要）：
 *   ① 假微信服务已起：      node scripts/wx-fake-server.js
 *   ② 后端已起且指向假微信： WX_API_BASE=http://127.0.0.1:3952 \
 *                          WX_SUBSCRIBE_TMPL_DEMAND=FAKE_TMPL_DEMAND_0001 PORT=3001 node dist/main
 *
 * 跑法：cd backend && node scripts/demand-test.js
 *
 * ⚠️ 本脚本只打**本地** 3001，绝不碰生产。
 * ⚠️ 会写本地开发库（与仓库既有惯例一致：测试数据保留不清理）。
 */

const fs = require('fs')
const path = require('path')

const BACKEND = path.join(__dirname, '..')

// 手工加载 .env（Prisma Client 不保证自动加载），已存在的环境变量优先
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
}

const { PrismaClient } = require(path.join(BACKEND, 'node_modules', '@prisma', 'client'))
const prisma = new PrismaClient()

const BASE = 'http://127.0.0.1:3001/api/v1'
const FAKE_WX = process.env.WX_API_BASE || 'http://127.0.0.1:3952'
const TMPL = process.env.WX_SUBSCRIBE_TMPL_DEMAND || 'FAKE_TMPL_DEMAND_0001'

let passed = 0
let failed = 0
const ok = (name, cond, extra) => {
  if (cond) {
    passed++
    console.log('  ✅ ' + name)
  } else {
    failed++
    console.log('  ❌ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''))
  }
}
const section = (t) => console.log('\n【' + t + '】')

async function call(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

const ts = Date.now()
// ⚠️ 造隔离用的菜名时，时间戳必须放**中间**（如 `聚合${ts}菜`）：
//    归一化规则会剥掉首尾的数字/单位，放尾部会让 `聚合菜${ts}` 变成 `聚合菜`，
//    跨次运行就撞在一起、断言全乱。
let buyerSeq = 0

/** 建一个采购方账号（dev mock 登录：code → openid = dev_<code>） */
async function newBuyer(tag) {
  const code = `${tag}_${ts}_${++buyerSeq}`
  const login = await call('POST', '/auth/wx-login', { code })
  const token = login.data.token

  // ⚠️ 手机号必须**真唯一**，而且必须是 11 位（校验规则拒绝 12 位）。
  //    踩过的坑：最初用「13 + ts后8位 + 序号取模10」→ 第 11 个账号序号回到 1，**撞号**；
  //    register 一失败 purchaserId 就是 undefined，后面 report/subscribe 全部静默失效，
  //    表现成「这个人怎么没进通知名单」这种极难查的假红。
  //    所以：随机 6 位 + 3 位序号（11 位），并在撞号时重试。
  let reg = null
  for (let attempt = 0; attempt < 4; attempt++) {
    const phone = '13' + String(Math.floor(Math.random() * 1000000)).padStart(6, '0') + String(buyerSeq).padStart(3, '0')
    reg = await call(
      'POST',
      '/buyer/register',
      {
        shopName: `需求验收${buyerSeq}号店`,
        contact: `验收${buyerSeq}`,
        phone,
        address: `验收路${buyerSeq}号`,
      },
      token,
    )
    if (reg.code === 0 && reg.data && reg.data.purchaserId) return { code, token, userId: login.data.userId, purchaserId: reg.data.purchaserId, openid: `dev_${code}` }
    if (reg.code !== 3009 && reg.code !== 1001) break // 不是「手机号占用/格式」就不必重试
  }
  throw new Error(`造采购方失败（code=${code}）：` + JSON.stringify(reg))
}

const report = (token, items) => call('POST', '/buyer/demand/report', { items, source: 1 }, token)

/** 造一个在售商品（用于验「{price} 取商品表真实单价」+ 让 amount 字段有值可填） */
async function ensureProduct(at, name, salePrice, unit = '斤') {
  const created = await call(
    'POST',
    '/admin/goods',
    {
      name,
      categoryId: 1,
      weighType: 1,
      unit,
      supplierId: 1,
      supplyPrice: Math.max(0.01, Number((salePrice - 1).toFixed(2))),
      dailySupply: 100,
      markupRate: 0.3,
      salePrice,
    },
    at,
  )
  if (created.code !== 0) throw new Error('造商品失败：' + JSON.stringify(created))
  const p = await prisma.product.findFirst({ where: { name }, orderBy: { id: 'desc' } })
  return { id: Number(p.id), price: Number(p.salePrice), unit: p.unit, status: p.status }
}

async function main() {
  console.log('='.repeat(64))
  console.log('采购需求登记 + 到货主动通知 · 后端验收')
  console.log('='.repeat(64))

  // ── 前置检查 ──
  const admin = await call('POST', '/auth/wx-login', { code: 'admin' })
  if (admin.code !== 0) {
    console.error('后端不在线（127.0.0.1:3001），先起后端再跑')
    process.exit(1)
  }
  const at = admin.data.token
  let fakeWxUp = false
  try {
    const r = await fetch(`${FAKE_WX}/__log`)
    fakeWxUp = (await r.json()).tokenCalls !== undefined
  } catch (e) {
    fakeWxUp = false
  }
  console.log(`\n后端在线 ✅ ｜ 假微信 ${FAKE_WX} ${fakeWxUp ? '在线 ✅' : '离线 ❌（通知分支会失败）'}`)
  if (fakeWxUp) await fetch(`${FAKE_WX}/__reset`)

  // ══════════════════════════════════════════
  section('① 归一化用例（唯一实现：dist/modules/demand/demand.util.js）')
  // ⚠️ 直接 require **编译产物**，证明跑的是后端真正用的那份实现，不是脚本里另抄一份
  const util = require(path.join(BACKEND, 'dist', 'modules', 'demand', 'demand.util.js'))
  const cases = [
    ['荷兰豆', '荷兰豆'],
    ['荷 兰 豆', '荷兰豆'],
    ['两斤荷兰豆', '荷兰豆'],
    ['荷兰豆50斤', '荷兰豆'],
    ['LaLa豆', 'lala豆'],
    ['ＬａＬａ豆', 'lala豆'],
    ['白 菜 5 斤', '白菜'],
    ['土豆块', '土豆块'], // 反例：形态词「块」不是计量单位，**故意不剥**
  ]
  let nameOk = 0
  for (const [raw, expect] of cases) {
    const got = util.normalizeDemandKey(raw)
    console.log(`     "${raw}" → "${got}"（期望 "${expect}"）`)
    if (got === expect) nameOk++
  }
  ok(`归一化 ${nameOk}/${cases.length} 条命中预期`, nameOk === cases.length)

  // ══════════════════════════════════════════
  section('② 聚合计数（3 个不同客户各 1 次 → 3 人 3 次；同一客户 2 次 → 1 人 2 次）')
  const aggDish = `聚合${ts}菜`
  const buyers = [await newBuyer('agg1'), await newBuyer('agg2'), await newBuyer('agg3')]
  for (let i = 0; i < 3; i++) {
    const r = await report(buyers[i].token, [{ rawText: aggDish, qtyText: '1斤', unit: '斤', qty: 1 }])
    if (i === 2) console.log('     最后一次上报返回：' + JSON.stringify(r.data.demands[0]))
  }
  const aggDemand = (await call('GET', `/admin/demand?keyword=${encodeURIComponent(aggDish)}`, null, at)).data.list[0]
  ok(
    `3 个不同客户各报 1 次 → 汇总 ${aggDemand.purchaserCount} 人 / ${aggDemand.demandCount} 次（期望 3 人 3 次）`,
    aggDemand.purchaserCount === 3 && aggDemand.demandCount === 3,
    aggDemand,
  )

  const repDish = `重复${ts}菜`
  // 同一客户报 2 次：**改口说要 5 斤**是新的需求，不该被 5 分钟幂等吃掉
  await report(buyers[0].token, [{ rawText: repDish, qtyText: '2斤', unit: '斤', qty: 2 }])
  const r2 = await report(buyers[0].token, [{ rawText: repDish, qtyText: '5斤', unit: '斤', qty: 5 }])
  const repDemand = r2.data.demands[0]
  console.log('     第二次上报返回：' + JSON.stringify(repDemand))
  ok(
    `同一客户报 2 次 → 汇总 ${repDemand.purchaserCount} 人 / ${repDemand.demandCount} 次（期望 1 人 2 次）`,
    repDemand.purchaserCount === 1 && repDemand.demandCount === 2,
    repDemand,
  )

  // ══════════════════════════════════════════
  section('③ 幂等（同一人同 key 同样的话 5 分钟内重复上报 → 明细只 +1）')
  const idemDish = `幂等${ts}菜`
  const i1 = await report(buyers[0].token, [{ rawText: idemDish, qtyText: '3斤', unit: '斤', qty: 3 }])
  const i2 = await report(buyers[0].token, [{ rawText: idemDish, qtyText: '3斤', unit: '斤', qty: 3 }])
  console.log('     第 1 次：' + JSON.stringify(i1.data))
  console.log('     第 2 次：' + JSON.stringify(i2.data))
  const idemDemand = (await call('GET', `/admin/demand?keyword=${encodeURIComponent(idemDish)}`, null, at)).data.list[0]
  ok(
    `重复上报被挡住（recorded=0, duplicated=1），汇总仍是 ${idemDemand.demandCount} 次`,
    i1.data.recorded === 1 && i2.data.recorded === 0 && i2.data.duplicated === 1 && idemDemand.demandCount === 1,
    { i1: i1.data, i2: i2.data, demand: idemDemand },
  )

  // ══════════════════════════════════════════
  section('④ 下架商品（status=0）→ 明细 kind=1「已有商品·已下架」且带上 productId')
  const offName = `下架${ts}测试菜`
  const created = await call(
    'POST',
    '/admin/goods',
    {
      name: offName,
      categoryId: 1,
      weighType: 1,
      unit: '斤',
      supplierId: 1,
      supplyPrice: 3,
      dailySupply: 100,
      markupRate: 0.3,
    },
    at,
  )
  const offProductId = created.data && (created.data.id || created.data.productId)
  await call('PUT', `/admin/goods/${offProductId}/status`, { status: 0 }, at)
  console.log(`     造一个已下架商品：#${offProductId} ${offName}`)
  const offRep = await report(buyers[1].token, [{ rawText: offName, qtyText: '2斤', unit: '斤', qty: 2 }])
  const offDemandId = offRep.data.demands[0].id
  const offDetail = (await call('GET', `/admin/demand/${offDemandId}`, null, at)).data
  console.log('     明细：' + JSON.stringify(offDetail.items[0]))
  ok(
    `明细 kind=1 且 demand.productId=#${offProductId}`,
    offDetail.items[0].kind === 1 &&
      offDetail.items[0].kindText === '已有商品·已下架' &&
      offDetail.demand.productId === offProductId,
    { item: offDetail.items[0], productId: offDetail.demand.productId },
  )

  // ══════════════════════════════════════════
  section('⑤ 合并（两条合并后计数相加、明细归并、源行消失）')
  const mergeA = `合并${ts}源`
  const mergeB = `合并${ts}目标`
  const aRep = await report(buyers[0].token, [{ rawText: mergeA }])
  await report(buyers[1].token, [{ rawText: mergeA }])
  const bRep = await report(buyers[2].token, [{ rawText: mergeB }])
  const aId = aRep.data.demands[0].id
  const bId = bRep.data.demands[0].id
  const beforeA = (await call('GET', `/admin/demand/${aId}`, null, at)).data
  const beforeB = (await call('GET', `/admin/demand/${bId}`, null, at)).data
  console.log(`     合并前：源 ${beforeA.demand.purchaserCount}人/${beforeA.demand.demandCount}次 ｜ 目标 ${beforeB.demand.purchaserCount}人/${beforeB.demand.demandCount}次`)
  const merged = await call('POST', `/admin/demand/${aId}/merge`, { targetId: bId }, at)
  console.log('     合并结果：' + JSON.stringify(merged.data))
  const afterB = (await call('GET', `/admin/demand/${bId}`, null, at)).data
  const srcGone = await call('GET', `/admin/demand/${aId}`, null, at)
  ok(
    `计数相加（${afterB.demand.purchaserCount}人/${afterB.demand.demandCount}次）`,
    afterB.demand.purchaserCount === beforeA.demand.purchaserCount + beforeB.demand.purchaserCount &&
      afterB.demand.demandCount === beforeA.demand.demandCount + beforeB.demand.demandCount,
    afterB.demand,
  )
  ok(
    `明细归并（${beforeA.items.length}+${beforeB.items.length} → ${afterB.items.length} 条）`,
    afterB.items.length === beforeA.items.length + beforeB.items.length,
    { got: afterB.items.length },
  )
  ok('源行消失（查它返回 4001）', srcGone.code === 4001, srcGone)

  // ══════════════════════════════════════════
  section('⑥ 导出 CSV（表头 + 行数 + 中文不乱码，用 node 读回来断言）')
  const csvRes = await fetch(`${BASE}/admin/demand/export`, { headers: { Authorization: 'Bearer ' + at } })
  const csvBuf = Buffer.from(await csvRes.arrayBuffer())
  const outDir = path.join(BACKEND, '..', '自测证据', `采购需求-20260925`)
  fs.mkdirSync(outDir, { recursive: true })
  // 用「导出接口原样字节」落盘，再读回来 —— 这样断言的就是接口真实产物
  fs.writeFileSync(path.join(outDir, 'export-raw.csv'), csvBuf)
  const back = fs.readFileSync(path.join(outDir, 'export-raw.csv'))
  const text = back.toString('utf8')
  const lines = text.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l.length)
  const expectHeader = '菜名,几人在要,共几次,首次,最近,状态,备注'
  const totalDemands = (await call('GET', '/admin/demand?page=1&pageSize=1', null, at)).data.total
  console.log(`     HTTP=${csvRes.status} content-type=${csvRes.headers.get('content-type')} 字节=${back.length}`)
  console.log(`     BOM=[${back[0]},${back[1]},${back[2]}]（期望 239,187,191 = EF BB BF）`)
  console.log('     表头：' + lines[0])
  console.log(`     行数：表头 1 + 数据 ${lines.length - 1}（库里共 ${totalDemands} 条需求）`)
  console.log('     第 1 行数据：' + lines[1])
  ok('Content-Type 是 text/csv', /text\/csv/.test(csvRes.headers.get('content-type') || ''))
  ok('带 UTF-8 BOM（Excel 直接双击不乱码）', back[0] === 0xef && back[1] === 0xbb && back[2] === 0xbf)
  ok('表头正确', lines[0] === expectHeader, lines[0])
  ok('数据行数 = 需求总数', lines.length - 1 === totalDemands, { rows: lines.length - 1, totalDemands })
  ok(
    '中文不乱码（含本次造的聚合菜名）',
    text.includes(aggDish),
    text.slice(0, 200),
  )

  // ══════════════════════════════════════════
  section('⑦ 通知名单划分 + 四条发送分支 + 落库')
  if (!fakeWxUp) {
    console.log('  ⏭  假微信服务没起来，跳过（这不是「通过」）')
  } else {
    const notifyDish = `通知${ts}菜`
    // 5 个客户，各自构造一种「能不能发」的情形
    const P1 = await newBuyer('ok1') // 已授权且有额度 → 订阅消息成功
    const P2 = await newBuyer('noauth2') // 没授权，但在 48 小时内 → 客服消息成功
    const P3 = await newBuyer('quotaout3') // 有额度但明细已超 48 小时 → 发一次订阅后额度耗尽 → 下次发不出去
    const P4 = await newBuyer('wxexpired4') // 没授权 + openid 含 expired → 客服消息 45015
    const P5 = await newBuyer('wxrefuse5') // 已授权但微信侧拒收 → 订阅消息 43101

    for (const p of [P1, P2, P3, P4, P5]) await report(p.token, [{ rawText: notifyDish }])
    // 到货通知模板的「商品单价」字段要求有真实单价 → 先把它上架（正是口径 6 的顺序：先上架再通知）
    const notifyProd = await ensureProduct(at, notifyDish, 3.5)
    console.log(`     已为该菜上架商品：#${notifyProd.id} 单价 ${notifyProd.price} 元/${notifyProd.unit}（status=${notifyProd.status}）`)
    const notifyDemand = (await call('GET', `/admin/demand?keyword=${encodeURIComponent(notifyDish)}`, null, at)).data.list[0]

    // 授权额度：真实走 /buyer/demand/subscribe（这条接口本身也在验）
    const s1 = await call('POST', '/buyer/demand/subscribe', { templateId: TMPL, accepted: [TMPL] }, P1.token)
    const s3 = await call('POST', '/buyer/demand/subscribe', { templateId: TMPL, accepted: [TMPL] }, P3.token)
    const sR = await call('POST', '/buyer/demand/subscribe', { templateId: TMPL, accepted: [], rejected: [TMPL] }, P2.token)
    const s5 = await call('POST', '/buyer/demand/subscribe', { templateId: TMPL, accepted: [TMPL] }, P5.token)
    console.log(`     授权上报：P1→${JSON.stringify(s1.data)} ｜ P2(拒绝)→${JSON.stringify(sR.data)} ｜ P3→${JSON.stringify(s3.data)} ｜ P5→${JSON.stringify(s5.data)}`)
    ok('授权额度落库（同意 +1，拒绝不加）', s1.data.quota === 1 && sR.data.quota === 0 && s3.data.quota === 1 && s5.data.quota === 1, {
      p1: s1.data,
      p2: sR.data,
      p3: s3.data,
      p5: s5.data,
    })

    // ⚠️ 让 P3 的明细「超 48 小时」——直接改 created_at 造 fixture（只为验收，不是业务逻辑）
    // ⚠️ 必须用 UTC_TIMESTAMP(3)：MySQL 会话时区是 SYSTEM(+08)，而 Prisma 按 UTC 解释 DATETIME。
    //    用 NOW(3) 造出来的「49 小时前」会被 Prisma 读成「41 小时前」，断言就假红（实测踩到过）。
    await prisma.$executeRaw`
      UPDATE purchase_demand_item SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 49 HOUR)
       WHERE demand_id = ${BigInt(notifyDemand.id)} AND purchaser_id = ${BigInt(P3.purchaserId)}
    `
    const backdated = await prisma.purchaseDemandItem.findFirst({
      where: { demandId: BigInt(notifyDemand.id), purchaserId: BigInt(P3.purchaserId) },
      select: { createdAt: true },
    })
    const hoursAgo = (Date.now() - backdated.createdAt.getTime()) / 3600000
    console.log(`     把 P3(${P3.purchaserId}) 的明细回拨到 ${backdated.createdAt.toISOString()}（${hoursAgo.toFixed(1)} 小时前）`)
    ok(`P3 明细确实超过 48 小时窗口（${hoursAgo.toFixed(1)}h）`, hoursAgo > 48, { hoursAgo })

    const pv = (await call('GET', `/admin/demand/${notifyDemand.id}/notify-preview`, null, at)).data
    console.log(
      '     预览名单：' +
        JSON.stringify({
          可发订阅消息: pv.canSubscribe.map((x) => x.purchaserId),
          '48小时内可发客服消息': pv.canCustom.map((x) => x.purchaserId),
          发不了: pv.cannot.map((x) => [x.purchaserId, x.reason]),
        }),
    )
    console.log(`     客户 ID：P1=${P1.purchaserId} P2=${P2.purchaserId} P3=${P3.purchaserId} P4=${P4.purchaserId} P5=${P5.purchaserId}`)
    ok('已授权且额度>0 → 归入「可发订阅消息」', pv.canSubscribe.some((x) => x.purchaserId === P1.purchaserId))
    ok('未授权但 48 小时内 → 归入「可发客服消息」', pv.canCustom.some((x) => x.purchaserId === P2.purchaserId))
    ok(
      '有订阅额度时优先走订阅消息（即使已超 48 小时）',
      pv.canSubscribe.some((x) => x.purchaserId === P3.purchaserId),
      pv.canSubscribe,
    )

    // ── 第 1 轮实发 ──
    const n1 = await call('POST', `/admin/demand/${notifyDemand.id}/notify`, null, at)
    console.log('     第 1 轮实发：' + JSON.stringify(n1.data))
    ok(
      `第 1 轮：成功 3（P1 订阅 / P2 客服 / P3 订阅）、失败 2（P4 45015 / P5 43101）—— 实得 ${n1.data.notified}/${n1.data.failed}`,
      n1.data.notified === 3 && n1.data.failed === 2,
      n1.data,
    )

    // ── 第 2 轮实发（验「额度耗尽」）──
    // 第 1 轮后 P1/P3 的额度都变成 0：
    //   P1 还在 48 小时内 → 降级客服消息（成功）
    //   P3 已超 48 小时   → 归「发不出去」，等其主动来访
    //   P5 的 43101 是「发失败」，微信侧不消耗额度 → 第 2 轮仍在订阅通道上失败（额度不白扣）
    const n2 = await call('POST', `/admin/demand/${notifyDemand.id}/notify`, null, at)
    console.log('     第 2 轮实发：' + JSON.stringify(n2.data))
    ok(
      `第 2 轮：额度耗尽 → P1 降级客服消息成功，共成功 2、失败 3 —— 实得 ${n2.data.notified}/${n2.data.failed}`,
      n2.data.notified === 2 && n2.data.failed === 3,
      n2.data,
    )
    ok(
      '额度耗尽且超 48 小时的那个人 → 明确「发不出去」带原因（不假装发过）',
      n2.data.failures.some((f) => f.purchaserId === P3.purchaserId && /48 小时/.test(f.reason)),
      n2.data.failures,
    )

    // 第 2 轮之后再取一次预览：此时 P3 应落进「发不了」
    const pv2 = (await call('GET', `/admin/demand/${notifyDemand.id}/notify-preview`, null, at)).data
    console.log(
      '     第 2 轮后预览：' +
        JSON.stringify({
          可发订阅消息: pv2.canSubscribe.map((x) => x.purchaserId),
          '48小时内可发客服消息': pv2.canCustom.map((x) => x.purchaserId),
          发不了: pv2.cannot.map((x) => [x.purchaserId, x.reason]),
        }),
    )
    ok(
      '额度耗尽 + 超 48 小时 → 归入「发不了」并带原因',
      pv2.cannot.some((x) => x.purchaserId === P3.purchaserId && /48 小时/.test(x.reason)),
      pv2.cannot,
    )

    // ── demand_notify_log 落库内容 ──
    const logs = await prisma.demandNotifyLog.findMany({
      where: { demandId: BigInt(notifyDemand.id) },
      orderBy: { id: 'asc' },
    })
    const brief = logs.map((l) => ({
      purchaserId: Number(l.purchaserId),
      channel: l.channel,
      result: l.result,
      errCode: l.errCode,
      errMsg: l.errMsg,
    }))
    console.log('     demand_notify_log：')
    brief.forEach((l) => console.log('       ' + JSON.stringify(l)))

    ok(
      '订阅消息成功落库（channel=1, result=ok）',
      logs.some((l) => l.channel === 1 && l.result === 'ok' && Number(l.purchaserId) === P1.purchaserId),
    )
    ok(
      '客服消息成功落库（channel=2, result=ok）',
      logs.some((l) => l.channel === 2 && l.result === 'ok' && Number(l.purchaserId) === P2.purchaserId),
    )
    ok(
      '45015 超时窗口落库（channel=2, result=fail, errCode=45015）',
      logs.some((l) => l.channel === 2 && l.result === 'fail' && l.errCode === 45015 && Number(l.purchaserId) === P4.purchaserId),
    )
    ok(
      '订阅被拒落库（channel=1, result=fail, errCode=43101）',
      logs.some((l) => l.channel === 1 && l.result === 'fail' && l.errCode === 43101 && Number(l.purchaserId) === P5.purchaserId),
    )
    ok(
      '发不出去的人也落库（channel=3，带原因），且**没有** ok 行',
      logs.some(
        (l) =>
          l.channel === 3 &&
          l.result === 'fail' &&
          Number(l.purchaserId) === P3.purchaserId &&
          /48 小时/.test(l.errMsg || ''),
      ) && !logs.some((l) => l.channel === 3 && l.result === 'ok'),
    )

    // ── 额度扣减 ──
    const q1 = await prisma.demandSubscribeQuota.findUnique({
      where: { purchaserId_templateId: { purchaserId: BigInt(P1.purchaserId), templateId: TMPL } },
    })
    const q3 = await prisma.demandSubscribeQuota.findUnique({
      where: { purchaserId_templateId: { purchaserId: BigInt(P3.purchaserId), templateId: TMPL } },
    })
    console.log(`     剩余额度：P1=${q1 && q1.quota} ｜ P3=${q3 && q3.quota}（发一次扣一次）`)
    ok('成功的订阅消息把额度扣到 0', q1.quota === 0 && q3.quota === 0, { p1: q1.quota, p3: q3.quota })

    // ── access_token 缓存 ──
    const fakeLog = await (await fetch(`${FAKE_WX}/__log`)).json()
    const sendCount = fakeLog.calls.filter((c) => c.kind !== 'token').length
    console.log(`     假微信侧：/cgi-bin/token 被调用 ${fakeLog.tokenCalls} 次，发送请求 ${sendCount} 次`)
    // 断言写成「至多 1 次」而不是「恰好 1 次」：后端若已热跑过，token 还在内存缓存里，
    // 本轮就是 0 次（缓存更稳的表现）。缓存失效的话这里会等于发送次数（十几次）。
    ok(
      `access_token 没有每次现取（${sendCount} 次发送只取了 ${fakeLog.tokenCalls} 次 token）`,
      fakeLog.tokenCalls <= 1,
      { tokenCalls: fakeLog.tokenCalls, sendCount },
    )
    const subCall = fakeLog.calls.find((c) => c.kind === 'subscribe')
    console.log('     订阅消息请求体（假微信侧收到）：' + JSON.stringify(subCall && subCall.data))
    ok(
      '订阅消息字段按模板配置拼装 + 跳转页＝我的需求',
      !!subCall && subCall.templateId === TMPL && subCall.page === 'pages/buyer/my-demands' && !!subCall.data,
      subCall,
    )

    // ── 买家侧「我的需求」是否看到「已通知」 ──
    const mine = (await call('GET', '/buyer/demand/mine', null, P1.token)).data
    const mineRow = mine.list.find((x) => x.id === notifyDemand.id)
    console.log(`     P1「我的需求」：${JSON.stringify(mineRow)}`)
    ok('客户侧能看到这条需求且 notified=true', !!mineRow && mineRow.notified === true, mineRow)

    // ══════════════════════════════════════════
    section('⑧ 模板字段自动探测 + 自动映射（真实模板：预约商品到货通知 / 一次性订阅）')
    // 真实模板 id 由环境变量给；假微信按 FAKE_TMPL_ID 返回同一套模板
    const realTmplId = TMPL
    const fmtDish = `格式${ts}菜`
    const fmtProd = await ensureProduct(at, fmtDish, 5.8)
    console.log(`     造菜「${fmtDish}」并上架：#${fmtProd.id} 单价 ${fmtProd.price} 元/${fmtProd.unit}（status=${fmtProd.status}）`)

    // P6 字段错(47003) / P7 拒收(43101) / P8 正常
    const P6 = await newBuyer('wxbadfield6')
    const P7 = await newBuyer('wxrefuse7')
    const P8 = await newBuyer('ok8')
    for (const p of [P6, P7, P8]) {
      // ⚠️ 故意夹带 price / salePrice —— DTO 白名单必须把它们剥掉（口径 A2：单价系统回填，不许手填/模型填）
      await report(p.token, [{ rawText: fmtDish, price: 999, salePrice: 999, unitPrice: 999 }])
    }
    const fmtDemand = (await call('GET', `/admin/demand?keyword=${encodeURIComponent(fmtDish)}`, null, at)).data.list[0]
    await call('PUT', `/admin/demand/${fmtDemand.id}`, { note: '这是一条特别特别长的温馨提示文案用来验证截断逻辑' }, at)
    for (const p of [P6, P7, P8]) {
      await call('POST', '/buyer/demand/subscribe', { templateId: realTmplId, accepted: [realTmplId] }, p.token)
    }

    // ⑧-① 自动探测：字段名从微信模板里问出来，再按**中文名**映射到变量
    const pv8 = (await call('GET', `/admin/demand/${fmtDemand.id}/notify-preview`, null, at)).data
    console.log('     模板信息：' + JSON.stringify(pv8.template))
    console.log('     单价信息：' + JSON.stringify(pv8.price))
    ok(
      `字段映射来源=自动探测（discovered），关键词=${(pv8.template.keywords || []).map((k) => `${k.name}=${k.key}(${k.type})`).join(' / ')}`,
      pv8.template.source === 'discovered',
      pv8.template,
    )
    ok(
      '自动按中文名映射：商品名称→{name}、商品单价→{price}、温馨提示→{note}',
      pv8.template.fields.thing1 === '{name}' &&
        pv8.template.fields.amount2 === '{price}' &&
        pv8.template.fields.thing3 === '{note}',
      pv8.template.fields,
    )
    ok(
      `单价来自商品表真实单价（${JSON.stringify(pv8.price)}）`,
      pv8.price.ready === true &&
        Math.abs(pv8.price.value - fmtProd.price) < 0.01 &&
        pv8.price.source === (fmtProd.status === 1 ? 'matched_on_sale' : 'matched_off_shelf'),
      pv8.price,
    )

    // ⑧-② 实发一人（P8 正常）→ 看假微信收到的 data 是否按类型格式化
    await fetch(`${FAKE_WX}/__reset`)
    const n8 = await call('POST', `/admin/demand/${fmtDemand.id}/notify`, null, at)
    console.log('     实发结果：' + JSON.stringify(n8.data))
    const fake8 = await (await fetch(`${FAKE_WX}/__log`)).json()
    const sent8 = fake8.calls.find((c) => c.kind === 'subscribe' && String(c.touser).includes('ok8'))
    console.log('     假微信收到的订阅消息 data：' + JSON.stringify(sent8 && sent8.data))
    ok('确实发出去了 1 条（P8）', !!sent8 && sent8.templateId === realTmplId && sent8.page === 'pages/buyer/my-demands', sent8)
    ok(
      `thing 字段=菜名（≤20 字）：${sent8 && sent8.data && sent8.data.thing1 && sent8.data.thing1.value}`,
      !!sent8 && sent8.data.thing1.value === fmtDish,
    )
    ok(
      `amount 字段=带币种符号的两位小数：${sent8 && sent8.data && sent8.data.amount2 && sent8.data.amount2.value}（商品表真实单价 ${fmtProd.price}，客户端夹带的 999 被丢弃）`,
      !!sent8 && sent8.data.amount2.value === `¥${fmtProd.price.toFixed(2)}` && !/999/.test(sent8.data.amount2.value),
      sent8 && sent8.data.amount2,
    )
    ok(
      `thing 温馨提示超 20 字被就地截断（实发 ${sent8 && sent8.data.thing3.value.length} 字）`,
      !!sent8 && Array.from(sent8.data.thing3.value).length === 20,
      sent8 && sent8.data.thing3,
    )

    // ⑧-③ 47003（字段名不匹配）→ 人话提示 + 落库 + **不扣额度**（卡 A4）
    const f8 = (n8.data.failures || []).find((x) => x.purchaserId === P6.purchaserId)
    console.log('     47003 的失败原因：' + JSON.stringify(f8 && f8.reason))
    ok(
      '47003 给出**人话**提示（指向字段映射配置，而不是甩一个错误码）',
      !!f8 && /47003/.test(f8.reason) && /WX_SUBSCRIBE_TMPL_DEMAND_FIELDS/.test(f8.reason),
      f8,
    )
    const log8 = await prisma.demandNotifyLog.findMany({ where: { demandId: BigInt(fmtDemand.id) } })
    const l47003 = log8.find((l) => l.errCode === 47003)
    const l43101 = log8.find((l) => l.errCode === 43101)
    console.log('     demand_notify_log（47003）：' + JSON.stringify(l47003 && { channel: l47003.channel, result: l47003.result, errCode: l47003.errCode, errMsg: l47003.errMsg }))
    console.log('     demand_notify_log（43101）：' + JSON.stringify(l43101 && { channel: l43101.channel, result: l43101.result, errCode: l43101.errCode, errMsg: l43101.errMsg }))
    ok('47003 逐人落 demand_notify_log（channel=1 fail + 人话 errMsg）', !!l47003 && l47003.channel === 1 && l47003.result === 'fail' && /47003/.test(l47003.errMsg || ''))
    ok('43101 逐人落 demand_notify_log（channel=1 fail + 人话 errMsg）', !!l43101 && l43101.channel === 1 && l43101.result === 'fail' && /43101/.test(l43101.errMsg || ''))

    // ══════════════════════════════════════════
    section('⑨ 订阅额度只在微信返回 ok 时 -1（失败不扣额度）—— 卡 A5')
    const q = async (purchaserId) => {
      if (purchaserId == null) return undefined
      const row = await prisma.demandSubscribeQuota.findUnique({
        where: { purchaserId_templateId: { purchaserId: BigInt(purchaserId), templateId: realTmplId } },
      })
      return row?.quota
    }
    const quotas = {
      成功_P8: await q(P8.purchaserId),
      字段错47003_P6: await q(P6.purchaserId),
      拒收43101_P7: await q(P7.purchaserId),
      拒收43101_P5: await q(P5.purchaserId),
      超窗口45015_P4: await q(P4.purchaserId),
    }
    console.log('     各人剩余额度：' + JSON.stringify(quotas))
    ok('订阅消息成功 → 额度 -1（1 → 0）', quotas['成功_P8'] === 0, quotas)
    ok('47003 字段错 → **不扣**额度（仍为 1）', quotas['字段错47003_P6'] === 1, quotas)
    ok('43101 用户拒收 → **不扣**额度（仍为 1，两轮都失败也没被扣走）', quotas['拒收43101_P7'] === 1 && quotas['拒收43101_P5'] === 1, quotas)
    ok('从未授权过的人（只走过客服消息 45015）→ 连额度行都不该有', quotas['超窗口45015_P4'] === undefined, quotas)

    // 通用不变量：额度 = 用户同意次数 − 成功发出的订阅消息条数（永不为负）
    // 授权一次的人：P1/P3/P5(⑦) + P6/P7/P8(⑧)；P2 是「拒绝」不产生额度行，P4 从没授权
    const acceptedIds = [P1, P3, P5, P6, P7, P8].map((p) => Number(p.purchaserId))
    const allQuota = await prisma.demandSubscribeQuota.findMany({ where: { templateId: realTmplId } })
    const okCount = new Map()
    const allLogs = log8.concat(await prisma.demandNotifyLog.findMany({ where: { demandId: BigInt(notifyDemand.id) } }))
    for (const l of allLogs) {
      if (l.channel === 1 && l.result === 'ok') okCount.set(Number(l.purchaserId), (okCount.get(Number(l.purchaserId)) || 0) + 1)
    }
    let invariant = true
    const invDetail = []
    for (const row of allQuota) {
      const pid = Number(row.purchaserId)
      if (!acceptedIds.includes(pid)) continue
      const expect = Math.max(1 - (okCount.get(pid) || 0), 0)
      if (row.quota !== expect) invariant = false
      invDetail.push({ purchaserId: pid, quota: row.quota, expect })
    }
    console.log('     额度不变量（同意次数 − 成功条数）：' + JSON.stringify(invDetail))
    ok(
      `额度恒等于「同意次数 − 成功发出的订阅消息条数」，且不为负（核了 ${invDetail.length} 人）`,
      invariant && invDetail.length === acceptedIds.length,
      invDetail,
    )

    section('⑩ 纯函数：按字段类型格式化（wx.format，官方限制表）')
    const fmtLib = require(path.join(BACKEND, 'dist', 'modules', 'wx', 'wx.format.js'))
    const longThing = '两个字的菜名加上很多很多很多很多很多多余的描述'
    const longPhrase = '一二三四五六七八九十一二三四五六七八九十'
    const fmtCases = [
      ['thing', '荷兰豆', '荷兰豆'],
      ['thing', longThing, longThing.slice(0, 20)],
      ['thing1', '荷兰豆', '荷兰豆'],
      ['amount', 5.8, '¥5.80'],
      ['amount', '¥5.8', '¥5.80'],
      ['amount', '1200元', '¥1200.00'],
      ['number', 5.8, '5.80'],
      ['number2', '12', '12.00'],
      ['phrase', longPhrase, longPhrase.slice(0, 16)],
      ['character_string', 'A'.repeat(70), 'A'.repeat(64)],
      ['letter', 'abc123', 'abc'],
      ['time', '09:30:00', '09:30:00'],
      ['unknown_type', 'X', 'X'],
    ]
    let fmtOk = 0
    for (const [type, raw, expect] of fmtCases) {
      const r = fmtLib.formatFieldValue(type, raw)
      const got = r.ok ? r.value : `(FAIL ${r.reason})`
      const hit = r.ok && got === expect
      if (hit) fmtOk++
      console.log(`     ${hit ? '✅' : '❌'} ${type}(${JSON.stringify(raw)}) → ${JSON.stringify(got)}（期望 ${JSON.stringify(expect)}）`)
    }
    ok(`格式化 ${fmtOk}/${fmtCases.length} 条命中官方限制`, fmtOk === fmtCases.length)

    // 非法值必须**报错而不是硬发**（否则就是让微信回 47003）
    const badNumber = fmtLib.formatFieldValue('number', '五斤')
    console.log(`     number("五斤") → ${JSON.stringify(badNumber)}`)
    ok('number 收到非数字 → ok=false 且给人话原因（不会硬发出去）', badNumber.ok === false && /不是合法数字/.test(badNumber.reason || ''), badNumber)
    const nullThing = fmtLib.formatFieldValue('thing', null)
    console.log(`     thing(null) → ${JSON.stringify(nullThing)}`)
    ok('thing 没值 → ok=false（由业务层决定兜底文案/拒绝）', nullThing.ok === false, nullThing)
    const nullTime = fmtLib.formatFieldValue('time', null, new Date(2026, 8, 25, 9, 30))
    console.log(`     time(null) → ${JSON.stringify(nullTime)}`)
    ok('time 没值 → 自动填当前时刻（HH:mm）', nullTime.ok === true && nullTime.value === '09:30', nullTime)

    // 模板 content 解析（官方 gettemplate 不返回 kid 数组，字段名只能从 {{xxx.DATA}} 里取）
    const kw = fmtLib.parseTemplateContent('商品名称:{{thing1.DATA}}\n商品单价:{{amount2.DATA}}\n温馨提示:{{thing3.DATA}}')
    console.log('     parseTemplateContent → ' + JSON.stringify(kw))
    ok(
      '能从模板 content 里解析出 字段名/类型/序号/中文名',
      kw.length === 3 &&
        kw[0].key === 'thing1' && kw[0].type === 'thing' && kw[0].kid === 1 &&
        kw[1].key === 'amount2' && kw[1].type === 'amount' &&
        kw[2].name === '温馨提示',
      kw,
    )
  }

  // ── 收尾 ──
  console.log('\n' + '='.repeat(64))
  console.log(`验收结果：✅ 通过 ${passed} 项 / ❌ 失败 ${failed} 项`)
  console.log('='.repeat(64))
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n脚本异常：', e)
  try {
    await prisma.$disconnect()
  } catch (x) {
    /* ignore */
  }
  process.exit(1)
})
