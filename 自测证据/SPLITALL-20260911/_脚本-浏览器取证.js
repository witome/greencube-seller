// 本卡浏览器取证：订单履约页（移除「⚡一键拆单」后）
// 运行：NODE_PATH=<managed node_modules> node _脚本-浏览器取证.js
const { chromium } = require('playwright-core')
const fs = require('fs'), path = require('path')

const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
const ADMIN_WEB = 'http://localhost:5190' // admin-web（vite 仅绑 [::1]，须用 localhost）
const API = 'http://localhost:3001/api/v1'
const OUT = path.resolve(__dirname)
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const check = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (e ? ' → ' + JSON.stringify(e) : '')) } }

async function login(code) {
  const r = await fetch(API + '/auth/wx-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  return (await r.json()).data.token
}

;(async () => {
  const adminToken = await login('admin')
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
  await ctx.addInitScript((t) => { localStorage.setItem('admin_token', t); localStorage.setItem('admin_name', '运营管理员') }, adminToken)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))

  console.log('\n【订单履约页 — 批量按钮已移除 + 其余拆单入口仍可用】')
  await page.goto(ADMIN_WEB + '/order', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('.el-table', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)

  const body0 = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  // ① 批量按钮必须消失
  const allBtn = await page.getByRole('button', { name: /一键拆单/ }).count()
  const flashIco = await page.locator('text=⚡').count()
  check('页面不再有「⚡ 一键拆单」按钮', allBtn === 0, { btnCount: allBtn })
  check('页面不含 ⚡ 字符', flashIco === 0, { flashCount: flashIco })
  check('正文不含「一键拆单」文案', !/一键拆单/.test(body0), { hit: /一键拆单/.test(body0) })
  console.log('     卡片头文本 = ' + (body0.match(/待处理订单/) ? '待处理订单（无右侧按钮）' : '(未识别)'))

  // ② 其余拆单入口仍在（行内按钮）
  const autoSplitBtn = await page.getByRole('button', { name: '自动拆单', exact: true }).count()
  const manualSplitBtn = await page.getByRole('button', { name: '手动拆单', exact: true }).count()
  const reSplitBtn = await page.getByRole('button', { name: '改拆单', exact: true }).count()
  check('行内「自动拆单」按钮仍在', autoSplitBtn > 0, { autoSplitBtn })
  check('「手动拆单」按钮仍在', manualSplitBtn > 0, { manualSplitBtn })
  check('「改拆单」按钮仍在', reSplitBtn > 0, { reSplitBtn })
  const rowCount = await page.locator('.el-table__body tbody tr').count()
  check('订单列表有数据行', rowCount > 0, { rowCount })
  console.log(`     按钮计数：自动拆单=${autoSplitBtn} 手动拆单=${manualSplitBtn} 改拆单=${reSplitBtn} 表格行=${rowCount}`)
  await page.screenshot({ path: OUT + '/01-订单履约页-无批量按钮且拆单入口仍在.png', fullPage: false })
  console.log('     📸 01-订单履约页-无批量按钮且拆单入口仍在.png')

  // ③ 手动拆单 → 拆单建议预览弹窗仍可用
  const manual = page.getByRole('button', { name: '手动拆单', exact: true }).first()
  if (await manual.count()) {
    await manual.click().catch(() => {})
    await page.waitForTimeout(2200)
    const dlg = page.locator('.el-dialog').first()
    const dlgVisible = await dlg.isVisible().catch(() => false)
    const dlgTxt = dlgVisible ? (await dlg.innerText()).replace(/\s+/g, ' ').trim() : ''
    check('「手动拆单」弹窗可打开（拆单建议预览入口仍在）', dlgVisible, { dlgVisible })
    check('弹窗内有拆单建议内容', dlgTxt.length > 30, { len: dlgTxt.length, head: dlgTxt.slice(0, 80) })
    console.log('     弹窗文本 = ' + dlgTxt.slice(0, 140))
    await page.screenshot({ path: OUT + '/02-手动拆单-建议预览仍可用.png', fullPage: false })
    console.log('     📸 02-手动拆单-建议预览仍可用.png')
    // 关闭（点取消/关闭，不执行）
    const cancel = dlg.locator('button:has-text("取消"), button:has-text("关闭")').first()
    if (await cancel.count()) await cancel.click().catch(() => {})
    else await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(900)
  }

  // ④ 行内「自动拆单」确认框文案须写明会覆盖
  const auto = page.getByRole('button', { name: '自动拆单', exact: true }).first()
  if (await auto.count()) {
    await auto.click().catch(() => {})
    await page.waitForTimeout(1500)
    const box = page.locator('.el-message-box').first()
    const boxVisible = await box.isVisible().catch(() => false)
    const boxTxt = boxVisible ? (await box.innerText()).replace(/\s+/g, ' ').trim() : ''
    check('行内「自动拆单」弹出确认框', boxVisible, { boxVisible })
    check('确认框文案写明会覆盖当前分配', /将被覆盖/.test(boxTxt), { boxTxt: boxTxt.slice(0, 120) })
    console.log('     确认框文案 = ' + boxTxt.slice(0, 160))
    await page.screenshot({ path: OUT + '/03-行内自动拆单-确认框写明会覆盖.png', fullPage: false })
    console.log('     📸 03-行内自动拆单-确认框写明会覆盖.png')
    const c2 = page.locator('.el-message-box button:has-text("取消")').first()
    if (await c2.count()) await c2.click().catch(() => {})
    await page.waitForTimeout(600)
  }

  check('页面无 JS 报错', errs.length === 0, { errs })

  await ctx.close()
  await browser.close()
  console.log('\n' + '='.repeat(52))
  console.log(`浏览器取证：✅ 通过 ${pass} 项 / ❌ 失败 ${fail} 项`)
  console.log('='.repeat(52))
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
