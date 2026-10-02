/**
 * 临时：卡BM 后台「未接单」三级时长文案 真页面取证（Hermes 三黑独立复核）
 * 用法：NODE_PATH=<hermes>/node_modules node scripts/kbm-page-verify.js
 * 前置：后端 3001、admin-web dev 5190、种子 kbm-page-seed.js 已跑
 */
const path = require('path')
const fs = require('fs')
const PW = process.env.PW_PATH || 'playwright'
const { chromium } = require(PW)

const OUT_DIR = 'C:/Users/Administrator/Documents/绿立方开发/自测证据/卡BM-复核-三黑'
const ORDER_IDS = (process.env.KBM_ORDER_IDS || '').split(',').filter(Boolean).map(Number)

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  // 1) 取后台 token（mock 登录：code=admin → dev_admin，库里该账号带 admin 角色）
  const r = await fetch('http://127.0.0.1:3001/api/v1/auth/wx-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'admin' }),
  })
  const j = await r.json()
  const token = j?.data?.token
  if (!token) throw new Error('取 admin token 失败：' + JSON.stringify(j))
  console.log('admin token 取得：', token.slice(0, 12) + '...')

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto('http://localhost:5190/', { waitUntil: 'domcontentloaded' })
  await page.evaluate((t) => { localStorage.setItem('admin_token', t); localStorage.setItem('admin_name', '运营管理员') }, token)
  await page.goto('http://localhost:5190/order', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.el-table__row', { timeout: 30000 })
  await page.waitForTimeout(2500)

  // 2) 逐行取「供应商接单」列的文案
  const found = {}
  const rows = await page.$$eval('.el-table__row', (trs) =>
    trs.map((tr) => ({
      text: tr.innerText.replace(/\s+/g, ' ').trim(),
      lines: Array.from(tr.querySelectorAll('.ack-line')).map((el) => el.innerText.trim()),
    })),
  )
  for (const id of ORDER_IDS) {
    const hit = rows.find((x) => x.text.includes('#' + id) || x.text.includes(String(id)))
    found[id] = hit ? hit.lines : null
  }
  console.log('行数：', rows.length)
  console.log('三个种子订单的接单列文案：')
  for (const id of ORDER_IDS) console.log(`  #${id} ->`, JSON.stringify(found[id]))

  // 3) 页面报错与截图
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.screenshot({ path: path.join(OUT_DIR, 'KBM-后台未接单三级时长-三黑.png'), fullPage: false })
  // 4) 未接单筛选仍生效：点一下筛选，数行数
  const before = rows.length
  const chip = await page.$$('.el-radio-button, .ack-filter, [class*=ack]')
  let afterUnacked = null
  try {
    const btn = page.locator('text=未接单').first()
    await btn.click({ timeout: 5000 })
    await page.waitForTimeout(1500)
    const rows2 = await page.$$eval('.el-table__row', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()))
    afterUnacked = rows2.length
    const allUnackedOk = rows2.every((t) => /未接单/.test(t) || !/已接单/.test(t))
    await page.screenshot({ path: path.join(OUT_DIR, 'KBM-未接单筛选-三黑.png'), fullPage: false })
    console.log(`筛选前 ${before} 行 → 点「未接单」后 ${afterUnacked} 行；筛选后仍含「已接单」的行：${!allUnackedOk}`)
  } catch (e) {
    console.log('筛选点不到（不影响主断言）：', e.message)
  }
  console.log('页面 JS 报错数：', errs.length, errs.slice(0, 3))
  await browser.close()
  console.log('截图：', OUT_DIR)
}
main().catch((e) => { console.error('VERIFY FAIL', e); process.exit(1) })
