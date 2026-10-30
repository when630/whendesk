/* 별도 프로필에서 Electron 클립보드 동작을 비교한다. 원문은 출력하지 않는다. */
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const results = [];
(async () => {
  for (const version of ['0.1.0', '0.1.1', 'source']) {
    let app, snapshot;
    const dataDir = path.join(root, 'test-output', 'clipboard-diagnostic-' + version + '-' + Date.now());
    try {
      const source = version === 'source';
      app = await electron.launch({ executablePath: source ? 'D:/when630/whencommand/node_modules/electron/dist/electron.exe' : path.join(root, 'dist', 'WHENDESK-' + version + '-win-x64', 'WHENDESK.exe'), args: [...(source ? [root] : []), '--test', '--no-media', '--data-dir=' + dataDir], env, timeout: 30000 });
      const page = await app.firstWindow();
      await page.waitForFunction(() => window.desk?.call && document.querySelector('.td-command input') === document.activeElement);
      snapshot = await app.evaluate(({ clipboard }) => ({ text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage().toPNG().toString('base64') }));
      const native = await app.evaluate(({ clipboard }) => {
        const sentinel = 'WHENDESK diagnostic only';
        clipboard.writeText(sentinel);
        const value = clipboard.readText();
        return { same: value === sentinel, readLength: value.length, formatCount: clipboard.availableFormats().length };
      });
      const query = await page.evaluate(() => window.desk.call('command.query', { q: '123+456', seq: 100 }));
      const item = query.items.find(item => item.source === 'calc');
      const execution = await page.evaluate(key => window.desk.call('command.run', { key }), item.key);
      await page.waitForTimeout(250);
      const command = await app.evaluate(({ clipboard }) => ({ same: clipboard.readText() === '579', readLength: clipboard.readText().length, formatCount: clipboard.availableFormats().length }));
      const input = page.locator('.td-command input');
      await input.fill('123+456');
      await page.waitForFunction(() => document.querySelector('.td-command-results')?.textContent.includes('579'));
      await input.evaluate(element => element.setSelectionRange(1, 4));
      await input.press('Tab');
      await page.locator('#cf-dashboard-panel').waitFor();
      await page.keyboard.press('Escape');
      await input.fill('123+456');
      await input.press('Enter');
      await page.waitForFunction(() => document.querySelector('.td-feedback')?.textContent.includes('579 복사됨'));
      await page.waitForTimeout(250);
      const ui = await app.evaluate(({ clipboard }) => ({ same: clipboard.readText() === '579', readLength: clipboard.readText().length, formatCount: clipboard.availableFormats().length }));
      results.push({ version, native, command, ui, executionOk: execution.ok, expectedMessage: execution.message === '579 복사됨', dataDir });
    } catch (error) {
      results.push({ version, error: error.message, dataDir }); process.exitCode = 1;
    } finally {
      if (app) {
        if (snapshot) await app.evaluate(({ clipboard, nativeImage }, value) => {
          const data = { text: value.text, html: value.html, rtf: value.rtf };
          if (value.image) data.image = nativeImage.createFromBuffer(Buffer.from(value.image, 'base64'));
          clipboard.write(data);
        }, snapshot).catch(() => {});
        await app.close().catch(() => {});
      }
    }
  }
  fs.writeFileSync(path.join(root, 'test-output', 'clipboard-diagnostic.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
})();
