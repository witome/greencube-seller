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
  const phone = '13' + String(ts).slice(-8) + (buyerSeq % 10)
  const reg = await call(
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
  return {
    code,
    token,
    userId: login.data.userId,
    purchaserId: reg.data && reg.data.purchaserId,
    openid: `dev_${code}`,
  }
}

const report = (token, items) => call('POST', '/buyer/demand/report', { items, source: 1 }, token)

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
