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

    await test('Tab/Esc 2회 왕복 뒤 대시보드 native 크기와 검색 선택영역 보존', async () => {
      await page.locator('.td-command input').press('Tab');
      await page.locator('#cf-dashboard-panel').waitFor();
      await page.locator('.td-main h1').filter({ hasText: 'Dashboard' }).waitFor();
      await waitUntil(async () => (await bounds()).width >= 800, '대시보드 native 창이 확장되지 않았습니다.');
      const initial = await bounds();
      measurements.dashboardBounds = { initial, returns: [] };
      await noPersistentKeycaps('대시보드');
      await screenshot('03-dashboard');
      for (let round = 1; round <= 2; round++) {
        await page.keyboard.press('Escape');
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
      await page.keyboard.press('Escape');
      await commandRestored('123+456', [1, 4]);
      await waitUntil(async () => (await bounds()).width === 560, 'Command 복귀 후 native 창 너비가 복원되지 않았습니다.');
    });

    await test('일정 초안 위 도움말: Esc는 도움말만 닫고 모달·제목·caret 유지', async () => {
      await page.locator('.td-command input').press('Tab');
      await page.locator('.td-nav [data-action=calendar]').click();
      await page.locator('.td-main-head [data-action=new-event]').click();
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

      await page.keyboard.press('Alt+s');
      const skin = page.locator('[data-look=skin]');
      const mode = page.locator('[data-look=mode]');
      await skin.waitFor();
      await mode.waitFor();
      assert.equal(await page.locator('#cf-dashboard-panel').isVisible(), true);
      assert.equal(await page.locator('.td-chrome [data-look]').count(), 0);
      const originalMode = (await call('preferences.get')).mode;
      await skin.selectOption('paper');
      await waitUntil(async () => (await call('preferences.get')).skin === 'paper', '스킨 변경이 저장되지 않았습니다.');
      assert.equal((await call('preferences.get')).mode, originalMode, '스킨 변경이 모드까지 바꿨습니다.');
      await mode.selectOption('dark');
      await waitUntil(async () => (await call('preferences.get')).mode === 'dark', '다크 모드 변경이 저장되지 않았습니다.');
      assert.equal((await call('preferences.get')).skin, 'paper');
      assert.deepEqual(durableData(await call('state', {})), before);
      assert.equal(await page.locator('.td-app').getAttribute('data-skin'), 'paper');
      assert.equal(await page.locator('.td-app').evaluate(element => element.style.colorScheme), 'dark');
      await noPersistentKeycaps('설정 다크 모드');
      await screenshot('06-settings-paper-dark');

      await skin.selectOption('ink');
      await waitUntil(async () => (await call('preferences.get')).skin === 'ink', '잉크 스킨 변경이 저장되지 않았습니다.');
      assert.equal((await call('preferences.get')).mode, 'dark');
      await mode.selectOption('light');
      await waitUntil(async () => (await call('preferences.get')).mode === 'light', '라이트 모드 변경이 저장되지 않았습니다.');
      assert.equal((await call('preferences.get')).skin, 'ink');
      assert.deepEqual(durableData(await call('state', {})), before);
      await screenshot('07-settings-ink-light');

      await page.locator('[data-action=help]').click();
      await page.locator('.minimal-help-layer').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.minimal-help-layer').waitFor({ state: 'hidden' });
      assert.equal(await skin.isVisible(), true, '설정의 도움말을 닫으면 설정 화면이 유지돼야 합니다.');
      // 화면 기본 자리가 아니면 Esc는 먼저 그 자리로 돌아오고, 기본 자리에서 한 번 더 누르면 Command로 간다.
      await page.keyboard.press('Escape');
      await waitUntil(() => skin.evaluate(element => element === document.activeElement), 'Esc가 설정의 기본 자리로 돌아가지 않았습니다.');
      await page.keyboard.press('Escape');
      await commandRestored('123+456', [1, 4]);
      await page.locator('.td-command input').press('Tab');
      await page.locator('.td-nav > [data-action=work]').click();
      await page.locator('.td-main > .td-work-nav [data-tab=todo]').click();
      await page.locator('.td-task-open[data-task]').filter({ hasText: finalTitle }).click();
      assert.equal(await page.locator('[data-field=title]').inputValue(), finalTitle);
      assert.equal(await page.locator('[data-field=note]').inputValue(), finalNote);
      assert.equal(await page.locator('[data-field=project_id]').inputValue(), String(projectId));
      assert.equal(await page.locator('[data-field=due]').inputValue(), today);
      await noPersistentKeycaps('외관 변경 후 할 일');
      await screenshot('08-task-restored');
      await page.locator('[data-field=note]').press('Control+k');
      await page.locator('.td-command input').fill('');
      await waitUntil(async () => (await bounds()).height === 54, '도움말·설정 이후 빈 Command 높이가 54px로 복원되지 않았습니다.');
      await noPersistentKeycaps('최종 Command');
      await screenshot('09-command-ink-light');
      await page.locator('.td-command input').press('Tab');
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
