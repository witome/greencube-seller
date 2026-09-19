async page => {
  // Card-F front-end E2E on the courier report page (subpkg-courier/pages/report).
  // WARNING: this file must stay pure ASCII (Chinese text is \uXXXX-escaped).
  // It is passed as argv via `playwright-cli run-code "$(cat <this file>)"`, and Git Bash
  // converts argv to the system code page when spawning native programs,
  // so literal Chinese here would be mangled and typed into the form incorrectly.
  const H5 = 'http://localhost:5199';
  const ORDER_ID = 976;
  const PHOTO1 = 'C:/Users/Administrator/AppData/Local/Temp/cardf/real-photo-1.jpg';
  const PHOTO2 = 'C:/Users/Administrator/AppData/Local/Temp/cardf/real-photo-2.jpg';
  const SHOTS = 'C:/Users/Administrator/AppData/Local/Temp/cardf/shots';
  // "卡F E2E：到货不足，附真实尺寸现场照片"
  const DESC = '\u5361F E2E\uFF1A\u5230\u8D27\u4E0D\u8DB3\uFF0C\u9644\u771F\u5B9E\u5C3A\u5BF8\u73B0\u573A\u7167\u7247';
  const UPLOADING = '\u4E0A\u4F20\u4E2D'; // "上传中"

  const out = { steps: [], errors: [] };
  const step = (s) => { out.steps.push(s); console.log('[step] ' + s); };

  try {
    // 1. login as courier (mock: devRole=courier -> openid dev_courier)
    await page.goto(H5 + '/');
    await page.evaluate(() => {
      localStorage.setItem('devRole', 'courier');
      localStorage.removeItem('token');
      localStorage.removeItem('currentRole');
    });
    await page.goto(H5 + '/');
    await page.waitForTimeout(2500);
    step('login page ready');
    await page.click('.wx-btn');
    await page.waitForTimeout(3000);
    out.afterLoginUrl = page.url();
    step('clicked wx-login, url=' + page.url());

    // 2. open the report page with orderId
    await page.goto(H5 + '/#/subpkg-courier/pages/report?orderId=' + ORDER_ID);
    await page.waitForSelector('textarea', { timeout: 20000 });
    await page.waitForTimeout(2500);
    out.reportUrl = page.url();
    step('report page ready, url=' + page.url());

    // 3. fill the description
    await page.fill('textarea', DESC);
    await page.waitForTimeout(400);

    // 4. tap the photo row (the real uni.chooseImage path) and hand the file to Playwright
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 20000 }),
      page.click('.fr-l'),
    ]);
    step('file chooser opened, injecting real 1.55MB photo');
    await chooser.setFiles(PHOTO1);

    // 5. wait for the thumbnail (uni <image> renders as <img> in H5, src -> /uploads/)
    await page.waitForSelector('img[src*="/uploads/"]', { timeout: 90000 });
    await page.waitForTimeout(2000);
    out.thumbSrc = await page.locator('img[src*="/uploads/"]').first().getAttribute('src');
    out.thumbCount = await page.locator('img[src*="/uploads/"]').count();
    out.uploadingTipGone = !(await page.locator('.fr-l').innerText()).includes(UPLOADING);
    step('thumbnail appeared: ' + out.thumbSrc);
    await page.screenshot({ path: SHOTS + '/11-report-thumbnail.png' });

    // 6. take a second one -> multiple photos
    const [chooser2] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 20000 }),
      page.click('.fr-l'),
    ]);
    await chooser2.setFiles(PHOTO2);
    await page.waitForFunction(() => document.querySelectorAll('img[src*="/uploads/"]').length >= 2, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    out.thumbCountAfter2 = await page.locator('img[src*="/uploads/"]').count();
    step('multiple ok, thumbnails=' + out.thumbCountAfter2);
    await page.screenshot({ path: SHOTS + '/12-two-thumbnails.png' });

    // 7. remove one -> deletable
    await page.locator('.photo-del').first().click();
    await page.waitForTimeout(1200);
    out.thumbCountAfterRemove = await page.locator('img[src*="/uploads/"]').count();
    step('remove ok, remaining=' + out.thumbCountAfterRemove);
    await page.screenshot({ path: SHOTS + '/13-after-remove.png' });

    // 8. submit and capture the request body (proves photos are sent with the form)
    const reqs = [];
    page.on('request', (r) => {
      if (r.url().includes('/courier/report')) reqs.push(r.postData());
    });
    await page.click('.pbtn.primary');
    await page.waitForTimeout(5000);
    out.reportRequestBody = reqs[0] || null;
    out.afterSubmitUrl = page.url();
    await page.screenshot({ path: SHOTS + '/14-submitted.png' });
    step('submitted, request body = ' + (reqs[0] || '(not captured)'));
  } catch (e) {
    out.errors.push(String(e && e.message ? e.message : e));
    try { await page.screenshot({ path: SHOTS + '/99-error.png' }); } catch (x) {}
    console.log('[error] ' + (e && e.message ? e.message : e));
  }
  return JSON.stringify(out, null, 2);
}
