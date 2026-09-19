#!/usr/bin/env bash
# 卡L 配送员侧 E2E：任务列表显示「客户称已付」标记
#   订单变 60 的瞬间任务就变 DONE，所以标记主要出现在「已完成订单」区（两处都加了）。
# 跑法： cd <临时目录> && bash <本文件绝对路径>
set -uo pipefail

D="C:/Users/Administrator/Documents/绿立方开发/自测证据/cardL-cod-claim-20260919"
SHOTS="$D/shots"
H5="http://localhost:5199"
mkdir -p "$SHOTS"

run() { echo ""; echo "== $* =="; }

run "1. open browser"
timeout 150 playwright-cli open "$H5/" 2>&1 | tail -2
sleep 4

run "2. identity = courier via uni storage + clear stale token"
timeout 220 playwright-cli run-code "async page => { await page.goto('$H5/'); await page.waitForFunction(() => typeof uni !== 'undefined', null, {timeout: 30000}); await page.evaluate(() => { uni.setStorageSync('devRole','courier'); uni.removeStorageSync('token'); uni.removeStorageSync('currentRole') }); await page.goto('$H5/'); await page.waitForFunction(() => typeof uni !== 'undefined', null, {timeout: 30000}); await page.waitForTimeout(1500); return await page.evaluate(() => JSON.stringify({devRole: uni.getStorageSync('devRole'), token: !!uni.getStorageSync('token')})) }" 2>&1 | grep -A 2 "### Result"

run "3. login (WeChat one-tap, mock courier)"
timeout 150 playwright-cli run-code "async page => { await page.click('.wx-btn'); await page.waitForTimeout(4500); return await page.evaluate(() => JSON.stringify({url: page.url(), token: !!uni.getStorageSync('token'), currentRole: uni.getStorageSync('currentRole')})) }" 2>&1 | grep -A 2 "### Result"

run "4. open courier home (task list) via hash"
timeout 250 playwright-cli run-code "async page => { await page.evaluate(() => { location.hash = '#/subpkg-courier/pages/home' }); await page.waitForSelector('.task-card', {timeout: 30000}); await page.waitForTimeout(3000); return await page.evaluate(() => JSON.stringify({url: location.href, currentRole: uni.getStorageSync('currentRole'), taskCards: document.querySelectorAll('.task-card').length})) }" 2>&1 | grep -A 2 "### Result"

run "5. 「客户称已付」标记是否渲染出来"
timeout 250 playwright-cli run-code "async page => { const r = await page.evaluate(() => { const tags = [...document.querySelectorAll('.cargo-claim-tag')]; return JSON.stringify({ tagCount: tags.length, tagTexts: tags.map(t=>t.innerText), containers: tags.map(t=>{ const item = t.closest('.cargo-item'); const card = t.closest('.task-card'); const done = t.closest('.done-section'); return { cargoItem: item ? item.innerText.split('\n')[0] : null, task: card ? card.querySelector('.tc-route') ? card.querySelector('.tc-route').innerText : null : null, section: done ? 'done' : 'active' } }), claimedButNoTag: [...document.querySelectorAll('.cargo-item')].filter(i => !i.querySelector('.cargo-claim-tag')).length }) }); const first = page.locator('.cargo-claim-tag').first(); if (await first.count()) { await first.scrollIntoViewIfNeeded(); await page.waitForTimeout(800) } return r }" 2>&1 | grep -A 2 "### Result"

run "6. screenshot (viewport, 标记所在处)"
timeout 200 playwright-cli run-code "async page => { await page.screenshot({path:'$SHOTS/41-courier-claim-tag.png'}); return 'shot' }" 2>&1 | tail -2

run "7. close browser"
timeout 120 playwright-cli close 2>&1 | tail -2

echo ""
echo "=== screenshots ==="
ls -la "$SHOTS" | grep 41-
