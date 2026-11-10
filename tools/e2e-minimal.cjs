/* 실제 Electron 앱의 미니멀 UI 회귀 검사. 기존 사용자 데이터와 분리된 프로필을 사용한다. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const runId = String(Date.now());
const output = path.join(root, 'test-output');
const dataDir = path.join(output, 'minimal-profile-' + runId);
const shots = path.join(output, 'minimal-shots', runId);
const packaged = process.env.WHENDESK_TEST_PACKAGED === '1';
const reportPath = path.join(output, packaged ? 'e2e-minimal-packaged.json' : 'e2e-minimal.json');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
fs.mkdirSync(shots, { recursive: true });

const results = [], errors = [], screenshots = [];
const measurements = {};
let app, page, failure = null, info = null;

async function launch() {
  app = await electron.launch({
    executablePath: process.env.WHENDESK_TEST_EXECUTABLE || 'D:/when630/whencommand/node_modules/electron/dist/electron.exe',
    args: [...(packaged ? [] : [root]), '--test', '--no-media', '--data-dir=' + dataDir],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.desk?.call && document.querySelector('.td-command input') === document.activeElement);
}

function call(method, payload) {
  return page.evaluate(async ({ method, payload }) => window.desk.call(method, payload), { method, payload });
}

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 12000;
  do {
    if (await predicate()) return;
    await page.waitForTimeout(80);
  } while (Date.now() < deadline);
  assert.fail(message);
}

function bounds() {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
}

async function screenshot(name) {
  const file = path.join(shots, name + '.png');
  await page.screenshot({ path: file });
  screenshots.push(file);
}

async function test(name, action) {
  const started = Date.now();
  try {
    await action();
    results.push({ name, ok: true, durationMs: Date.now() - started });
  } catch (error) {
    results.push({ name, ok: false, durationMs: Date.now() - started, error: error.message });
    throw error;
  }
}

async function noPersistentKeycaps(screen) {
  const visible = await page.evaluate(() => [...document.querySelectorAll('kbd')]
    .filter(element => !element.closest('.minimal-help-layer,.td-hints'/* 하단 상황 힌트는 상시 표시 */) && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
    .map(element => element.textContent.trim()));
  assert.deepEqual(visible, [], screen + '에 단축키 키캡이 상시 노출됩니다.');
}

async function commandRestored(value, selection) {
  await page.locator('.minimal-help-layer').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('.td-command input') === document.activeElement);
  const input = page.locator('.td-command input');
  assert.equal(await input.inputValue(), value);
  assert.deepEqual(await input.evaluate(element => [element.selectionStart, element.selectionEnd]), selection);
  assert.equal(await input.evaluate(element => element === window.__minimalCommandNode), true, '도움말이나 화면 전환이 검색 입력 DOM을 교체했습니다.');
  assert.equal(await page.locator('#cf-command-panel').isVisible(), true);
  assert.equal(await page.locator('#cf-dashboard-panel').isVisible(), false);
}

