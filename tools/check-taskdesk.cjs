const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const source = 'C:/Users/forcs/.codex/visualizations/2026/10/29/01a1860c-0520-7d53-936d-87f34eb0196d/whendesk-taskdesk.html';
const out = path.resolve(__dirname, '../docs/taskdesk');
const preview = path.join(out, 'preview.html');
fs.mkdirSync(out, { recursive: true });
const fragment = fs.readFileSync(source, 'utf8');
const lucide = fs.readFileSync('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/lucide/dist/umd/lucide.js', 'utf8');
const harness = '<script>window.openai={setWidgetState:async function(value){window.__qaState=value;}};</script>';
fs.writeFileSync(preview, '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WHENDESK 할 일 데스크 검증</title><style>body{margin:0}[hidden]{display:none!important}</style><body><script>' + lucide + '</script>' + harness + fragment + '</body></html>');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1100 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const root = page.locator('#whendesk-taskdesk');
  const command = root.locator('.td-command input');
  const tests = [], layouts = [];
  async function reset() {
    await page.goto(pathToFileURL(preview).href);
    await page.setViewportSize({ width: 1024, height: 1100 });
  }
  async function test(name, fn) {
    try {
      await reset();
      await fn();
      tests.push({ name, ok: true });
      console.log('PASS ' + name);
    } catch (error) {
      tests.push({ name, ok: false, error: error.message });
      console.log('FAIL ' + name + ': ' + error.message);
      await page.screenshot({ path: path.join(out, 'failure-' + tests.length + '.png'), fullPage: true }).catch(() => {});
    }
  }
  async function retainReferences() {
    await root.locator('[data-field=title]').fill('인라인 제목 편집 검증');
    await root.locator('[data-field=note]').fill('첫 줄 내용\n편집하던 상세 내용을 그대로 유지\n마지막 줄');
    await root.locator('[data-field=note]').evaluate(el => {
      el.focus(); el.setSelectionRange(5, 9); el.scrollTop = 3;
      window.__qaEditor = el;
      window.__qaTitle = document.querySelector('[data-editor="t1"] [data-field=title]');
      window.__qaEditorSnapshot = { value: el.value, start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop };
    });
  }
  async function assertReferences() {
    const metrics = await page.evaluate(() => {
      const el = document.querySelector('[data-editor="t1"] [data-field=note]');
      const title = document.querySelector('[data-editor="t1"] [data-field=title]');
      return {
        sameEditor: el === window.__qaEditor,
        sameTitle: title === window.__qaTitle,
        value: el?.value, start: el?.selectionStart, end: el?.selectionEnd,
        expected: window.__qaEditorSnapshot,
        title: title?.value
      };
    });
    assert.equal(metrics.sameEditor, true, '상세 편집 DOM이 교체되었습니다.');
    assert.equal(metrics.sameTitle, true, '제목 편집 DOM이 교체되었습니다.');
    assert.equal(metrics.value, metrics.expected.value);
    assert.equal(metrics.start, metrics.expected.start);
    assert.equal(metrics.end, metrics.expected.end);
    assert.equal(metrics.title, '인라인 제목 편집 검증');
  }
  try {
    await test('인라인 제목·상세 편집 및 데이터 반영', async () => {
      await retainReferences();
      assert.equal(await root.locator('[data-task-row=t1] [data-field=title]').inputValue(), '인라인 제목 편집 검증');
      const state = await page.evaluate(() => window.__qaState.privateContent);
      assert.equal(state.tasks.find(t => t.id === 't1').note, '첫 줄 내용\n편집하던 상세 내용을 그대로 유지\n마지막 줄');
    });
    await test('캘린더 날짜 클릭 시 편집 DOM·문자열·caret 유지', async () => {
      await retainReferences();
      await root.locator('.td-calendar-side [data-date="2026-10-30"]').click();
      await assertReferences();
      assert.equal(await root.locator('.td-calendar-side .td-day-detail h2').textContent(), '10월 30일 일정');
    });
    await test('빠른 캡처 시 편집 DOM·문자열·caret 유지', async () => {
      await retainReferences();
      await root.locator('.td-quick input').fill('갑자기 떠오른 할 일');
      await root.locator('.td-quick input').press('Enter');
      await assertReferences();
      const state = await page.evaluate(() => window.__qaState.privateContent);
      assert.ok(state.tasks.some(t => t.title === '갑자기 떠오른 할 일' && t.kind === 'inbox'));
    });
    await test('스킨·라이트다크 변경 시 편집 DOM·문자열·caret 유지', async () => {
      await retainReferences();
      for (const skin of ['ink', 'paper', 'base']) {
        await root.locator('[data-look=skin]').selectOption(skin);
        for (const mode of ['light', 'dark']) {
          await root.locator('[data-look=mode]').selectOption(mode);
          await assertReferences();
        }
      }
    });
    await test('인박스→할 일·대기 분류 및 대기 상대', async () => {
      await root.locator('[data-tab=inbox]').click();
      await root.locator('[data-task=t4]').click();
      await root.locator('[data-field=kind]').selectOption('todo');
      assert.equal(await root.locator('.td-nav [data-tab=todo]').getAttribute('aria-current'), 'page');
      assert.equal(await root.locator('[data-editor=t4]').count(), 1);
      await root.locator('[data-field=kind]').selectOption('waiting');
      await root.locator('[data-field=waitingFor]').fill('확인 담당자');
      const state = await page.evaluate(() => window.__qaState.privateContent);
      assert.equal(state.tasks.find(t => t.id === 't4').kind, 'waiting');
      assert.equal(state.tasks.find(t => t.id === 't4').waitingFor, '확인 담당자');
    });
    await test('완료 목록과 캘린더 마감 상태 동기화', async () => {
      await root.locator('[data-check=t1]').click();
      assert.equal(await root.locator('.td-rows [data-task-row=t1]').count(), 0);
      assert.equal(await root.locator('.td-calendar-side [data-reveal=t1]').count(), 0);
      await root.locator('[data-tab=done]').click();
      assert.equal(await root.locator('[data-task-row=t1]').count(), 1);
      assert.equal(await root.locator('[data-check=t1]').isChecked(), true);
      await root.locator('[data-check=t1]').click();
      await root.locator('[data-tab=todo]').click();
      assert.equal(await root.locator('[data-task-row=t1]').count(), 1);
    });
    await test('할 일 날짜 드래그 마감 변경 및 되돌리기', async () => {
      await root.locator('[data-task=t1]').dragTo(root.locator('.td-calendar-side [data-date="2026-10-31"]'));
      assert.equal(await root.locator('[data-editor=t1] [data-field=due]').inputValue(), '2026-10-31');
      assert.equal(await root.locator('.td-calendar-side [data-reveal=t1]').count(), 1);
      await root.locator('.td-feedback [data-action=undo]').click();
      assert.equal(await root.locator('[data-editor=t1] [data-field=due]').inputValue(), '2026-10-29');
    });
    await test('일정 생성·수정·삭제·복구', async () => {
      await root.locator('.td-calendar-side [data-action=new-event]').click();
      await root.locator('.td-modal [name=title]').fill('새 일정 검증');
      await root.locator('.td-modal [name=date]').fill('2026-10-29');
      await root.locator('.td-modal [name=time]').fill('15:00');
      await root.locator('.td-modal [name=end]').fill('16:00');
      await root.locator('.td-modal [name=location]').fill('검증 장소');
      await root.locator('.td-modal [type=submit]').click();
      assert.equal(await root.locator('.td-calendar-side .td-cal-event').filter({ hasText: '새 일정 검증' }).count(), 1);
      await root.locator('.td-calendar-side .td-cal-event').filter({ hasText: '새 일정 검증' }).click();
      await root.locator('.td-modal [name=title]').fill('수정된 일정');
      await root.locator('.td-modal [type=submit]').click();
      await root.locator('.td-calendar-side .td-cal-event').filter({ hasText: '수정된 일정' }).click();
      await root.locator('[data-action=delete-event]').click();
      assert.equal(await root.locator('.td-calendar-side .td-cal-event').filter({ hasText: '수정된 일정' }).count(), 0);
      await root.locator('.td-feedback [data-action=undo]').click();
      assert.equal(await root.locator('.td-calendar-side .td-cal-event').filter({ hasText: '수정된 일정' }).count(), 1);
    });
    await test('WHENCOMMAND 초성 검색·계산·할 일 추가·키보드', async () => {
      await root.locator('[data-field=note]').press('Control+k');
      assert.equal(await command.evaluate(el => document.activeElement === el), true);
      await command.fill('ㄱㅈ');
      assert.ok((await root.locator('.td-command-results').textContent()).includes('기존 앱의 저장 방식 확인'));
      await command.press('ArrowDown');
      await command.press('ArrowUp');
      await command.press('Enter');
      assert.equal(await root.locator('[data-editor=t2]').count(), 1);
      await command.fill('120 * 3');
      assert.ok((await root.locator('.td-command-result').first().textContent()).includes('360'));
      await command.press('Enter');
      assert.ok((await root.locator('.td-feedback').textContent()).includes('360'));
      await command.fill('할 일 추가 키보드 검증 작업');
      await command.press('Enter');
      assert.equal(await root.locator('[data-field=title]').inputValue(), '키보드 검증 작업');
      assert.equal(await root.locator('.td-nav [data-tab=inbox]').getAttribute('aria-current'), 'page');
      await command.fill('계산기');
      assert.ok((await root.locator('.td-command-result').first().textContent()).includes('앱 실행 예시'));
      await command.press('Enter');
      assert.ok((await root.locator('.td-feedback').textContent()).includes('실제 앱에서 계산기를 실행'));
      await command.focus();
      await command.press('Escape');
      assert.equal(await root.locator('.td-command-results').isHidden(), true);
    });
    await test('범위 확인: 회의록·집중·마무리·독립 Note 화면 없음', async () => {
      const content = await root.textContent();
      for (const text of ['회의록', '집중', '마무리', '계획', 'Note', '이어서 실행']) assert.equal(content.includes(text), false, text + '가 남아 있습니다.');
      assert.equal(await root.locator('.td-nav button').count(), 6);
    });
    await test('반응형 가로 넘침 및 스킨별 공통 배치', async () => {
      for (const width of [1024, 736, 390, 320]) {
        await page.setViewportSize({ width, height: 1500 });
        for (const view of ['tasks', 'calendar', 'command']) {
          if (view === 'tasks') { await root.locator('[data-tab=todo]').click(); await root.locator('[data-task=t1]').click(); }
          if (view === 'calendar') await root.locator('.td-nav [data-action=calendar]').click();
          if (view === 'command') { await command.fill('기존'); await command.focus(); }
          for (const mode of ['light', 'dark']) {
            await root.locator('[data-look=mode]').selectOption(mode);
            for (const skin of ['base', 'ink', 'paper']) {
              await root.locator('[data-look=skin]').selectOption(skin);
              const metrics = await page.evaluate(() => ({
                documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
                appOverflow: document.querySelector('.td-app').scrollWidth > document.querySelector('.td-app').clientWidth + 1
              }));
              assert.equal(metrics.documentOverflow, false, `${view}/${mode}/${skin} at ${width}`);
              assert.equal(metrics.appOverflow, false, `${view}/${mode}/${skin} app at ${width}`);
              layouts.push({ width, view, mode, skin, ...metrics });
            }
          }
          await command.press('Escape');
        }
      }
    });
    await test('사이드바 메뉴명 경계: 736·390·320', async () => {
      const overflows = [];
      for (const width of [736, 390, 320]) {
        await page.setViewportSize({ width, height: 1500 });
        const measurements = await root.locator('.td-sidebar').evaluate(el => {
          const side = el.getBoundingClientRect();
          return [...el.querySelectorAll('.td-nav button>span')].map(label => {
            const b = label.getBoundingClientRect();
            return { text: label.textContent, left: b.left, right: b.right, sidebarRight: side.right, overflows: b.right > side.right + 1 || b.left < side.left - 1 };
          });
        });
        await root.screenshot({ path: path.join(out, 'main-' + width + '.png') });
        overflows.push(...measurements.filter(m => m.overflows).map(m => ({ width, ...m })));
      }
      assert.deepEqual(overflows, [], JSON.stringify(overflows));
    });
    await reset();
    for (const mode of ['light', 'dark']) {
      await root.locator('[data-look=mode]').selectOption(mode);
      await root.locator('[data-tab=todo]').click();
      await root.locator('[data-task=t1]').click();
      await root.screenshot({ path: path.join(out, 'main-' + mode + '.png') });
      await root.locator('.td-nav [data-action=calendar]').click();
      await root.screenshot({ path: path.join(out, 'calendar-' + mode + '.png') });
      await root.locator('[data-tab=todo]').click();
      await root.locator('[data-task=t1]').click();
      await command.fill('기존');
      await command.focus();
      await root.screenshot({ path: path.join(out, 'command-' + mode + '.png') });
      await command.press('Escape');
    }
  } finally {
    const report = { source, tests, layouts, errors, failed: tests.filter(t => !t.ok).length };
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ tests: tests.length, failed: report.failed, layoutChecks: layouts.length, errors, out }));
    await browser.close();
  }
  if (tests.some(t => !t.ok) || errors.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
