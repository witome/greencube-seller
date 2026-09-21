#!/usr/bin/env bash
# 卡T 改动前浏览器基线截图（只读页面）
set -u
PW="C:/Users/Administrator/AppData/Local/Temp/e2e-cardT"
mkdir -p "$PW"
cd "$PW"
playwright-cli close >/dev/null 2>&1 || true

echo "=== open ==="
timeout 180 playwright-cli open "http://localhost:5190/login" || { echo "OPEN FAIL"; exit 1; }

echo "=== login + goto reconciliation ==="
timeout 180 playwright-cli run-code "async page => {
  const code = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/wx-login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({code:'admin'})});
    const j = await res.json();
    localStorage.setItem('admin_token', j.data.token);
    return j.code;
  });
  await page.goto('http://localhost:5190/daily-reconciliation');
  await page.waitForSelector('.admin-dailyrec-cards', {timeout: 25000});
  await page.waitForTimeout(3000);
  const cards = await page.locator('.admin-dailyrec-card').allInnerTexts();
  const rows = await page.locator('.admin-dailyrec-table-card').first().locator('tbody tr').count();
  return JSON.stringify({code, url: page.url(), cards, unpaidRows: rows});
}"

echo "=== shot: reconciliation ==="
timeout 180 playwright-cli screenshot --full-page --filename="$PW/before-recon.png"

echo "=== goto fulfill ==="
timeout 180 playwright-cli run-code "async page => {
  await page.goto('http://localhost:5190/order');
  await page.waitForSelector('.admin-fulfill-stats', {timeout: 25000});
  await page.waitForTimeout(2500);
  const stats = await page.locator('.admin-fulfill-stat').allInnerTexts();
  return JSON.stringify({url: page.url(), stats});
}"

echo "=== shot: fulfill ==="
timeout 180 playwright-cli screenshot --full-page --filename="$PW/before-fulfill.png"

timeout 120 playwright-cli close
echo "=== done ==="
ls -la "$PW"/*.png
