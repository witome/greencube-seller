#!/usr/bin/env bash
# 卡Q ① admin-web「申诉处理」页：日期筛选改服务端 E2E
#   证据 = 页面截图 + 页面真实发出的 /admin/appeals 请求 URL（证明带了 startDate/endDate）
# 跑法： bash <本文件绝对路径> <admin_token>
# 说明：admin-web 是普通 Vue 应用（不是 uni-app），token 就在 localStorage.admin_token，
#       故直接注入 token 进 /appeals，跳过后台密码登录。
# ⚠️ run-code 载荷里**不要出现反斜杠**（会被 bash 转义破坏，导致整段 payload 语法错、静默不执行）。
set -uo pipefail

TOKEN="${1:?用法: bash 本脚本 <admin_token>}"
D="C:/Users/Administrator/Documents/绿立方开发/backend/自测证据"
SHOTS="$D/shots-appeals-20260921"
H5="http://localhost:5190"
mkdir -p "$SHOTS"

CAP="const reqs = []; page.on('request', r => { const u = String(r.url()); if (u.includes('/admin/appeals')) reqs.push(u.split('/api/v1').pop()) });"
run() { echo ""; echo "== $* =="; }

run "1. open browser"
timeout 150 playwright-cli open "$H5/" 2>&1 | tail -1
sleep 4

run "2. 注入 admin_token 并进入 /appeals"
timeout 150 playwright-cli run-code "async page => { await page.evaluate(t => { localStorage.setItem('admin_token', t); localStorage.setItem('admin_name', 'E2E') }, '$TOKEN'); await page.goto('$H5/appeals'); await page.waitForSelector('.el-table', {timeout: 25000}); await page.waitForTimeout(2500); return await page.evaluate(() => JSON.stringify({url: location.href, hasToken: !!localStorage.getItem('admin_token')})) }" 2>&1 | tail -3

run "3. 不带日期：点查询 → 抓请求 URL + 行数 + 截图"
timeout 200 playwright-cli run-code "async page => { $CAP await page.locator('.el-button--primary').first().click(); await page.waitForTimeout(2500); const r = await page.evaluate(() => JSON.stringify({ rows: document.querySelectorAll('.el-table__body tbody tr').length, total: (document.querySelector('.el-pagination__total')||{}).innerText || null, dateInputs: [...document.querySelectorAll('.el-date-editor input')].map(i => i.value) })); await page.screenshot({path:'$SHOTS/51-appeals-no-date.png', fullPage: true}); return JSON.stringify({requests: reqs, dom: JSON.parse(r)}) }" 2>&1 | tail -3

run "4. 选 2026-09-01 ~ 2026-09-18（无数据区间）→ 抓请求 URL + 截图"
timeout 240 playwright-cli run-code "async page => { $CAP const inputs = page.locator('.el-date-editor input'); await inputs.nth(0).click(); await inputs.nth(0).fill('2026-09-01'); await page.keyboard.press('Enter'); await page.waitForTimeout(700); await inputs.nth(1).click(); await inputs.nth(1).fill('2026-09-18'); await page.keyboard.press('Enter'); await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(2500); const r = await page.evaluate(() => JSON.stringify({ rows: document.querySelectorAll('.el-table__body tbody tr').length, emptyText: (document.querySelector('.el-table__empty-text')||{}).innerText || null, total: (document.querySelector('.el-pagination__total')||{}).innerText || null, dateInputs: [...document.querySelectorAll('.el-date-editor input')].map(i => i.value) })); await page.screenshot({path:'$SHOTS/52-appeals-range-empty.png', fullPage: true}); return JSON.stringify({requests: reqs, dom: JSON.parse(r)}) }" 2>&1 | tail -3

run "5. 改成 2026-09-19 ~ 2026-09-19（有数据区间）→ 抓请求 URL + 截图"
timeout 240 playwright-cli run-code "async page => { $CAP const inputs = page.locator('.el-date-editor input'); await inputs.nth(0).click(); await inputs.nth(0).fill('2026-09-19'); await page.keyboard.press('Enter'); await page.waitForTimeout(700); await inputs.nth(1).click(); await inputs.nth(1).fill('2026-09-19'); await page.keyboard.press('Enter'); await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(2500); const r = await page.evaluate(() => JSON.stringify({ rows: document.querySelectorAll('.el-table__body tbody tr').length, total: (document.querySelector('.el-pagination__total')||{}).innerText || null, dateInputs: [...document.querySelectorAll('.el-date-editor input')].map(i => i.value) })); await page.screenshot({path:'$SHOTS/53-appeals-range-hit.png', fullPage: true}); return JSON.stringify({requests: reqs, dom: JSON.parse(r)}) }" 2>&1 | tail -3

run "6. close browser"
timeout 120 playwright-cli close 2>&1 | tail -1

echo ""
echo "=== screenshots ==="
ls -la "$SHOTS"
