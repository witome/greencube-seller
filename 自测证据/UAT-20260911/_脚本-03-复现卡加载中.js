const { chromium } = require('playwright-core')

const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
const APP = 'http://localhost:5180'
const OUT = 'C:/Users/Administrator/Documents/绿立方开发/自测证据/UAT-20260911'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)
  await page.getByText('微信一键登录').click()
  await page.waitForTimeout(4000)
  console.log('已登录:', page.url())

  // ── 模拟一次网络失败（等价于后端重启窗口内请求打不通）──
  console.log('\n【模拟】让 /product/list 请求失败一次（模拟后端不可达/网络抖动）')
  let blocked = true
  await page.route('**/product/list*', (route) => {
    if (blocked) route.abort('connectionfailed')
    else route.continue()
  })

  await page.goto(APP + '/#/pages/buyer/goods', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)
  await page.evaluate(() => { const b = document.getElementById('dev-role-switcher'); if (b && b.parentElement) b.parentElement.remove() })

  let body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const stuck = body.includes('加载中')
  console.log('  请求失败后页面文本 =', body.slice(0, 150))
  console.log('  → 是否卡在「加载中」 =', stuck)
  console.log('  → 商品卡片数 =', await page.locator('.goods-card').count())
  await page.screenshot({ path: `${OUT}/90-复现-请求失败后卡在加载中.png` })

  // ── 恢复网络，看是否会自动恢复 ──
  console.log('\n【恢复】网络恢复后再等 10s，看是否自动重新加载')
  blocked = false
  await page.waitForTimeout(10000)
  body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const recovered = !body.includes('加载中')
  console.log('  → 是否自动恢复 =', recovered, '| 卡片数 =', await page.locator('.goods-card').count())
  console.log('  → 页面是否提供「重试」入口 =', body.includes('重试'))
  await page.screenshot({ path: `${OUT}/91-复现-网络恢复后仍卡住且无重试.png` })

  // ── 对比：手动刷新页面后正常 ──
  console.log('\n【对照】手动刷新页面')
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)
  body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  console.log('  → 卡片数 =', await page.locator('.goods-card').count(), '| 仍加载中 =', body.includes('加载中'))

  console.log('\n结论：请求失败 → 永久卡「加载中」，网络恢复后不会自愈，页面也没有重试入口；只能整页刷新。')
  await browser.close()
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
