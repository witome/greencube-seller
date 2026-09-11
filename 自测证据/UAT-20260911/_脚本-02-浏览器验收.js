const { chromium } = require('playwright-core')
const fs = require('fs')

const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
const APP = 'http://localhost:5180'
const OUT = 'C:/Users/Administrator/Documents/绿立方开发/自测证据/UAT-20260911'

const ORDER_DELIVERED = 107 // 已送达（60）
const ORDER_PENDING = 109   // 新订单（10）
const EXPECT_AFTERSALE_ING = 2

fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')) }
}

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)))

  const txt = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false }); console.log('     📸 ' + n + '.png') }
  // H5 专属调试浮层「🎭 切换角色」（App.vue #ifdef H5 注入，小程序端不存在）会压住页面按钮，
  // 验收页面本身时把它移除，避免干扰点击；正式端无此元素。
  const hideDev = async () => {
    await page.evaluate(() => {
      const btn = document.getElementById('dev-role-switcher')
      if (btn && btn.parentElement) btn.parentElement.remove()
    })
  }
  const go = async (hash, sel, t = 25000) => {
    await page.goto(APP + '/' + hash, { waitUntil: 'domcontentloaded', timeout: 60000 })
    // ⚠️ 仅 hash 变化时浏览器不会刷新，uni-app 路由不重渲染 → 强制 reload 保证换页生效
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
    if (sel) { try { await page.waitForSelector(sel, { timeout: t }) } catch (e) { console.log('     (等待 ' + sel + ' 超时，继续)') } }
    await page.waitForTimeout(1800)
    await hideDev() // 放在等待之后：浮层是 onShow + 200ms 注入的
  }

  // ── 登录 ──
  console.log('\n【0. 登录】')
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)
  await page.getByText('微信一键登录').click()
  await page.waitForTimeout(4000)
  await hideDev()
  check('微信一键登录成功（进入首页）', (await txt()).includes('绿立方') || page.url().includes('home'), page.url())
  console.log('     URL =', page.url())

  // ── 需求 1：我的页无「身份申请」 ──
  console.log('\n【需求 1 · 我的页「身份申请」已删除】')
  await go('#/pages/buyer/mine', 'text=售后中')
  const mineText = await txt()
  await shot('01-我的页-无身份申请')
  check('页面已加载（含「售后中」「餐馆资料」）', mineText.includes('售后中') && mineText.includes('餐馆资料'))
  check('❌ 不再出现「身份申请」', !mineText.includes('身份申请'))
  check('❌ 不再出现「申请成为供应商」', !mineText.includes('申请成为供应商'))

  // ── 需求 3：售后中数量 + 列表 ──
  console.log('\n【需求 3 · 售后中数量与列表】')
  const countText = await page.locator('.buyer-mine-num-red').first().innerText().catch(() => '?')
  console.log('     「售后中」显示 =', JSON.stringify(countText.trim()))
  check(`「售后中」不再是硬编码「暂无」`, countText.trim() !== '暂无', countText)
  check(`「售后中」数量 = ${EXPECT_AFTERSALE_ING}`, Number(countText.trim()) === EXPECT_AFTERSALE_ING, countText)

  await page.getByText('售后中').first().click()
  await page.waitForTimeout(2500)
  const listUrl = page.url()
  const listText = await txt()
  await shot('02-售后列表-售后中筛选')
  console.log('     URL =', listUrl)
  check('跳转到「我的售后」列表页', /aftersale-list/.test(listUrl), listUrl)
  check('默认停在「售后中」筛选', /filter=ing/.test(listUrl), listUrl)
  check('列表渲染出工单卡片（含「售后单 #」）', listText.includes('售后单 #'))
  check('工单显示状态「待处理」', listText.includes('待处理'))
  check('工单含提交时间与问题描述', listText.includes('提交 ') && listText.includes('到货有压伤'))
  check('筛选条含 全部/售后中/已解决/已关闭', ['全部', '售后中', '已解决', '已关闭'].every((t) => listText.includes(t)))
  check('有「申请售后」入口', listText.includes('申请售后'))

  // 切到「已解决」验证筛选真的在过滤
  await page.getByText('已解决', { exact: true }).first().click()
  await page.waitForTimeout(1200)
  const doneText = await txt()
  await shot('03-售后列表-已解决筛选')
  check('切「已解决」后不再显示待处理工单', !doneText.includes('待处理') || doneText.includes('暂无售后记录'))

  // ── 需求 4：订单详情两个时间 ──
  console.log('\n【需求 4 · 订单详情：下单时间 + 交付确认时间】')
  await go(`#/pages/buyer/order-detail?id=${ORDER_DELIVERED}`, 'text=下单时间')
  const odText = await txt()
  await shot('04-订单详情-已送达-两个时间')
  check('有「下单时间」行', odText.includes('下单时间'))
  check('有「交付确认时间」行', odText.includes('交付确认时间'))
  const times = odText.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g) || []
  console.log('     页面上的时间值 =', JSON.stringify(times))
  check('下单时间有值（YYYY-MM-DD HH:mm）', times.length >= 1)
  check('交付确认时间有值（已送达订单）', times.length >= 2 && !odText.includes('待交付'), times)

  await go(`#/pages/buyer/order-detail?id=${ORDER_PENDING}`, 'text=下单时间')
  const od2 = await txt()
  await shot('05-订单详情-未交付-待交付')
  check('未交付订单显示「待交付」', od2.includes('待交付'))

  // ── 需求 2：AI 确认页添加商品 ──
  console.log('\n【需求 2 · AI 确认页添加新商品】')
  await go('#/pages/buyer/kefu', 'text=输入想买的菜品和数量')
  await page.locator('input').first().fill('白菜10斤，小葱5斤，明天早上送到')
  await page.getByText('发送', { exact: true }).first().click()
  await page.waitForTimeout(3500)
  await shot('06-AI客服-解析结果')
  check('AI 客服给出识别结果', (await txt()).includes('已为您识别出以下商品'))

  await page.getByText('查看并确认订单').first().click()
  await page.waitForTimeout(3000)
  await shot('07-AI确认页-初始清单')
  const before = await page.locator('.cart-row').count()
  const beforeTotal = (await txt()).match(/预估合计 ¥([\d.]+)/)?.[1]
  console.log(`     初始清单 = ${before} 项，合计 ¥${beforeTotal}`)
  check('AI 草稿清单已渲染', before >= 2, before)

  await page.getByText('＋ 添加商品').first().click()
  await page.waitForTimeout(2500)
  await hideDev()
  await shot('08-添加商品弹层')
  const sheet = await txt()
  check('弹层打开（含「添加商品」标题与搜索）', sheet.includes('添加商品') && sheet.includes('搜索商品'))
  check('弹层有分类侧栏（含「全部」）', sheet.includes('全部'))
  const goodsCount = await page.locator('.pk-row').count()
  console.log('     弹层商品数 =', goodsCount)
  check('弹层加载出商品列表', goodsCount > 0, goodsCount)

  // .pk-add = 还没在清单里的商品的 ＋（清单里已有的会显示步进器 .pk-stepper）
  const addBtns = page.locator('.pk-add')
  const addCount = await addBtns.count()
  console.log('     弹层中「未加入」商品数 =', addCount)
  const firstName = await page.evaluate(() => {
    const el = document.querySelector('.pk-add')
    const row = el && el.closest('.pk-row')
    return row ? row.innerText.replace(/\s+/g, ' ') : '(未知)'
  })
  console.log('     点第 1 个未加入商品 =', firstName)
  await addBtns.first().click()
  await page.waitForTimeout(900)
  await shot('09-弹层加入商品后')
  const sheetFoot = (await txt()).match(/已选 (\d+) 项 · 预估 ¥([\d.]+)/)
  console.log('     弹层底部 =', sheetFoot ? sheetFoot[0] : '(未匹配)')
  check('弹层底部「已选」项数增加', sheetFoot && Number(sheetFoot[1]) === before + 1, sheetFoot && sheetFoot[0])

  await page.getByText('完成', { exact: true }).first().click()
  await page.waitForTimeout(1500)
  await shot('10-AI确认页-新增商品后')
  const after = await page.locator('.cart-row').count()
  const afterTotal = (await txt()).match(/预估合计 ¥([\d.]+)/)?.[1]
  console.log(`     添加后清单 = ${after} 项，合计 ¥${afterTotal}`)
  check(`清单项数 ${before} → ${after}（+1）`, after === before + 1, { before, after })
  check('合计金额随之变化', beforeTotal !== afterTotal, { beforeTotal, afterTotal })
  check('页面仍在 AI 确认页（未跳走丢草稿）', page.url().includes('ai-confirm'), page.url())

  console.log('\n' + '='.repeat(46))
  console.log(`浏览器验收：✅ 通过 ${pass} 项 / ❌ 失败 ${fail} 项`)
  console.log('='.repeat(46))
  await browser.close()
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
