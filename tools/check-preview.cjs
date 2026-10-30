const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const root = page.locator('#whendesk-preview');
  fs.mkdirSync(path.resolve(__dirname, '../docs/previews'), { recursive: true });
  try {
    await page.goto(pathToFileURL(path.resolve(__dirname, '../preview.html')).href);
    await root.locator('.desk-nav [data-view=work]').click();
    await root.locator('[data-tab=inbox]').click();
    await root.locator('[data-promote="1"]').count();
    assert.equal(await root.locator('.desk-work-layout .desk-task-row').count(), 1);
    await root.locator('.desk-nav [data-view=note]').click();
    await root.locator('.desk-editor').fill('스킨을 바꿔도 남는 내용\n#테스트');
    await root.locator('.desk-titlebar [data-look=skin]').selectOption('paper');
    assert.equal(await root.locator('.desk-editor').inputValue(), '스킨을 바꿔도 남는 내용\n#테스트');
    await root.locator('.desk-titlebar [data-look=mode]').selectOption('dark');
    assert.equal(await root.locator('.desk-editor').inputValue(), '스킨을 바꿔도 남는 내용\n#테스트');
    await root.locator('[data-note-task="1"]').click();
    await root.locator('.desk-related[data-task]').last().click();
    await root.locator('[data-schedule]').click();
    assert.ok((await root.locator('.desk-calendar-bottom').textContent()).includes('WHENDESK 작업 공간 후속 작업'));
    await root.locator('.desk-nav [data-view=home]').click();
    await root.locator('[data-meeting-note="1"]').click();
    assert.equal(await root.locator('.desk-editor-title').inputValue(), '디자인 방향 회의록');
    await root.locator('.desk-search').click();
    await root.locator('.desk-overlay input').fill('할 일 추가 검증 작업');
    await root.locator('.desk-overlay input').press('ArrowDown');
    await root.locator('.desk-overlay input').press('ArrowUp');
    await root.locator('.desk-overlay input').press('Enter');
    assert.ok((await root.locator('.desk-work-layout').textContent()).includes('검증 작업'));
    await root.locator('.desk-nav [data-view=command]').click();
    await root.locator('.desk-command-inline .desk-command-input').fill('120 * 3');
    assert.ok((await root.locator('.desk-command-inline .desk-result').first().textContent()).includes('360'));
    const checks = [];
    for (const width of [1024,736,390,320]) {
      await page.setViewportSize({ width, height: 1200 });
      for (const view of ['home','work','note','calendar','command','settings']) {
        await root.locator(`[data-view="${view}"]`).first().click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        assert.equal(overflow, false, `${view} overflows at ${width}`);
        checks.push({ width, view });
      }
    }
    await page.reload(); await page.setViewportSize({ width:1024, height:1000 });
    await root.locator('.desk-titlebar [data-look=skin]').selectOption('base');
    await root.locator('.desk-titlebar [data-look=mode]').selectOption('light');
    await root.locator('[data-view=home]').first().click();
    await root.screenshot({ path:path.resolve(__dirname,'../docs/previews/today.png') });
    for (const view of ['note','calendar','command']) {
      await root.locator(`[data-view=${view}]`).first().click();
      await root.screenshot({ path:path.resolve(__dirname,`../docs/previews/${view}.png`) });
    }
    await root.locator('[data-view=note]').first().click();
    await root.locator('.desk-titlebar [data-look=skin]').selectOption('ink');
    await root.locator('.desk-titlebar [data-look=mode]').selectOption('dark');
    await root.screenshot({ path:path.resolve(__dirname,'../docs/previews/ink-dark.png') });
    assert.deepEqual(errors, []);
    const report = { layoutChecks:checks, interactions:'메모 유지, 스킨/모드, 메모→할 일→일정, 일정→회의록, Command 키보드, 계산', errors };
    fs.writeFileSync(path.resolve(__dirname,'../docs/previews/validation.json'), JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
