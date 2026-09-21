#!/usr/bin/env bash
# 卡T 改动后浏览器实操取证（只读页面操作，不写库；写操作一律不做）
set -u
PW="C:/Users/Administrator/AppData/Local/Temp/e2e-cardT"
mkdir -p "$PW"
cd "$PW"
playwright-cli close >/dev/null 2>&1 || true

echo "=== open + login ==="
timeout 180 playwright-cli open "http://localhost:5190/login" || { echo "OPEN FAIL"; exit 1; }
timeout 180 playwright-cli run-code "async page => {
  await page.setViewportSize({width: 1500, height: 1050});
  const code = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/wx-login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({code:'admin'})});
    const j = await res.json();
    localStorage.setItem('admin_token', j.data.token);
    return j.code;
  });
  await page.goto('http://localhost:5190/order');
  await page.waitForSelector('.admin-fulfill-stats', {timeout: 25000});
  await page.waitForTimeout(2500);
  // 待处理视图（默认 status 全部）：取 #61 #87 两单的「金额」列文本（列序：订单号0 餐馆1 送达日2 商品数3 金额4...）
  const grab = async (ids) => {
    const out = {};
    const rows = page.locator('.el-table__body-wrapper tbody tr');
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const tr = rows.nth(i);
      const t = await tr.innerText();
      for (const id of ids) {
        if (t.includes('#' + id + '\t') || new RegExp('^#' + id + '\\\\b').test(t)) {
          out[id] = (await tr.locator('td').nth(4).innerText()).trim();
        }
      }
    }
    return out;
  };
  const pendingAmt = await grab(['61', '87']);
  await page.screenshot({path:'$PW/after-fulfill-pending.png', fullPage: false});
  return JSON.stringify({code, pendingAmt});
}"

echo "=== 履约页：切到「已送达」视图，取种子单金额 ==="
timeout 180 playwright-cli run-code "async page => {
  await page.locator('.admin-fulfill-stat').nth(4).click();
  await page.waitForTimeout(2500);
  const out = {};
  const rows = page.locator('.el-table__body-wrapper tbody tr');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const tr = rows.nth(i);
    const t = await tr.innerText();
    for (const id of ['1290','1291','1293']) {
      if (new RegExp('^#' + id + '\\\\b').test(t)) out[id] = (await tr.locator('td').nth(4).innerText()).trim();
    }
  }
  const total = n;
  await page.screenshot({path:'$PW/after-fulfill-delivered-top.png', fullPage: false});
  return JSON.stringify({totalRows: total, amounts: out});
}"

echo "=== 履约页：#1293 金额列悬浮拆分 ==="
timeout 180 playwright-cli run-code "async page => {
  const rows = page.locator('.el-table__body-wrapper tbody tr');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const tr = rows.nth(i);
    const t = await tr.innerText();
    if (new RegExp('^#' + '1293' + '\\\\b').test(t)) {
      await tr.locator('.amount-cell').hover();
      await page.waitForTimeout(900);
      await page.screenshot({path:'$PW/after-fulfill-tooltip.png', fullPage: false});
      const tip = await page.locator('.el-popper').filter({hasText: '\u5546\u54C1\u91D1\u989D'}).first().innerText().catch(() => null);
      return JSON.stringify({tooltip: tip});
    }
  }
  return JSON.stringify({tooltip: null, note: 'row not found'});
}"

echo "=== 履约页：#1293 明细弹窗（含金额拆分） ==="
timeout 180 playwright-cli run-code "async page => {
  const rows = page.locator('.el-table__body-wrapper tbody tr');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const tr = rows.nth(i);
    const t = await tr.innerText();
    if (new RegExp('^#' + '1293' + '\\\\b').test(t)) {
      await tr.locator('td').nth(10).locator('button').first().click();
      await page.waitForTimeout(1800);
      const box = await page.locator('.detail-amount').innerText().catch(() => null);
      await page.screenshot({path:'$PW/after-fulfill-detail.png', fullPage: false});
      return JSON.stringify({detailAmount: box});
    }
  }
  return JSON.stringify({detailAmount: null});
}"