function durableData(state) {
  return {
    tasks: state.tasks.map(({ id, title, kind, project_id, due, note, waitingFor, done, deleted }) => ({ id, title, kind, project_id, due, note, waitingFor, done, deleted })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    projects: state.projects.map(({ id, name }) => ({ id, name })).sort((a, b) => a.id - b.id),
    events: state.events.map(({ id, title, date, time, end, allDay, location, note }) => ({ id, title, date, time, end, allDay, location, note })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}

(async () => {
  try {
    await launch();
    info = await call('app.info');
    if (packaged) assert.equal(info.isPackaged, true);

    await test('빈 Command: 실제 preload·격리된 저장소·560×54 크기·키캡 없음', async () => {
      const state = await call('state', {});
      assert.equal(state.tasks.length, 0);
      assert.equal(state.events.length, 0);
      assert.equal(await page.locator('.td-command input').inputValue(), '');
      assert.equal(await page.locator('#cf-dashboard-panel').isVisible(), false);
      assert.equal(await page.locator('.td-footer').isVisible(), false, '미디어와 저장 작업이 없으면 footer를 숨겨야 합니다.');
      await waitUntil(async () => (await bounds()).height === 54, '빈 Command의 native 창 높이가 54px로 줄지 않았습니다.');
      assert.equal((await bounds()).width, 560);
      await noPersistentKeycaps('빈 Command');
      await screenshot('01-command-empty');
    });

    await test('Ctrl+/ 도움말: 토글·닫기 버튼·Esc 이후 검색값과 caret 보존', async () => {
      const input = page.locator('.td-command input');
      await input.fill('123+456');
      await page.waitForFunction(() => document.querySelector('.td-command-results')?.textContent.includes('579'));
      await input.evaluate(element => { window.__minimalCommandNode = element; element.setSelectionRange(1, 4); });
      await input.press('Control+Slash');
      await page.locator('.minimal-help-layer .minimal-help[role=dialog]').waitFor();
      assert.ok(await page.locator('.minimal-help-layer kbd').count() > 0, '단축키는 도움말 안에서 보여야 합니다.');
      await noPersistentKeycaps('도움말 바깥');
      await screenshot('02-command-help');

      await page.keyboard.press('Control+Slash');
      await commandRestored('123+456', [1, 4]);
      await input.press('Control+Slash');
      await page.locator('.minimal-help-layer [data-action=close-help]').click();
      await commandRestored('123+456', [1, 4]);
      await input.press('Control+Slash');
      await page.locator('.minimal-help-layer').waitFor();
      await page.keyboard.press('Escape');
      await commandRestored('123+456', [1, 4]);
      await noPersistentKeycaps('도움말을 닫은 Command');
    });

    await test('Tab/Ctrl+K 2회 왕복 뒤 대시보드 native 크기와 검색 선택영역 보존', async () => {
      await page.locator('.td-command input').press('Tab');
      await page.locator('#cf-dashboard-panel').waitFor();
      await page.locator('.td-main h1').filter({ hasText: 'Dashboard' }).waitFor();
      await waitUntil(async () => (await bounds()).width >= 800, '대시보드 native 창이 확장되지 않았습니다.');
      const initial = await bounds();
      measurements.dashboardBounds = { initial, returns: [] };
      await noPersistentKeycaps('대시보드');
      await screenshot('03-dashboard');
      for (let round = 1; round <= 2; round++) {
        // 대시보드의 Esc는 창을 숨기므로, 검색어를 지닌 채 돌아가는 왕복은 Ctrl+K로 한다.
        await page.keyboard.press('Control+k');
        await commandRestored('123+456', [1, 4]);
        await waitUntil(async () => (await bounds()).width === 560, 'Command 복귀 후 native 창 너비가 복원되지 않았습니다.');
        await page.locator('.td-command input').press('Tab');
        await page.locator('#cf-dashboard-panel').waitFor();
        await waitUntil(async () => {
          const current = await bounds();
          return current.width === initial.width && current.height === initial.height;
        }, `${round}회 왕복 후 대시보드 너비와 높이가 최초 크기로 복원되지 않았습니다.`);
        const returned = await bounds();
        measurements.dashboardBounds.returns.push(returned);
        assert.deepEqual({ width: returned.width, height: returned.height }, { width: initial.width, height: initial.height });
      }
      await page.keyboard.press('Control+k');
      await commandRestored('123+456', [1, 4]);
      await waitUntil(async () => (await bounds()).width === 560, 'Command 복귀 후 native 창 너비가 복원되지 않았습니다.');
    });

    await test('일정 초안 위 도움말: Esc는 도움말만 닫고 모달·제목·caret 유지', async () => {
      await page.locator('.td-command input').press('Tab');
      await page.locator('.td-nav [data-action=calendar]').click();
      await page.locator('.td-main-head [data-action=new-event]').click();await page.locator('.quick-event-form input').waitFor();await page.keyboard.press('Control+Enter');
      const form = page.locator('.event-form');
      const title = form.locator('[name=title]');
      const draft = '아직 저장하지 않은 일정 제목';
      await title.fill(draft);
      await title.evaluate(element => {
        window.__minimalEventTitle = element;
        window.__minimalEventForm = element.closest('form');
        element.setSelectionRange(2, 9);
      });
      await noPersistentKeycaps('일정 모달');
      await title.press('Control+Slash');
      await page.locator('.minimal-help-layer').waitFor();
      assert.equal(await form.isVisible(), true);
      await screenshot('04-event-draft-help');
      await page.keyboard.press('Escape');
      await page.locator('.minimal-help-layer').waitFor({ state: 'hidden' });
      assert.equal(await form.isVisible(), true, '도움말 Esc가 기존 일정 모달까지 닫았습니다.');
      assert.equal(await title.inputValue(), draft);
      assert.equal(await title.evaluate(element => element === window.__minimalEventTitle && element.closest('form') === window.__minimalEventForm && document.activeElement === element), true);
      assert.deepEqual(await title.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 9]);
      assert.equal((await call('state', {})).events.length, 0, '도움말 사용 중 미저장 일정이 저장됐습니다.');
      await screenshot('05-event-draft-restored');
      await noPersistentKeycaps('도움말을 닫은 일정 모달');
      await page.keyboard.press('Escape');
      assert.equal(await form.isVisible(), true, '입력한 일정 초안을 Esc 한 번에 버렸습니다.');
      assert.match(await page.locator('.td-feedback').innerText(), /한 번 더/, '초안을 버리기 전에 안내해야 합니다.');
      await page.keyboard.press('Escape');
      await form.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#cf-dashboard-panel').isVisible(), true, '일정 모달의 Esc가 대시보드까지 접었습니다.');
    });

    await test('저장 대기 중 도움말·스킨과 모드 변경에서 실제 데이터와 입력 상태 보존', async () => {
      const project = await call('mutate', { type: 'project.create', payload: { name: '미니멀 검증 프로젝트' } });
      const projectId = project.id ?? project;
      const created = await call('mutate', { type: 'task.create', payload: { title: '미니멀 검증용 할 일' } });
      const taskId = created.id ?? created;
      const date = new Date();
      const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      await call('mutate', { type: 'task.update', payload: { id: taskId, kind: 'todo', project_id: projectId, due: today } });
      await call('mutate', { type: 'event.create', payload: { title: '스킨 보존 확인용 일정', date: today, time: '09:00', end: '10:00', allDay: false, location: '테스트 위치', note: '외관을 변경해도 유지할 일정 내용' } });

      await page.locator('.td-nav > [data-action=work]').click();
      await page.locator('.td-main > .td-work-nav [data-tab=todo]').click();
      await page.locator('.td-task-open[data-task]').filter({ hasText: '미니멀 검증용 할 일' }).click();
      const note = page.locator('[data-field=note]');
      const finalTitle = '스킨 변경 후에도 남을 제목';
      const finalNote = '스킨을 바꿔도 유지할 작성 내용';
      await page.locator('[data-field=title]').fill(finalTitle);
      await note.fill(finalNote);
      const pendingStatus = await note.evaluate(element => {
        window.__minimalPendingNote = element;
        element.setSelectionRange(2, 9);
        return document.querySelector('.td-footer > span')?.textContent;
      });
      assert.equal(pendingStatus, '저장 중…', '저장 대기 상태에서 도움말 검사를 시작해야 합니다.');
      await note.press('Control+Slash');
      await page.locator('.minimal-help-layer').waitFor();
      await page.waitForTimeout(700);
      assert.equal((await call('state', {})).tasks.find(task => task.id === taskId).note, finalNote, '도움말이 열린 동안 대기 중 내용이 저장되지 않았습니다.');
      await page.keyboard.press('Escape');
      await page.locator('.minimal-help-layer').waitFor({ state: 'hidden' });
      assert.equal(await note.evaluate(element => element === window.__minimalPendingNote && document.activeElement === element), true, '저장 완료 중 도움말이 note DOM이나 입력 포커스를 교체했습니다.');
      assert.equal(await note.inputValue(), finalNote);
      assert.deepEqual(await note.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 9]);
      await note.press('Control+k');
      await page.waitForFunction(() => document.querySelector('.td-command input') === document.activeElement);
      const before = durableData(await call('state', {}));
      const savedTask = before.tasks.find(task => task.id === taskId);
      assert.equal(savedTask.title, finalTitle);
      assert.equal(savedTask.note, finalNote);
      assert.equal(savedTask.project_id, projectId);
      assert.equal(savedTask.due, today);

      await page.keyboard.press('Control+Comma');
      const cards = page.locator('[data-theme-pick]');
      await cards.first().waitFor();
      assert.equal(await cards.count(), 9, '테마 카드는 WHENTERMINAL zen 테마 9개여야 합니다.');
      assert.equal(await page.locator('#cf-dashboard-panel').isVisible(), true);
      assert.equal(await page.locator('[data-look]').count(), 0, '옛 스킨·모드 선택이 남아 있습니다.');
      assert.equal(await page.locator('[data-theme-pick][aria-checked=true]').count(), 1);
      await page.locator('[data-theme-pick=zen-dim]').click();
      await waitUntil(async () => (await call('preferences.get')).theme === 'zen-dim', '테마 변경이 저장되지 않았습니다.');
      assert.equal((await call('preferences.get')).mode, 'dark', '어두운 테마가 화면 모드를 바꾸지 않았습니다.');
      assert.deepEqual(durableData(await call('state', {})), before);
      assert.equal(await page.locator('.td-app').getAttribute('data-theme'), 'zen-dim');
      assert.equal(await page.locator('.td-app').evaluate(element => getComputedStyle(element).colorScheme), 'dark');
      assert.equal(await page.locator('[data-theme-pick=zen-dim]').getAttribute('aria-checked'), 'true');
      await noPersistentKeycaps('설정 테마');
      await screenshot('06-settings-dim');

      // 라디오 묶음: 화살표로 옆 테마를 바로 고른다
      await page.locator('[data-theme-pick=zen-dim]').focus();
      await page.keyboard.press('Home');
      await waitUntil(async () => (await call('preferences.get')).theme === 'zen-sage', 'Home으로 첫 테마가 골라지지 않았습니다.');
      await page.keyboard.press('ArrowRight');
      await waitUntil(async () => (await call('preferences.get')).theme === 'zen-paper', '→로 다음 테마가 골라지지 않았습니다.');
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.themePick), 'zen-paper');
      assert.equal((await call('preferences.get')).mode, 'light');
      assert.deepEqual(durableData(await call('state', {})), before);
      await screenshot('07-settings-paper');

      // 스킨: 처음 고르면 그 스킨의 첫 테마, 다른 스킨에 갔다 돌아오면 마지막 테마를 되살린다
      await page.locator('[data-skin-pick=tui]').click();
      await waitUntil(async () => (await call('preferences.get')).theme === 'tui-night', 'TUI 스킨의 첫 테마로 바뀌지 않았습니다.');
      assert.equal(await page.locator('.td-app').getAttribute('data-skin'), 'tui');
      assert.equal(await page.locator('[data-theme-pick]').count(), 4, 'TUI 스킨의 테마 4개가 보여야 합니다.');
      assert.equal((await call('preferences.get')).mode, 'dark');
      await page.locator('[data-theme-pick=tui-paper]').click();
      await waitUntil(async () => (await call('preferences.get')).theme === 'tui-paper', 'TUI 테마 변경이 저장되지 않았습니다.');
      await page.locator('[data-skin-pick=zen]').focus();
      await page.keyboard.press('ArrowRight');
      await waitUntil(async () => (await call('preferences.get')).skin === 'poster', '→로 다음 스킨이 골라지지 않았습니다.');
      assert.equal((await call('preferences.get')).theme, 'poster-white');
      await page.locator('[data-skin-pick=tui]').click();
      await waitUntil(async () => (await call('preferences.get')).theme === 'tui-paper', '돌아온 스킨의 마지막 테마를 되살리지 않았습니다.');
      for (const skin of ['soft', 'glass', 'ide', 'sketch', 'poster', 'tui']) {
        await page.locator(`[data-skin-pick=${skin}]`).click();
        await waitUntil(async () => (await call('preferences.get')).skin === skin, skin + ' 스킨 변경이 저장되지 않았습니다.');
        await screenshot('07-skin-' + skin);
        await page.evaluate(section=>window.__whendeskGo(section),'dashboard');
        await page.locator('.td-main h1').filter({ hasText: 'Dashboard' }).waitFor();
        await screenshot('07-skin-' + skin + '-dashboard');
        await page.keyboard.press('Control+k');
        await page.waitForFunction(() => document.activeElement === document.querySelector('.td-command input'));
        const kept = await page.locator('.td-command input').inputValue();
        const keptRange = await page.locator('.td-command input').evaluate(element => [element.selectionStart, element.selectionEnd]);
        await page.keyboard.press('Control+a'); await page.keyboard.insertText('스킨');
        await page.locator('.td-command-result').first().waitFor();
        await page.waitForFunction(() => innerHeight > 60, null, { timeout: 3000 }).catch(() => {});
        await screenshot('07-skin-' + skin + '-command');
        await page.keyboard.press('Control+a');
        if (kept) await page.keyboard.insertText(kept); else await page.keyboard.press('Backspace');
        await page.locator('.td-command input').evaluate((element, [start, end]) => element.setSelectionRange(start, end), keptRange);
        await page.keyboard.press('Control+Comma');
        await page.locator('[data-skin-pick]').first().waitFor();
      }
      // 앱 아이콘: 6개 중 하나를 고르면 저장되고, 화살표로 옆 아이콘을 바로 고른다
      assert.equal(await page.locator('[data-icon-pick]').count(), 6);
      assert.equal(await page.locator('[data-icon-pick=brand]').getAttribute('aria-checked'), 'true');
      assert.equal(await page.locator('[data-icon-pick] img').first().evaluate(image => image.complete && image.naturalWidth > 0), true, '아이콘 미리보기 이미지가 보이지 않습니다.');
      await page.locator('[data-icon-pick=wordmark]').click();
      await waitUntil(async () => (await call('preferences.get')).appIcon === 'wordmark', '앱 아이콘 변경이 저장되지 않았습니다.');
      await page.keyboard.press('ArrowRight');
      await waitUntil(async () => (await call('preferences.get')).appIcon === 'command', '→로 다음 아이콘이 골라지지 않았습니다.');
      await screenshot('07-app-icon');
      await page.locator('[data-icon-pick=brand]').click();
      await waitUntil(async () => (await call('preferences.get')).appIcon === 'brand', '기본 아이콘으로 돌아가지 않았습니다.');
      await page.locator('[data-skin-pick=zen]').click();
      await waitUntil(async () => (await call('preferences.get')).theme === 'zen-paper', 'ZEN의 마지막 테마를 되살리지 않았습니다.');
      assert.deepEqual(durableData(await call('state', {})), before);

      await page.locator('[data-settings-tab=shortcuts]').click();
      await page.locator('[data-action=help]').click();
      await page.locator('.minimal-help-layer').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.minimal-help-layer').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('[data-shortcut=hotkey]').isVisible(), true, '설정의 도움말을 닫으면 설정 화면이 유지돼야 합니다.');
      // 화면 기본 자리가 아니면 Esc는 먼저 그 자리로 돌아온다(기본 자리에서 한 번 더 누르면 창을 숨긴다). 검색어를 지닌 채 Command로는 Ctrl+K.
      await page.keyboard.press('Escape');
      await waitUntil(() => page.evaluate(() => document.activeElement?.matches('[data-settings-tab][aria-selected=true]')), 'Esc가 설정의 기본 자리로 돌아가지 않았습니다.');
      assert.equal(await page.locator('#cf-dashboard-panel').isVisible(), true, '기본 자리로 돌아오는 Esc가 창을 숨겼습니다.');
      await page.keyboard.press('Control+k');
      await commandRestored('123+456', [1, 4]);
      await page.locator('.td-command input').press('Tab');
      await page.locator('.td-nav > [data-action=work]').click();
      await page.locator('.td-main > .td-work-nav [data-tab=todo]').click();
      await page.locator('.td-task-open[data-task]').filter({ hasText: finalTitle }).click();
      assert.equal(await page.locator('[data-field=title]').inputValue(), finalTitle);
      assert.equal(await page.locator('[data-field=note]').inputValue(), finalNote);
      assert.equal(await page.locator('[data-field=project_id]').getAttribute('value'), String(projectId));
      assert.equal(await page.locator('[data-field=due]').inputValue(), today);
      await noPersistentKeycaps('외관 변경 후 할 일');
      await screenshot('08-task-restored');
      await page.locator('[data-field=note]').press('Control+k');
      await page.locator('.td-command input').fill('');
      await waitUntil(async () => (await bounds()).height === 54, '도움말·설정 이후 빈 Command 높이가 54px로 복원되지 않았습니다.');
      await noPersistentKeycaps('최종 Command');
      await screenshot('09-command-ink-light');
      await page.locator('.td-command input').press('Tab');
      // 대시보드로 돌아오면 편집 대화상자가 그대로 열려 있다. Esc로 닫고 메뉴로 간다.
      await page.locator('.task-form').waitFor();await page.keyboard.press('Escape');await page.locator('.task-form').waitFor({ state: 'detached' });
      await page.locator('.td-nav [data-action=home]').click();
      await page.locator('.td-main h1').filter({ hasText: 'Dashboard' }).waitFor();
      await page.locator('.cf-home-task').filter({ hasText: finalTitle }).waitFor();
      await noPersistentKeycaps('데이터가 있는 대시보드');
      await screenshot('10-dashboard-with-data');
    });

    assert.deepEqual(errors, [], 'renderer에 처리되지 않은 오류가 발생했습니다.');
  } catch (error) {
    failure = { message: error.message, stack: error.stack };
    if (page) await screenshot('failure').catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    const report = { results, errors, failure, dataDir, packaged, info, measurements, screenshots };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, reportPath }));
    if (app) await app.close().catch(() => {});
  }
})();
