/**
 * B 卡 H5 端到端：身份切换重签 token（真实浏览器操作，非接口冒烟）
 * 前置：user 10（dev_buyer）临时挂 supplier 身份（supplier id=8，测后回滚）
 * 用例：① 登录(purchaser) → 我的页点「切换身份」→ ActionSheet 选「供应商」
 *       ② 断言 reLaunch 到供应商首页 + localStorage token 更新 + 新 token payload.currentRole=supplier
 *       ③ 供应商首页正常渲染 + 页面内调 supplier 专属接口判权生效
 *       ④ 反向：拦截 switch-role 请求使其失败 → 点切换 → 不跳转、身份不变
 */
const { chromium } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core')

const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
const APP = 'http://localhost:5180'
const OUT = 'C:/Users/Administrator/Documents/绿立方开发/自测证据/SWITCHROLE-20260911'

function parseJwtPayload(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8')) } catch (e) { return { error: String(e).slice(0, 80) } }
}
const mask = (t) => (t ? t.slice(0, 12) + '...' + t.slice(-8) + ' (len=' + t.length + ')' : '(空)')

let pass = 0, fail = 0
const check = (name, cond, extra) => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''))
  if (!cond) fail++
}

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)))

  const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('   📸 ' + n + '.png') }
  const hideDev = async () => { await page.evaluate(() => { const b = document.getElementById('dev-role-switcher'); if (b && b.parentElement) b.parentElement.remove() }) }
  const storage = async (k) => page.evaluate((key) => localStorage.getItem('uni_' + key) ?? localStorage.getItem(key), 'PLACEHOLDER').catch(() => null)
  // uni H5 storage 实际 key 前缀可能为 uni_，做兼容读取
  const getLS = async (key) => page.evaluate((k) => {
    for (const full of [k, 'uni_' + k, k + '_TYPE', 'uni_' + k + '_TYPE']) {
      const v = localStorage.getItem(full)
      if (v !== null && !full.endsWith('_TYPE')) {
        try { const j = JSON.parse(v); return typeof j === 'object' && j !== null && 'value' in j ? j.value : v } catch (e) { return v }
      }
    }
    return null
  }, key)
  const go = async (hash, t = 22000) => {
    await page.goto(APP + '/#' + hash, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2200)
    await hideDev()
  }

  // ── ① 登录（buyer → user 10, purchaser）──
  console.log('\n【① 登录 buyer（user 10, purchaser）】')
  await page.goto(APP + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2500)
  const body0 = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300)
  console.log('   落地页内容片段:', body0.slice(0, 160))
  if (/登录/.test(body0) && !/今日推荐|常用功能/.test(body0)) {
    const loginBtn = page.locator('text=一键登录').first()
    if (await loginBtn.count()) { await loginBtn.click() } else {
      const alt = page.locator('button:has-text("登录"), text=微信登录, text=登录').first()
      if (await alt.count()) await alt.click()
    }
    await page.waitForTimeout(2800)
  }
  await hideDev()
  const oldToken = await getLS('token')
  const oldPl = parseJwtPayload(oldToken || '')
  check('① 已登录且为 purchaser（user 10）', !!oldToken && oldPl.currentRole === 'purchaser' && oldPl.userId === 10, { userId: oldPl.userId, currentRole: oldPl.currentRole })
  console.log('   切换前 token 掩码:', mask(oldToken))
  console.log('   切换前 payload:', JSON.stringify({ userId: oldPl.userId, roles: oldPl.roles, currentRole: oldPl.currentRole }))
  await shot('01-切换前-采购方我的页')

  // ── ② 我的页 → 切换身份 → 供应商 ──
  console.log('\n【② 切换身份 purchaser → supplier】')
  await go('/pages/buyer/mine')
  const switchEntry = page.locator('text=切换身份').first()
  check('②-1 我的页有「切换身份」入口（canSwitchRole=true，因 user10 现为双身份）', await switchEntry.count() > 0)
  await switchEntry.click()
  await page.waitForTimeout(900)
  // uni H5 ActionSheet 选项
  const cell = page.locator('.uni-actionsheet__cell', { hasText: '供应商' }).first()
  check('②-2 ActionSheet 列出「供应商」', await cell.count() > 0)
  await cell.click()
  // 等待 reLaunch 到供应商首页
  await page.waitForURL(/subpkg-supplier\/pages\/home/, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await hideDev()
  const curUrl = page.url()
  check('②-3 已 reLaunch 到供应商首页', /subpkg-supplier\/pages\/home/.test(curUrl), { url: curUrl.slice(-60) })

  const newToken = await getLS('token')
  const newPl = parseJwtPayload(newToken || '')
  console.log('   切换后 token 掩码:', mask(newToken))
  console.log('   切换后 payload:', JSON.stringify({ userId: newPl.userId, roles: newPl.roles, currentRole: newPl.currentRole }))
  check('②-4 token 已重签（字符串不同）', !!newToken && newToken !== oldToken, { same: newToken === oldToken })
  check('②-5 新 token payload.currentRole = supplier', newPl.currentRole === 'supplier')
  check('②-6 新 token 仍为同一账号 user 10（未换账号）', newPl.userId === 10)
  await shot('02-切换后-供应商首页')

  // ── ③ 判权生效：供应商首页内调 supplier 专属接口 ──
  console.log('\n【③ 供应商身份判权生效（页面内真实请求）】')
  const probe = await page.evaluate(async () => {
    const t = (() => { for (const full of ['token', 'uni_token']) { const v = localStorage.getItem(full); if (v) { try { const j = JSON.parse(v); return typeof j === 'object' && j !== null && 'value' in j ? j.value : v } catch (e) { return v } } } return null })()
    const res = await fetch('http://127.0.0.1:3001/api/v1/supplier-goods', { headers: { Authorization: 'Bearer ' + t } })
    const j = await res.json().catch(() => ({}))
    return { http: res.status, code: j.code, n: (j.data?.list || []).length, stall: j.data?.supplier?.stallName || j.data?.stallName || null }
  })
  check('③ 新身份 token 调 GET /supplier-goods → 200（行级隔离：自己摊位数据）', probe.code === 0, probe)

  // ── ④ 反向用例：切换失败不跳转、身份不变 ──
  console.log('\n【④ 反向：switch-role 请求失败 → 不跳转、身份不变】')
  await go('/subpkg-supplier/pages/mine')
  // 以 supplier 身份，others=[purchaser]；拦截 switch-role 请求使失败
  await page.route('**/auth/switch-role*', (r) => r.abort())
  const cellS = page.locator('.list-item', { hasText: '采购方' }).first()
  check('④-1 供应商我的页列出可切换身份「采购方」', await cellS.count() > 0, { count: await cellS.count() })
  const tokenBeforeFail = await getLS('token')
  await cellS.click()
  await page.waitForTimeout(2500)
  const urlAfterFail = page.url()
  const tokenAfterFail = await getLS('token')
  check('④-2 切换失败：未跳转（仍在供应商我的页）', /subpkg-supplier\/pages\/mine/.test(urlAfterFail), { url: urlAfterFail.slice(-60) })
  check('④-3 切换失败：token 未被覆盖（保持 supplier 身份）', tokenAfterFail === tokenBeforeFail && parseJwtPayload(tokenAfterFail || '').currentRole === 'supplier')
  await shot('03-反向-切换失败仍停留原页')

  console.log('\n' + (fail ? `❌ 端到端失败 ${fail} 项` : '✅ 端到端全部通过'))
  await browser.close()
  process.exit(fail ? 1 : 0)
})()