echo "=== 对账页：汇总卡 + 当天订单清单（默认全部） ==="
timeout 180 playwright-cli run-code "async page => {
  await page.goto('http://localhost:5190/daily-reconciliation?date=2026-09-21');
  await page.waitForSelector('.admin-dailyrec-cards', {timeout: 25000});
  await page.waitForTimeout(2500);
  const cards = await page.locator('.admin-dailyrec-card').allInnerTexts();
  const card1 = page.locator('.admin-dailyrec-table-card').first();
  const rows = card1.locator('.el-table__body-wrapper tbody tr');
  const n = await rows.count();
  // 种子的 4 单收款状态
  const st = {};
  for (let i = 0; i < n; i++) {
    const tr = rows.nth(i);
    const t = await tr.innerText();
    for (const id of ['1290','1291','1292','1293']) {
      if (new RegExp('^#' + id + '\\\\b').test(t)) {
        st[id] = { status: (await tr.locator('td').nth(5).innerText()).trim(),
                   proof: (await tr.locator('td').nth(6).innerText()).trim(),
                   amount: (await tr.locator('td').nth(3).innerText()).trim() };
      }
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({path:'$PW/after-recon-top.png', fullPage: false});
  return JSON.stringify({cards, allRows: n, seedStatus: st});
}"

echo "=== 对账页：滚到种子行（看 4 种收款状态 + 凭证列） ==="
timeout 180 playwright-cli run-code "async page => {
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.admin-dailyrec-table-card')][0].querySelectorAll('.el-table__body-wrapper tbody tr');
    const tr = [...rows].find(r => r.innerText.includes('#1291'));
    if (tr) tr.scrollIntoView({block: 'center'});
  });
  await page.waitForTimeout(1200);
  await page.screenshot({path:'$PW/after-recon-seedrows.png', fullPage: false});
  return JSON.stringify({ok: true});
}"

echo "=== 对账页：点开 #1291 的收款凭证（大图） ==="
timeout 180 playwright-cli run-code "async page => {
  const card1 = page.locator('.admin-dailyrec-table-card').first();
  const row = card1.locator('.el-table__body-wrapper tbody tr').filter({hasText: '#1291'}).first();
  await row.locator('td').nth(6).locator('button').first().click();
  await page.waitForTimeout(2200);
  const title = await page.locator('.el-dialog__title').first().innerText().catch(() => null);
  const imgs = await page.locator('.proof-img').count();
  await page.screenshot({path:'$PW/after-recon-proofdialog.png', fullPage: false});
  return JSON.stringify({dialogTitle: title, proofImgCount: imgs});
}"

echo "=== 对账页：点大图放大预览 ==="
timeout 180 playwright-cli run-code "async page => {
  await page.locator('.proof-img').first().click();
  await page.waitForTimeout(2200);
  const vis = await page.locator('.el-image-viewer__wrapper').isVisible().catch(() => false);
  await page.screenshot({path:'$PW/after-recon-proofviewer.png', fullPage: false});
  return JSON.stringify({viewerVisible: vis});
}"

echo "=== 对账页：关掉弹窗 + 勾选「只看未收款」前后的行数对比 ==="
timeout 180 playwright-cli run-code "async page => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  const card1 = page.locator('.admin-dailyrec-table-card').first();
  const rows = card1.locator('.el-table__body-wrapper tbody tr');
  const before = await rows.count();
  await page.locator('.admin-dailyrec-onlyunpaid .el-checkbox__inner').first().click();
  await page.waitForTimeout(1800);
  const after = await rows.count();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    const rows2 = [...document.querySelectorAll('.admin-dailyrec-table-card')][0].querySelectorAll('.el-table__body-wrapper tbody tr');
    const tr = [...rows2].find(r => r.innerText.includes('#1290'));
    if (tr) tr.scrollIntoView({block: 'center'});
  });
  await page.waitForTimeout(800);
  await page.screenshot({path:'$PW/after-recon-onlyunpaid.png', fullPage: false});
  await page.locator('.admin-dailyrec-onlyunpaid .el-checkbox__inner').first().click();
  await page.waitForTimeout(1200);
  const restored = await rows.count();
  return JSON.stringify({rowsAll: before, rowsOnlyUnpaid: after, rowsAfterUncheck: restored});
}"

echo "=== 对账页：看订单（就地明细） ==="
timeout 180 playwright-cli run-code "async page => {
  const card1 = page.locator('.admin-dailyrec-table-card').first();
  const row = card1.locator('.el-table__body-wrapper tbody tr').filter({hasText: '#1291'}).first();
  await row.locator('td').nth(8).locator('button').first().click();
  await page.waitForTimeout(2200);
  const head = await page.locator('.admin-dailyrec-orderamount').innerText().catch(() => null);
  const pay = await page.locator('.admin-dailyrec-orderpay').innerText().catch(() => null);
  await page.screenshot({path:'$PW/after-recon-orderdetail.png', fullPage: false});
  return JSON.stringify({orderAmount: head, orderPay: pay});
}"

echo "=== 回履约页：从对账页「去履约页」跳转（校验 ?orderId 自动开明细） ==="
timeout 180 playwright-cli run-code "async page => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const card1 = page.locator('.admin-dailyrec-table-card').first();
  const row = card1.locator('.el-table__body-wrapper tbody tr').filter({hasText: '#1292'}).first();
  await row.locator('td').nth(8).locator('button').nth(1).click();
  await page.waitForTimeout(3000);
  const url = page.url();
  const amount = await page.locator('.detail-amount').innerText().catch(() => null);
  await page.screenshot({path:'$PW/after-fulfill-from-recon.png', fullPage: false});
  return JSON.stringify({url, detailAmount: amount});
}"

timeout 120 playwright-cli close
echo "=== done ==="
ls -la "$PW"/after-*.png
