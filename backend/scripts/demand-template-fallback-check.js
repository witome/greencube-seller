/**
 * 卡A1 取证（降级分支）：模板字段**探测不到**时，必须降级到默认映射并落日志，
 * **不能因此发不出去**。
 *
 * ⚠️ 前置（两条都要，缺一结果无意义）：
 *   ① 假微信服务已切到对应模式：
 *        FAKE_TMPL_ID=<模板id> node scripts/wx-fake-server.js
 *        curl "http://127.0.0.1:3952/__mode?name=nompl"      # 或 tmpl500
 *   ② 后端**刚重启**（模板列表缓存 1h、字段映射缓存 10min 都在进程内存里，
 *      旧进程会把上次探测到的成功结果继续用，测不出降级）：
 *        WX_API_BASE=http://127.0.0.1:3952 WX_SUBSCRIBE_TMPL_DEMAND=<模板id> PORT=3001 node dist/main
 *
 * 跑法：cd backend && node scripts/demand-template-fallback-check.js nompl|tmpl500
 */
const fs = require('fs')
const path = require('path')

const BACKEND = path.join(__dirname, '..')
const ROOT = path.join(BACKEND, '..')
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
  /* ignore */
}
const { PrismaClient } = require(path.join(BACKEND, 'node_modules', '@prisma', 'client'))
const prisma = new PrismaClient()

const BASE = 'http://127.0.0.1:3001/api/v1'
const FAKE_WX = process.env.WX_API_BASE || 'http://127.0.0.1:3952'
const TMPL = process.env.WX_SUBSCRIBE_TMPL_DEMAND || 'FAKE_TMPL_DEMAND_0001'
const MODE = process.argv[2] || 'nompl'

let pass = 0
let fail = 0
const ok = (n, c, e) => {
  if (c) {
    pass++
    console.log('  ✅ ' + n)
  } else {
    fail++
    console.log('  ❌ ' + n + (e !== undefined ? ' → ' + JSON.stringify(e) : ''))
  }
}

async function call(m, p, b, t) {
  const res = await fetch(BASE + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  })
  return res.json()
}

;(async () => {
  console.log('='.repeat(64))
  console.log(`卡A1 取证 · 模板字段探测失败时的降级（模式=${MODE}）`)
  console.log('='.repeat(64))

  const fakeMode = await (await fetch(`${FAKE_WX}/__log`)).json()
  console.log(`假微信当前模式 = ${fakeMode.mode}（期望 ${MODE}）`)
  if (fakeMode.mode !== MODE) {
    console.log(`  ⚠️ 假微信模式不是 ${MODE}，先 curl "${FAKE_WX}/__mode?name=${MODE}"`)
    process.exit(1)
  }

  const at = (await call('POST', '/auth/wx-login', { code: 'admin' })).data.token
  const ts = Date.now()
  const dish = `降级${ts}菜`

  // 上架该菜（让 amount 字段有真实单价，避免被「没单价」那条业务规则提前拦住）
  const created = await call(
    'POST',
    '/admin/goods',
    { name: dish, categoryId: 1, weighType: 1, unit: '斤', supplierId: 1, supplyPrice: 2.5, dailySupply: 100, markupRate: 0.3, salePrice: 3.5 },
    at,
  )
  if (created.code !== 0) throw new Error('造商品失败：' + JSON.stringify(created))

  const l1 = await call('POST', '/auth/wx-login', { code: `fallback_${ts}` })
  await call('POST', '/buyer/register', {
    shopName: `降级店${ts}`, contact: 'd', phone: '13' + String(ts).slice(-8) + '2', address: 'd',
  }, l1.data.token)
  const bt = (await call('POST', '/auth/wx-login', { code: `fallback_${ts}` })).data.token
  await call('POST', '/buyer/demand/report', { items: [{ rawText: dish }], source: 1 }, bt)
  const demand = (await call('GET', `/admin/demand?keyword=${encodeURIComponent(dish)}`, null, at)).data.list[0]
  await call('POST', '/buyer/demand/subscribe', { templateId: TMPL, accepted: [TMPL] }, bt)

  const pv = (await call('GET', `/admin/demand/${demand.id}/notify-preview`, null, at)).data
  console.log('\n  notify-preview.template = ' + JSON.stringify(pv.template))

  ok(
    `探测失败 → 字段映射降级为默认兜底（source=default）` + (pv.template.source === 'discovered' ? '【后端不是刚重启的，字段映射缓存还在 → 本次结果无效】' : ''),
    pv.template.source === 'default',
    pv.template,
  )
  ok('降级原因随预览一起返回（运营能看到为什么用的是兜底映射）', !!pv.template.warn && pv.template.warn.length > 0, pv.template.warn)
  ok('降级时 keywords 为空（确实没拿到模板字段）', Array.isArray(pv.template.keywords) && pv.template.keywords.length === 0, pv.template.keywords)
  ok(
    '降级后仍按默认映射给出字段（不是空对象）',
    Object.keys(pv.template.fields || {}).length > 0,
    pv.template.fields,
  )

  // 关键：探测失败**不能**导致发不出去
  // ⚠️ /__reset 会把假微信模式复位成 normal，所以重置后再把模式设回来
  await fetch(`${FAKE_WX}/__reset`)
  await fetch(`${FAKE_WX}/__mode?name=${MODE}`)
  const n = await call('POST', `/admin/demand/${demand.id}/notify`, null, at)
  console.log('\n  实发结果 = ' + JSON.stringify(n.data))
  const fakeLog = await (await fetch(`${FAKE_WX}/__log`)).json()
  const sent = fakeLog.calls.find((c) => c.kind === 'subscribe')
  console.log('  假微信收到的 data = ' + JSON.stringify(sent && sent.data))
  ok('探测失败**不阻塞发送**：通知照常发出去（实得 notified=' + (n.data && n.data.notified) + '）', n.data && n.data.notified === 1, n.data)
  ok('发出的是默认映射的字段名', !!sent && !!sent.data && Object.keys(sent.data).length === Object.keys(pv.template.fields).length, { sent: sent && sent.data, fields: pv.template.fields })

  console.log('\n' + '='.repeat(64))
  console.log(`降级取证（${MODE}）：✅ 通过 ${pass} 项 / ❌ 失败 ${fail} 项`)
  console.log('='.repeat(64))
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
})().catch(async (e) => {
  console.error('脚本异常：', e)
  try {
    await prisma.$disconnect()
  } catch (x) {
    /* ignore */
  }
  process.exit(1)
})
