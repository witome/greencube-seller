#!/usr/bin/env bash
# Card-F browser E2E v2 via playwright-cli (courier report page: fake camera button -> real upload)
#
# Fixes vs v1:
#   - identity/token now written with uni's OWN storage API (uni.setStorageSync) instead of raw
#     localStorage: uni-app H5 namespaces its storage, so raw localStorage writes are invisible to
#     uni.getStorageSync('devRole') -> the app silently fell back to 'buyer' and lost the courier role.
#   - navigate the report page via hash change (no full reload) so App.vue's onLaunch token
#     re-validation cannot swap the identity mid-flow.
#   - per-step diagnostics (url / token / currentRole / devRole) + in-page XHR log.
#
# One bash invocation on purpose: the playwright-cli daemon dies when the bash command that
# started it ends. Backend(:3001) and H5(:5199) run as separate long-lived background tasks.
# ASCII only: Chinese goes into run-code as \uXXXX escapes (Git Bash mangles argv otherwise).
set -uo pipefail

D="C:/Users/Administrator/AppData/Local/Temp/cardf"
SHOTS="$D/shots"
H5="http://localhost:5199"
ORDER_ID=976
mkdir -p "$SHOTS"

DIAG="async page => JSON.stringify({url: page.url(), token: !!uni.getStorageSync('token'), currentRole: uni.getStorageSync('currentRole'), devRole: uni.getStorageSync('devRole')})"
run() { echo ""; echo "── $* ──"; }

run "1. open browser"
timeout 150 playwright-cli open "$H5/" 2>&1 | tail -2
sleep 4

run "2. set devRole=courier via uni storage + reload + install in-page XHR log"
timeout 200 playwright-cli run-code "async page => { await page.goto('$H5/'); await page.waitForFunction(() => typeof uni !== 'undefined', null, {timeout: 30000}); await page.evaluate(() => { uni.setStorageSync('devRole','courier'); uni.removeStorageSync('token'); uni.removeStorageSync('currentRole') }); await page.goto('$H5/'); await page.waitForFunction(() => typeof uni !== 'undefined', null, {timeout: 30000}); await page.waitForTimeout(2000); await page.evaluate(() => { window.__cardf = []; const ox = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m,u){ this.__u = u; return ox.apply(this, arguments) }; const os = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function(){ this.addEventListener('load', () => { try { window.__cardf.push({u:String(this.__u).replace(/^.*\/api\/v1/,''), status: this.status, body: String(this.responseText||'').slice(0,300)}) } catch(e){} }); return os.apply(this, arguments) } }); return await page.evaluate(() => JSON.stringify({title: document.title, devRole: uni.getStorageSync('devRole'), token: !!uni.getStorageSync('token')})) }" 2>&1 | grep -A 2 "### Result"

run "3. login (WeChat one-tap, mock courier)"
timeout 150 playwright-cli run-code "async page => { await page.click('.wx-btn'); await page.waitForTimeout(4000); return $DIAG }" 2>&1 | grep -A 2 "### Result"

run "4. navigate to report page via hash (no full reload) + orderId=$ORDER_ID"
timeout 150 playwright-cli run-code "async page => { await page.evaluate((oid) => { location.hash = '#/subpkg-courier/pages/report?orderId=' + oid }, '$ORDER_ID'); await page.waitForSelector('.fr-l', {timeout: 20000}); await page.waitForTimeout(2500); const r = await page.evaluate(() => JSON.stringify({url: location.href, token: !!uni.getStorageSync('token'), currentRole: uni.getStorageSync('currentRole'), photoRow: document.querySelector('.fr-l') ? document.querySelector('.fr-l').innerText : null, xhr: window.__cardf})); return r }" 2>&1 | grep -A 2 "### Result"

run "5. fill description (Chinese via unicode escape)"
timeout 150 playwright-cli run-code "async page => { await page.fill('textarea', '\u5361F E2E\uFF1A\u5230\u8D27\u4E0D\u8DB3\uFF0C\u9644\u771F\u5B9E\u5C3A\u5BF8\u73B0\u573A\u7167\u7247'); return await page.inputValue('textarea') }" 2>&1 | grep -A 2 "### Result"

run "6. tap photo row -> native file chooser"
timeout 150 playwright-cli click ".fr-l" 2>&1 | tail -4
sleep 2

run "7. upload REAL 1.55MB photo (3024x4032)"
timeout 180 playwright-cli upload "$D/real-photo-1.jpg" 2>&1 | tail -3
sleep 3

run "8. wait for thumbnail + diagnostics + screenshot"
timeout 240 playwright-cli run-code "async page => { try { await page.waitForSelector('img[src*=\"/uploads/\"]', {timeout: 150000}) } catch(e) { await page.screenshot({path:'$SHOTS/90-no-thumbnail.png'}) } const r = await page.evaluate(() => JSON.stringify({url: location.href, token: !!uni.getStorageSync('token'), currentRole: uni.getStorageSync('currentRole'), thumbs: document.querySelectorAll('img[src*=\"/uploads/\"]').length, firstThumb: (document.querySelector('img[src*=\"/uploads/\"]')||{}).src || null, xhr: window.__cardf})); await page.waitForTimeout(1500); await page.screenshot({path:'$SHOTS/11-report-thumbnail.png'}); return r }" 2>&1 | grep -A 2 "### Result"

run "9. add a second photo (multiple allowed)"
timeout 150 playwright-cli click ".fr-l" 2>&1 | tail -3
sleep 2
timeout 180 playwright-cli upload "$D/real-photo-2.jpg" 2>&1 | tail -3
timeout 240 playwright-cli run-code "async page => { try { await page.waitForFunction(() => document.querySelectorAll('img[src*=\"/uploads/\"]').length >= 2, null, {timeout: 150000}) } catch(e) {} await page.waitForTimeout(1500); const n = await page.locator('img[src*=\"/uploads/\"]').count(); await page.screenshot({path:'$SHOTS/12-two-thumbnails.png'}); return 'thumbnails=' + n }" 2>&1 | grep -A 2 "### Result"

run "10. delete one photo (deletable)"
timeout 200 playwright-cli run-code "async page => { await page.locator('.photo-del').first().click(); await page.waitForTimeout(1500); const n = await page.locator('img[src*=\"/uploads/\"]').count(); await page.screenshot({path:'$SHOTS/13-after-remove.png'}); return 'remaining=' + n }" 2>&1 | grep -A 2 "### Result"

run "11. submit -> capture success toast (flashes ~1.5s) + request body"
timeout 240 playwright-cli run-code "async page => { const bodies = []; page.on('request', r => { if (String(r.url()).includes('/courier/report')) bodies.push(r.postData()) }); await page.locator('.pbtn.primary').click(); await page.waitForTimeout(350); const toast = await page.evaluate(() => { const el = document.querySelector('.uni-toast, .uni-sample-toast'); return el ? el.innerText : null }); await page.screenshot({path:'$SHOTS/14-submitted-toast.png'}); await page.waitForTimeout(3000); await page.screenshot({path:'$SHOTS/15-after-submit.png'}); return JSON.stringify({toast, reportRequestBody: bodies[0] || null, count: bodies.length}) }" 2>&1 | grep -A 2 "### Result"

run "12. close browser"
timeout 120 playwright-cli close 2>&1 | tail -2

echo ""
echo "=== screenshots ==="
ls -la "$SHOTS"
