/**
 * 「到货通知模板未配置」的降级验证（验收⑧）
 *
 * 场景：运营还没在公众平台申请到「到货通知」订阅消息模板，后端 .env 的
 *      `WX_SUBSCRIBE_TMPL_DEMAND` 是空的。此时**绝不许**写死/猜测模板 id，
 *      也不许报裸 500 —— 按钮要隐藏、接口要给人话提示。
 *
 * 前置：后端**不带** `WX_SUBSCRIBE_TMPL_DEMAND` 启动（即 .env 里也是空的）
 *      WX_API_BASE=http://127.0.0.1:3952 PORT=3001 node dist/main
 *
 * 跑法：cd backend && node scripts/demand-degrade-check.js
 */

const fs = require('fs')
const path = require('path')

const BACKEND = path.join(__dirname, '..')
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

const BASE = 'http://127.0.0.1:3001/api/v1'
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

async function call(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const status = res.status
  let json = null
  try {
    json = await res.json()
  } catch (e) {
    /* 非 JSON */
  }
  return { status, json }
}

async function main() {
  console.log('='.repeat(64))
  console.log('验收⑧ · 「到货通知模板未配置」的降级')
  console.log('='.repeat(64))

  const admin = await call('POST', '/auth/wx-login', { code: 'admin' })
  const at = admin.json.data.token
  const ts = Date.now()

  const buyerLogin = await call('POST', '/auth/wx-login', { code: `degrade_${ts}` })
  const bt = buyerLogin.json.data.token
  await call(
    'POST',
    '/buyer/register',
    {
      shopName: `降级验收店${ts}`,
      contact: '降级',
      phone: '13' + String(ts).slice(-8) + '7',
      address: '降级路7号',
    },
    bt,
  )

  // ① 授权配置：configured=false（前端据此**隐藏**按钮）
  const cfg = await call('GET', '/buyer/demand/subscribe-config', null, bt)
  console.log(`     GET /buyer/demand/subscribe-config → ${JSON.stringify(cfg.json)}`)
  ok('subscribe-config 正常返回 configured=false（前端隐藏按钮）', cfg.json.code === 0 && cfg.json.data.configured === false)

  // ② 上报授权：业务错 1001 + 人话，不是裸 500
  const sub = await call('POST', '/buyer/demand/subscribe', { templateId: 'guess_it', accepted: ['guess_it'] }, bt)
  console.log(`     POST /buyer/demand/subscribe → HTTP ${sub.status} ${JSON.stringify(sub.json)}`)
  ok(
    '上报授权返回业务错 1001「运营还没配置到货通知模板」（HTTP 200，不是裸 500）',
    sub.status === 200 && sub.json.code === 1001 && /还没配置到货通知模板/.test(sub.json.msg),
    { status: sub.status, body: sub.json },
  )

  // ③ 做个需求，试通知 → 业务错
  const dish = `降级${ts}菜`
  await call('POST', '/buyer/demand/report', { items: [{ rawText: dish }], source: 1 }, bt)
  const list = await call('GET', `/admin/demand?keyword=${encodeURIComponent(dish)}`, null, at)
  const d = list.json.data.list[0]
  console.log(`     造一条需求：#${d.id} ${d.name}`)

  const pv = await call('GET', `/admin/demand/${d.id}/notify-preview`, null, at)
  console.log(`     notify-preview → ${JSON.stringify(pv.json.data && { templateConfigured: pv.json.data.templateConfigured, counts: pv.json.data.counts, cannot: pv.json.data.cannot.map((x) => x.reason) })}`)
  ok(
    'notify-preview 正常返回（templateConfigured=false，且说明写清「运营还没配置到货通知模板」）',
    pv.json.code === 0 &&
      pv.json.data.templateConfigured === false &&
      pv.json.data.cannot.some((x) => /还没配置到货通知模板/.test(x.reason)),
    pv.json,
  )

  const nf = await call('POST', `/admin/demand/${d.id}/notify`, null, at)
  console.log(`     POST /admin/demand/${d.id}/notify → HTTP ${nf.status} ${JSON.stringify(nf.json)}`)
  ok(
    '实发通知返回业务错 1001「运营还没配置到货通知模板，暂时发不了到货通知」（HTTP 200，不是裸 500）',
    nf.status === 200 && nf.json.code === 1001 && /还没配置到货通知模板/.test(nf.json.msg),
    { status: nf.status, body: nf.json },
  )

  console.log('\n' + '='.repeat(64))
  console.log(`降级验收：✅ 通过 ${passed} 项 / ❌ 失败 ${failed} 项`)
  console.log('='.repeat(64))
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('脚本异常：', e)
  process.exit(1)
})
