#!/usr/bin/env bash
# Card-I browser E2E (playwright-cli): buyer "my aftersales" must SHOW the photos
# submitted in the earlier card (aftersale_order.attachments), and tapping a thumbnail
# must open the big-image preview. No-photo rows must render no empty box.
#
# Reuses the card-F recipe:
#   - identity written with uni's OWN storage API (uni.setStorageSync) -- raw localStorage
#     is invisible to uni.getStorageSync in uni-app H5 (namespaced storage)
#   - navigate via location.hash (no full reload) so App.vue onLaunch cannot swap identity
#
# One bash invocation on purpose: the playwright-cli daemon dies when the bash command
# that started it ends. Backend(:3001) and H5(:5199) are separate long-lived background tasks.
# ASCII only: any Chinese goes into run-code as \uXXXX escapes (Git Bash mangles argv).
set -uo pipefail

D="C:/Users/Administrator/Documents/绿立方开发/自测证据/aftersale-photo-20260919"
SHOTS="$D/shots"
H5="http://localhost:5199"
mkdir -p "$SHOTS"

DIAG="async page => JSON.stringify({url: page.url(), token: !!uni.getStorageSync('token'), currentRole: uni.getStorageSync('currentRole')})"
run() { echo ""; echo "== $* =="; }

run "1. open browser"
timeout 150 playwright-cli open "$H5/" 2>&1 | tail -2
sleep 4

run "2. identity = buyer via uni storage + clear stale token"
timeout 220 playwright-cli run-code "async page => { await page.goto('$H5/'); await page.waitForFunction(() => typeof uni !== 'undefined', null, {timeout: 30000}); await page.evaluate(() => { uni.setStorageSync('devRole','buyer'); uni.removeStorageSync('token'); uni.removeStorageSync('currentRole') }); await page.goto('$H5/'); await page.waitForFunction(() => typeof uni !== 'undefined', null, {timeout: 30000}); await page.waitForTimeout(1500); return await page.evaluate(() => JSON.stringify({devRole: uni.getStorageSync('devRole'), token: !!uni.getStorageSync('token')})) }" 2>&1 | grep -A 2 "### Result"

run "3. login (WeChat one-tap, mock buyer)"
timeout 150 playwright-cli run-code "async page => { await page.click('.wx-btn'); await page.waitForTimeout(4500); return $DIAG }" 2>&1 | grep -A 2 "### Result"

run "4. open my-aftersales list via hash (no full reload)"
timeout 200 playwright-cli run-code "async page => { await page.evaluate(() => { location.hash = '#/pages/buyer/aftersale-list' }); await page.waitForSelector('.as-card', {timeout: 25000}); await page.waitForTimeout(3000); return await page.evaluate(() => JSON.stringify({url: location.href, currentRole: uni.getStorageSync('currentRole'), cards: document.querySelectorAll('.as-card').length, thumbs: document.querySelectorAll('.as-card img[src*=\"/uploads/\"]').length})) }" 2>&1 | grep -A 2 "### Result"

run "5. thumbnails really decoded (naturalWidth>0) + no empty box on photo-less rows + screenshot"
timeout 240 playwright-cli run-code "async page => { const r = await page.evaluate(() => { const cards = [...document.querySelectorAll('.as-card')]; const imgs = [...document.querySelectorAll('.as-card img[src*=\"/uploads/\"]')]; const noPhoto = cards.filter(c => !c.querySelector('.photo-grid')); return JSON.stringify({ cards: cards.length, cardsWithPhotoGrid: cards.filter(c => c.querySelector('.photo-grid')).length, cardsWithoutPhotoGrid: noPhoto.length, emptyGridsOnPhotolessRows: noPhoto.filter(c => c.querySelector('.photo-grid')).length, thumbs: imgs.length, naturalWidth: imgs.map(i => i.naturalWidth), decodedOk: imgs.filter(i => i.naturalWidth > 0).length, srcs: imgs.map(i => i.src) }) }); await page.screenshot({path:'$SHOTS/21-my-aftersale-photos.png', fullPage: true}); return r }" 2>&1 | grep -A 2 "### Result"

run "6. tap a thumbnail -> big-image preview"
timeout 240 playwright-cli run-code "async page => { await page.locator('.as-card img[src*=\"/uploads/\"]').first().click(); await page.waitForTimeout(2800); const r = await page.evaluate(() => { const cands = ['.uni-preview-image', '.uni-image-preview', '.uni-previewImage', '.uni-swiper-slide img', '.uni-swiper-item img']; let hit = null, cls = null; for (const s of cands) { const el = document.querySelector(s); if (el) { hit = s; cls = el.className; break } } const vis = [...document.querySelectorAll('img')].filter(i => i.getBoundingClientRect().width > 200); return JSON.stringify({ previewHit: hit, previewClass: cls, bigImgs: vis.map(i => ({ src: i.src, w: Math.round(i.getBoundingClientRect().width), naturalWidth: i.naturalWidth })) }) }); await page.screenshot({path:'$SHOTS/22-preview-big.png'}); return r }" 2>&1 | grep -A 2 "### Result"

run "7. close browser"
timeout 120 playwright-cli close 2>&1 | tail -2

echo ""
echo "=== screenshots ==="
ls -la "$SHOTS"
