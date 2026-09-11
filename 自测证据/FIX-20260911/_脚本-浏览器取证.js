// 本卡浏览器取证：① 售后管理页「能出数据」（修好的证据）② 业务员被拒（权限收口证据）
// 运行：NODE_PATH=<managed node_modules> node _脚本-浏览器取证.js
const { chromium } = require('playwright-core')
const fs = require('fs'), crypto = require('crypto'), path = require('path')

const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
const ADMIN_WEB = 'http://localhost:5190' // admin-web（vite 固定端口，仅绑 [::1]，须用 localhost 不能用 127.0.0.1）
const API = 'http://localhost:3001/api/v1'
const OUT = path.resolve(__dirname)
const ENV = path.resolve(__dirname, '../../backend/.env')

fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const check = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (e ? ' → ' + JSON.stringify(e) : '')) } }

// 本地签发「业务员身份」token（口径同验收脚本：仅验守卫，不建账号、不写库）
const raw = (fs.readFileSync(ENV, 'utf8').match(/^JWT_SECRET=(.*)$/m) || [])[1] || ''
const jwtSecret = raw.trim().replace(/^['"]|['"]$/g, '')
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const hh = b64({ alg: 'HS256', typ: 'JWT' })
const pp = b64({ sub: 1, userId: 1, roles: ['business_agent'], currentRole: 'business_agent' })
const AGENT_TOKEN = hh + '.' + pp + '.' + crypto.createHmac('sha256', jwtSecret).update(hh + '.' + pp).digest('base64url')

async function login(code) {
  const r = await fetch(API + '/auth/wx-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  return (await r.json()).data.token
}

;(async () => {
  const adminToken = await login('admin')
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })

  // ── A/B：售后管理页（运营身份）──
  console.log('\n【A. 售后管理页 — 表格能出数据（取值修复证据）】')
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctxA.addInitScript((t) => { localStorage.setItem('admin_token', t); localStorage.setItem('admin_name', '运营管理员') }, adminToken)
  const pA = await ctxA.newPage()
  const errsA = []
  pA.on('pageerror', (e) => errsA.push(String(e).slice(0, 160)))
  await pA.goto(ADMIN_WEB + '/aftersale', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await pA.waitForSelector('.el-table', { timeout: 30000 }).catch(() => {})
  await pA.waitForTimeout(2500)

  const rowCount = await pA.locator('.el-table__body tbody tr').count()
  const totalTxt = (await pA.locator('.el-pagination').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
  // 表体首行文本（证明真的有数据行，不是空表）
  const firstRow = rowCount > 0 ? (await pA.locator('.el-table__body tbody tr').first().innerText()).replace(/\s+/g, ' ').trim() : ''
  check('售后列表表格有数据行(>0)', rowCount > 0, { rowCount })
  check('首行有业务内容(非空行)', firstRow.length > 0, { firstRow: firstRow.slice(0, 80) })
  console.log('     行数=' + rowCount + ' | 分页=' + totalTxt.slice(0, 60))
  console.log('     首行=' + firstRow.slice(0, 100))
  await pA.screenshot({ path: OUT + '/01-售后管理-列表有数据.png', fullPage: false })
  console.log('     📸 01-售后管理-列表有数据.png')

  // 详情抽屉（同一个 res.data 缺陷的第 3 处）
  if (rowCount > 0) {
    await pA.locator('.el-table__body tbody tr').first().locator('button, .el-button').first().click({ timeout: 8000 }).catch(async () => {
      await pA.locator('.el-table__body tbody tr').first().click({ timeout: 8000 }).catch(() => {})
    })
    await pA.waitForTimeout(2000)
    const drawerOpen = await pA.locator('.el-drawer, .el-dialog').first().isVisible().catch(() => false)
    const drawerTxt = drawerOpen ? (await pA.locator('.el-drawer, .el-dialog').first().innerText()).replace(/\s+/g, ' ').trim() : ''
    check('详情抽屉可打开', drawerOpen)
    check('详情抽屉有内容(非空)', drawerTxt.length > 30, { len: drawerTxt.length, head: drawerTxt.slice(0, 100) })
    console.log('     抽屉内容=' + drawerTxt.slice(0, 140))
    await pA.screenshot({ path: OUT + '/02-售后管理-详情抽屉有数据.png', fullPage: false })
    console.log('     📸 02-售后管理-详情抽屉有数据.png')
  }
  await ctxA.close()

  // ── C/D：业务员被拒（权限收口）──
  console.log('\n【B. 业务员访问 ADMIN 页面 — 明确拒绝（2002）】')
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctxB.addInitScript((t) => { localStorage.setItem('admin_token', t); localStorage.setItem('admin_name', '业务员') }, AGENT_TOKEN)
  const pB = await ctxB.newPage()
  for (const [route, name, file] of [['/payments', '支付流水', '03-业务员访问支付流水被拒.png'], ['/finance', '资金结算', '04-业务员访问资金结算被拒.png']]) {
    await pB.goto(ADMIN_WEB + route, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await pB.waitForTimeout(3000)
    const toast = (await pB.locator('.el-message').allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ')
    const body = (await pB.locator('body').innerText()).replace(/\s+/g, ' ')
    const denied = /无此权限/.test(toast) || /无此权限/.test(body)
    check('业务员访问「' + name + '」被拒(提示:当前身份无此权限)', denied, { toast: toast.slice(0, 80) })
    await pB.screenshot({ path: OUT + '/' + file, fullPage: false })
    console.log('     📸 ' + file + '   toast=' + toast.slice(0, 60))
  }
  await ctxB.close()

  await browser.close()
  console.log('\n' + '='.repeat(50))
  console.log('浏览器取证：✅ ' + pass + ' 项 / ❌ ' + fail + ' 项')
  console.log('='.repeat(50))
  process.exit(fail ? 1 : 0)
})()
