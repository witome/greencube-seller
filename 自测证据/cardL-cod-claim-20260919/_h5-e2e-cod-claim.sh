#!/usr/bin/env bash
# 卡L 浏览器 E2E：采购方订单详情页「货到付款 · 送达后」收款区
#   1) 收款区出现 + 金额 + 文案 + 两个付款按钮 + 「我已付款」
#   2) 页面不展示收款码图片（大辉明确说扫配送员那张）
#   3) 「扫码付款」只弹说明（不调 wx.scanCode）
#   4) 「微信直接支付」只提示即将开通（**不接模拟支付**）
#   5) 点「我已付款」→ 文案变成「已告知配送员，待其核对收款」+ 抓到请求
#   6) 两个状态分开显示（客户称已付 / 已核销）
#
# 一条命令内完成（playwright-cli 的 daemon 只活一条命令）；后端(3001)与 H5(5199) 已在另行常驻。
# 载荷保持纯 ASCII（中文写 \uXXXX）：run-code 的代码是当 argv 传给原生程序的。
# 跑法： cd <临时目录> && bash <本文件绝对路径>
set -uo pipefail

D="C:/Users/Administrator/Documents/绿立方开发/自测证据/cardL-cod-claim-20260919"
SHOTS="$D/shots"
H5="http://localhost:5199"
OID="${1:-1088}"
mkdir -p "$SHOTS"

run() { echo ""; echo "== $* =="; }

run "1. open browser"
timeout 150 playwright-cli open "$H5/" 2>&1 | tail -2
sleep 4

run "2. identity = buyer via uni storage + clear stale token"
timeout 220 playwright-cli run-code "async page => { await page.goto('$H5/'); await page.waitForFunction(() => typeof uni !== 'undefined', null, {timeout: 30000}); await page.evaluate(() => { uni.setStorageSync('devRole','buyer'); uni.removeStorageSync('token'); uni.removeStorageSync('currentRole') }); await page.goto('$H5/'); await page.waitForFunction(() => typeof uni !== 'undefined', null, {timeout: 30000}); await page.waitForTimeout(1500); return await page.evaluate(() => JSON.stringify({devRole: uni.getStorageSync('devRole'), token: !!uni.getStorageSync('token')})) }" 2>&1 | grep -A 2 "### Result"

run "3. login (WeChat one-tap, mock buyer)"
timeout 150 playwright-cli run-code "async page => { await page.click('.wx-btn'); await page.waitForTimeout(4500); return await page.evaluate(() => JSON.stringify({url: page.url(), token: !!uni.getStorageSync('token'), currentRole: uni.getStorageSync('currentRole')})) }" 2>&1 | grep -A 2 "### Result"

run "4. open order detail (COD delivered order $OID) via hash"
timeout 200 playwright-cli run-code "async page => { await page.evaluate((oid) => { location.hash = '#/pages/buyer/order-detail?id=' + oid }, '$OID'); await page.waitForSelector('.cod-card', {timeout: 25000}); await page.waitForTimeout(2000); return await page.evaluate(() => JSON.stringify({url: location.href, status: (document.querySelector('.od-status')||{}).innerText, payMethodRow: [...document.querySelectorAll('.row')].map(r=>r.innerText).filter(t=>t.includes('\u652f\u4ed8'))})) }" 2>&1 | grep -A 2 "### Result"

run "5. 收款区内容 + 确认页面没有收款码图片"
timeout 240 playwright-cli run-code "async page => { const r = await page.evaluate(() => { const c = document.querySelector('.cod-card'); const txt = c ? c.innerText : null; return JSON.stringify({ cardVisible: !!c, cardText: txt, amount: (document.querySelector('.cod-amount')||{}).innerText, tip: (document.querySelector('.cod-tip')||{}).innerText, payButtons: [...document.querySelectorAll('.cod-card .pay-btn')].map(b=>b.innerText), claimBtn: (document.querySelector('.cod-claim-btn')||{}).innerText || null, qrImagesInCard: document.querySelectorAll('.cod-card img').length, statusRows: [...document.querySelectorAll('.cod-status-i')].map(x=>x.innerText.replace(/\n/g,' | ')) }) }); await page.screenshot({path:'$SHOTS/31-cod-pay-area.png', fullPage: true}); return r }" 2>&1 | grep -A 2 "### Result"

run "6. 点「扫码付款」→ 只弹说明"
timeout 200 playwright-cli run-code "async page => { await page.locator('.cod-card .pay-btn.cod').click(); await page.waitForTimeout(1200); const t = await page.evaluate(() => { const m = document.querySelector('.uni-modal'); return m ? m.innerText.replace(/\n/g,' | ') : null }); await page.screenshot({path:'$SHOTS/32-scan-tip.png'}); return JSON.stringify({modal: t}) }" 2>&1 | grep -A 2 "### Result"
timeout 120 playwright-cli run-code "async page => { const btn = page.locator('.uni-modal__btn').first(); if (await btn.count()) { await btn.click(); await page.waitForTimeout(800) } return 'dismissed' }" 2>&1 | tail -2

run "7. 点「微信直接支付」→ 只提示即将开通（无模拟支付请求）"
timeout 200 playwright-cli run-code "async page => { const reqs = []; page.on('request', r => { const u = String(r.url()); if (u.includes('/payment/') || u.includes('mock')) reqs.push(u) }); await page.locator('.cod-card .pay-btn.wechat').click(); await page.waitForTimeout(1200); const t = await page.evaluate(() => { const m = document.querySelector('.uni-modal'); return m ? m.innerText.replace(/\n/g,' | ') : null }); await page.screenshot({path:'$SHOTS/33-wechat-coming.png'}); return JSON.stringify({modal: t, paymentRequests: reqs}) }" 2>&1 | grep -A 2 "### Result"
timeout 120 playwright-cli run-code "async page => { const btn = await page.locator('.uni-modal__btn').first(); if (await btn.count()) { await btn.click(); await page.waitForTimeout(800) } return 'dismissed' }" 2>&1 | tail -2

run "8. 点「我已付款」→ 文案状态变化 + 抓请求体"
timeout 240 playwright-cli run-code "async page => { const bodies = []; page.on('request', r => { if (String(r.url()).includes('/claim-paid')) bodies.push({method: r.method(), url: r.url(), body: r.postData()}) }); await page.locator('.cod-claim-btn').click(); await page.waitForTimeout(300); const toast = await page.evaluate(() => { const el = document.querySelector('.uni-toast, .uni-sample-toast'); return el ? el.innerText : null }); await page.waitForTimeout(2500); const r = await page.evaluate(() => JSON.stringify({ claimBtnGone: !document.querySelector('.cod-claim-btn'), claimedText: (document.querySelector('.cod-claimed')||{}).innerText || null, statusRows: [...document.querySelectorAll('.cod-status-i')].map(x=>x.innerText.replace(/\n/g,' | ')) })); await page.screenshot({path:'$SHOTS/34-claimed.png', fullPage: true}); return JSON.stringify({toast, requests: bodies, dom: JSON.parse(r)}) }" 2>&1 | grep -A 2 "### Result"

run "9. close browser"
timeout 120 playwright-cli close 2>&1 | tail -2

echo ""
echo "=== screenshots ==="
ls -la "$SHOTS"
