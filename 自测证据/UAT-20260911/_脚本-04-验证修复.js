const { chromium } = require('playwright-core')

const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
const APP = 'http://localhost:5180'
const OUT = 'C:/Users/Administrator/Documents/绿立方开发/自测证据/UAT-20260911'

let pass = 0, fail = 0
const check = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (x ? ' → ' + JSON.stringify(x) : '')) } }

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const txt = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const hideDev = () => page.evaluate(() => { const b = document.getElementById('dev-role-switcher'); if (b && b.parentElement) b.parentElement.remove() })
  const cards = () => page.locator('.goods-card').count()

  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)
  await page.getByText('微信一键登录').click()
  await page.waitForTimeout(4000)

  // ── 场景 1：正常加载 ──
  console.log('\n【场景 1 · 正常加载】')
  let blocked = false
  await page.route('**/product/list*', (r) => (blocked ? r.abort('connectionfailed') : r.continue()))
  await page.goto(APP + '/#/pages/buyer/goods', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)
  await hideDev()
  check('商品卡片正常渲染（7 个）', (await cards()) === 7, await cards())
  check('不显示「加载中」', !(await txt()).includes('加载中'))

  // ── 场景 2：请求失败 → 不再永久卡死，给出重试 ──
  console.log('\n【场景 2 · 请求失败（模拟后端不可达）】')
  blocked = true
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)
  await hideDev()
  let body = await txt()
  await page.screenshot({ path: `${OUT}/92-修复后-加载失败给出重试.png` })
  check('❌ 不再永久停在「加载中」', !body.includes('加载中'))
  check('显示明确的失败提示', body.includes('商品加载失败'))
  check('提供「点击重试」入口', body.includes('点击重试'))
  check('商品卡片为 0（确实没数据）', (await cards()) === 0)

  // ── 场景 3：网络恢复后点重试 → 正常加载 ──
  console.log('\n【场景 3 · 网络恢复后点「点击重试」】')
  blocked = false
  await page.getByText('点击重试').click()
  await page.waitForTimeout(4000)
  body = await txt()
  await page.screenshot({ path: `${OUT}/93-修复后-点击重试恢复正常.png` })
  check('重试后商品恢复加载（7 个）', (await cards()) === 7, await cards())
  check('重试后不再显示失败提示', !body.includes('商品加载失败'))

  // ── 场景 4：失败后切走再切回（onShow 自动补载）──
  console.log('\n【场景 4 · 失败后离开再回到本页（onShow 自动补载）】')
  blocked = true
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)
  await hideDev()
  check('回到失败态', (await txt()).includes('商品加载失败'))
  blocked = false
  // 用应用自身的 switchTab 触发真实 tab 切换（不整页刷新），这样才能验证 onShow 补载
  const switched = await page.evaluate(() => {
    if (!window.uni || !window.uni.switchTab) return false
    window.uni.switchTab({ url: '/pages/buyer/mine' })
    return true
  })
  check('已通过 uni.switchTab 切到「我的」', switched)
  await page.waitForTimeout(3000)
  await hideDev()
  await page.evaluate(() => window.uni.switchTab({ url: '/pages/buyer/goods' }))
  await page.waitForTimeout(5000)
  await hideDev()
  await page.screenshot({ path: `${OUT}/94-修复后-切回页面自动补载.png` })
  check('切回本页自动重新加载成功', (await cards()) === 7, await cards())

  console.log('\n' + '='.repeat(46))
  console.log(`修复验证：✅ 通过 ${pass} 项 / ❌ 失败 ${fail} 项`)
  console.log('='.repeat(46))
  await browser.close()
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
