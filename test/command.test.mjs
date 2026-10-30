import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCommand } from '../main/command.mjs';
import { createStore as createNoteStore } from '../modules/note/main/store.mjs';

function fixture(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whendesk-command-'));
  const copied = [], opened = [], dialogs = [], more = [], mutations = [];
  const tasks = [{ id: 't1', title: '테스트 결과 확인', project: 'WHENDESK', kind: 'todo', note: '다음 릴리스 검증', due: '2026-10-29', done: false }];
  const domain = { state: () => ({ tasks, events: [] }), calendar: { searchEvents: () => [] },
    mutate(type, payload) {
      mutations.push({ type, payload });
      if (type === 'task.create') { const item = { id: 'new-task', title: payload.title, kind: 'inbox', done: false }; tasks.push(item); return item; }
      if (type === 'note.create') return { id:'new-note', body:payload.body };
      if (type === 'calendar.parse') return { ok: true, title: '치과 예약', startsAt: '2026-10-30T06:00:00.000Z', endsAt: '2026-10-30T07:00:00.000Z', allDay: false };
      if (type === 'event.create') return { id: 12, date: '2026-10-30', ...payload };
    } };
  let disposed = false;
  const platform = {
    listApps: async () => [{ name: 'Google Chrome', path: 'test-chrome.lnk' }, { name: 'Calculator', path: 'test-calculator.lnk' }],
    scriptRunner: () => null,
    systemCommands: () => [{ id: 'empty-trash', title: '휴지통 비우기', description: '되돌릴 수 없습니다', exec: { cmd: 'must-not-run', args: [] } }],
    openApp: async file => { opened.push(file); return true; },
    createFileSearch: () => ({ ready: async () => ({ ok: true }), status: () => ({ ok: true }), query: async () => [], dispose: () => { disposed = true; } }),
    ...overrides.platform,
  };
  const effects = { clipboard: { writeText: text => copied.push(text) }, shell: { openPath: async file => { opened.push(file); return ''; }, showItemInFolder: file => opened.push('reveal:' + file) },
    dialog: { showMessageBox: async options => { dialogs.push(options); return { response: 0 }; } } };
  const command = createCommand({ dataDir, domain, onMore: result => more.push(result), platform, effects, fileDebounceMs: 1, fileTimeoutMs: 100, ...overrides.options });
  return { command, dataDir, copied, opened, dialogs, more, mutations, platform, effects, domain,
    get disposed() { return disposed; }, cleanup() { command.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

async function nextMore(fixture) {
  const deadline = Date.now() + 1500;
  while (!fixture.more.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(fixture.more.length, '파일 검색 완료 이벤트가 도착해야 합니다');
  return fixture.more.at(-1);
}

test('초성·한글 별칭으로 설치된 앱을 검색하고 캐시한 경로만 실행한다', async () => {
  const f = fixture();
  try {
    await f.command.ready();
    const result = await f.command.query('ㅋㄹ', 1);
    const chrome = result.items.find(item => item.source === 'apps' && item.title === 'Google Chrome');
    assert.ok(chrome);
    assert.equal(chrome.via, 'alias');
    assert.equal(chrome.action, undefined);
    assert.equal((await f.command.run(chrome.key)).hide, true);
    assert.deepEqual(f.opened, ['test-chrome.lnk']);
    await assert.rejects(f.command.run('apps:C:\\arbitrary.exe'), /현재 검색 결과/);
  } finally { f.cleanup(); }
});

test('이전 검색 key는 새 질의를 실행한 뒤 사용할 수 없다', async () => {
  const f = fixture();
  try {
    await f.command.ready();
    const chrome = (await f.command.query('크롬')).items.find(item => item.source === 'apps');
    await f.command.query('2 + 2');
    await assert.rejects(f.command.run(chrome.key), /현재 검색 결과/);
    assert.deepEqual(f.opened, []);
  } finally { f.cleanup(); }
});

test('원본 계산기·단위 변환을 재사용하고 실제 실행에서는 클립보드에 복사한다', async () => {
  const f = fixture();
  try {
    await f.command.ready();
    let result = await f.command.query('(120 + 30) * 2');
    assert.equal(result.items[0].title, '300');
    await f.command.run(result.items[0].key);
    result = await f.command.query('2 GB to MB');
    assert.equal(result.items[0].title, '2,000 MB');
    await f.command.run(result.items[0].key);
    assert.deepEqual(f.copied, ['300', '2,000 MB']);
  } finally { f.cleanup(); }
});

test('할 일 검색·명시적 추가·캘린더 자연어 추가가 통합 저장소로 연결된다', async () => {
  const f = fixture();
  try {
    await f.command.ready();
    const task = (await f.command.query('ㅌㅅㅌㄱㄱ')).items.find(item => item.key === 'tasks:t1');
    assert.ok(task);
    assert.deepEqual((await f.command.run(task.key)).route, { view: 'tasks', tab: 'todo', id: 't1' });
    const capture = (await f.command.query('할 일 추가 테스트 실행')).items[0];
    assert.equal(capture.key, 'capture:todo');
    assert.deepEqual((await f.command.run(capture.key)).route, { view: 'tasks', tab: 'inbox', id: 'new-task' });
    assert.equal(f.mutations[0].payload.title, '테스트 실행');
    const event = (await f.command.query('일정 추가 내일 3시 치과 예약')).items[0];
    assert.deepEqual((await f.command.run(event.key)).route, { view: 'calendar', id: 12, date: '2026-10-30' });
    assert.equal(f.mutations.at(-2).type, 'calendar.parse');
    assert.equal(f.mutations.at(-1).type, 'event.create');
  } finally { f.cleanup(); }
});

test('늦게 도착한 이전 파일 검색 결과는 폐기한다', async () => {
  let resolveOld;
  const f = fixture({ platform: { createFileSearch: () => ({
    ready: async () => ({ ok: true }), status: () => ({ ok: true }), dispose() {},
    query(q) { return q === 'old-file' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve([{ name: 'new-file.txt', path: 'C:\\test\\new-file.txt', isDir: false }]); },
  }) } });
  try {
    await f.command.ready();
    await f.command.query('old-file', 20);
    await new Promise(resolve => setTimeout(resolve, 10));
    await f.command.query('new-file', 21);
    await new Promise(resolve => setTimeout(resolve, 15));
    resolveOld([{ name: 'old-file.txt', path: 'C:\\test\\old-file.txt', isDir: false }]);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.more.length, 1);
    assert.equal(f.more[0].seq, 21);
    assert.equal(f.more[0].items[0].title, 'new-file.txt');
    assert.equal(f.more[0].items[0].action, undefined);
    await f.command.run(f.more[0].items[0].key, 'reveal');
    assert.deepEqual(f.opened, ['reveal:C:\\test\\new-file.txt']);
  } finally { f.cleanup(); }
});

test('파일 검색 비활성 상태는 가짜 결과 대신 실제 이유를 돌려준다', async () => {
  const f = fixture({ platform: { createFileSearch: () => ({ ready: async () => ({ ok: false, reason: '색인이 꺼져 있습니다' }), status: () => ({ ok: false, reason: '색인이 꺼져 있습니다' }), dispose() {} }) } });
  try {
    await f.command.ready();
    const result = await f.command.query('검색할 파일');
    assert.equal(result.pending, false);
    assert.equal(result.notice, '색인이 꺼져 있습니다');
    assert.equal(result.items.some(item => item.source === 'files'), false);
  } finally { f.cleanup(); }
});

test('위험한 기존 시스템 명령의 취소는 실행·랭킹 쓰기 없이 끝난다', async () => {
  const f = fixture();
  try {
    await f.command.ready();
    const item = (await f.command.query('휴지통 비우기')).items.find(item => item.source === 'system');
    assert.ok(item);
    assert.deepEqual(await f.command.run(item.key), { ok: false, cancelled: true });
    assert.equal(f.dialogs.length, 1);
    assert.deepEqual(f.opened, []);
  } finally { f.cleanup(); }
});

test('랭킹은 WHENDESK의 독립 SQLite 파일에 저장되고 다시 열린다', async () => {
  const f = fixture();
  try {
    await f.command.ready();
    const item = (await f.command.query('크롬')).items.find(item => item.source === 'apps');
    await f.command.run(item.key);
    f.command.close();
    const second = createCommand({ dataDir: f.dataDir, domain: f.domain, platform: f.platform, effects: f.effects });
    try {
      await second.ready();
      const ranked = (await second.query('크롬')).items.find(item => item.source === 'apps');
      assert.ok(ranked.final > 1);
      assert.equal(fs.existsSync(path.join(f.dataDir, 'command', 'whencommand.db')), true);
      assert.equal(fs.readdirSync(second.scriptsDir).length, 0, '사용자 폴더나 예제 스크립트를 만들지 않는다');
    } finally { second.close(); }
  } finally { f.cleanup(); }
});

test('close는 파일 검색 프로세스와 예약된 늦은 결과를 정리한다', async () => {
  const f = fixture();
  try {
    await f.command.ready();
    await f.command.query('중단할 검색', 10);
    f.command.close();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.disposed, true);
    assert.deepEqual(f.more, []);
    await assert.rejects(f.command.query('닫힌 뒤'), /종료/);
  } finally { f.cleanup(); }
});

test('Ctrl+Enter 보조 동작은 원본처럼 앱 위치·스크립트 열기이며 경로 없는 UWP는 열기로 폴백한다', async () => {
  const f = fixture({ platform: {
    listApps: async () => [{ name: 'Google Chrome', path: 'test-chrome.lnk' }, { name: 'UWP Example', path: 'shell:AppsFolder\\Example' }],
    scriptRunner: file => file.endsWith('.ps1') ? { cmd: 'must-not-run', args: [] } : null,
  } });
  try {
    const scriptPath = path.join(f.command.scriptsDir, 'script-sample.ps1');
    fs.writeFileSync(scriptPath, '# name: Script Sample\n# description: 보조 동작 검증\nWrite-Output must-not-run');
    await f.command.ready();
    const app = (await f.command.query('크롬')).items.find(item => item.source === 'apps');
    assert.equal(app.altId, 'reveal');
    assert.deepEqual(app.actions.map(action => action.id), ['open', 'reveal', 'copy-path']);
    await f.command.run(app.key, 'alt');
    assert.deepEqual(f.opened, ['reveal:test-chrome.lnk']);

    const script = (await f.command.query('Script Sample')).items.find(item => item.source === 'scripts' && item.title === 'Script Sample');
    assert.equal(script.altId, 'edit');
    assert.deepEqual(script.actions.map(action => action.id), ['run', 'edit', 'reveal']);
    await f.command.run(script.key, script.altId);
    assert.equal(f.opened.at(-1), scriptPath, '스크립트 자체를 실행하지 않고 편집용으로 열어야 합니다');

    const uwp = (await f.command.query('UWP Example')).items.find(item => item.source === 'apps');
    assert.equal(uwp.altId, null);
    assert.deepEqual(uwp.actions.map(action => action.id), ['open']);
    await f.command.run(uwp.key, 'alt');
    assert.equal(f.opened.at(-1), 'shell:AppsFolder\\Example');
  } finally { f.cleanup(); }
});

test('목록에 없는 동작은 거부하고 계산의 보조 동작은 본래 복사를 유지한다', async () => {
  const f = fixture();
  try {
    await f.command.ready();
    const calc = (await f.command.query('2+2')).items[0];
    assert.equal(calc.altId, null);
    await assert.rejects(f.command.run(calc.key, 'copy-arbitrary-path'), /사용할 수 없는 동작/);
    assert.deepEqual(f.copied, []);
    await f.command.run(calc.key, 'alt');
    assert.deepEqual(f.copied, ['4']);
  } finally { f.cleanup(); }
});

test('할 일 제목의 정확한 일치는 긴 상세 내용에 영향받지 않고 상세 검색도 유지된다', async () => {
  const f = fixture();
  try {
    await f.command.ready();
    const task = f.domain.state().tasks[0];
    const first = (await f.command.query(task.title)).items.find(item => item.key === 'tasks:t1');
    task.note = '아주 긴 상세 내용을 보존합니다. '.repeat(100) + ' sensitive_token_734';
    const second = (await f.command.query(task.title)).items.find(item => item.key === 'tasks:t1');
    assert.equal(second.final, first.final, '상세 내용 길이가 제목의 일치 점수를 깎으면 안 됩니다');
    assert.deepEqual(second.positions, [...task.title].map((_, index) => index));
    const noteMatch = (await f.command.query('sensitive_token_734')).items.find(item => item.key === 'tasks:t1');
    assert.ok(noteMatch, '기존 상세 내용 검색을 유지해야 합니다');
    assert.deepEqual(noteMatch.positions, [], '제목 밖 상세 내용의 위치로 제목을 강조하면 안 됩니다');
  } finally { f.cleanup(); }
});

test('늦게 찾은 파일도 통합 상위 12개에 포함하고 같은 질의에서 이미 표시한 동작 메뉴의 대상을 보존한다', async () => {
  const f = fixture({ platform: {
    listApps: async () => Array.from({ length: 15 }, (_, index) => ({ name: `report utility workspace application ${index}`, path: `report-app-${index}.lnk` })),
    createFileSearch: () => ({ ready: async () => ({ ok: true }), status: () => ({ ok: true }), dispose() {},
      query: async () => [{ name: 'report', path: 'C:\\test\\report.txt', isDir: false }] }),
  } });
  try {
    await f.command.ready();
    const fast = await f.command.query('report', 70);
    assert.equal(fast.items.length, 12);
    assert.equal(fast.items.some(item => item.source === 'files'), false);
    const completed = await nextMore(f);
    assert.equal(completed.replace, true);
    assert.equal(completed.query, 'report');
    assert.equal(completed.seq, 70);
    assert.equal(completed.items.length, 12);
    assert.equal(completed.items[0].source, 'files', '정확히 일치한 파일을 12개 앱 뒤로 밀면 안 됩니다');
    assert.ok(completed.items.some(item => item.source === 'apps'), '파일 도착 후에도 기존 앱 결과가 남아야 합니다');
    const removed = fast.items.find(item => !completed.items.some(current => current.key === item.key));
    assert.ok(removed);
    await f.command.run(removed.key, 'copy-path');
    assert.equal(f.copied.at(-1), removed.path, '검색 도중 순위가 바뀌어도 열어둔 동작 메뉴의 대상은 실행할 수 있어야 합니다');
    await f.command.run(completed.items[0].key, 'copy-path');
    assert.equal(f.copied.at(-1), 'C:\\test\\report.txt');
    await f.command.query('2+2', 71);
    await assert.rejects(f.command.run(removed.key), /현재 검색 결과/, '다른 질의로 바뀌면 이전 메뉴의 대상은 무효화해야 합니다');
  } finally { f.cleanup(); }
});

test('파일 검색 시간 초과와 오류는 빠른 결과를 보존하고 실제 이유를 전달한다', async () => {
  for (const [name, query, pattern] of [
    ['timeout', () => new Promise(() => {}), /시간이 초과/],
    ['failure', () => Promise.reject(new Error('색인 연결 끊김')), /색인 연결 끊김/],
  ]) {
    const f = fixture({ platform: { createFileSearch: () => ({ ready: async () => ({ ok: true }), status: () => ({ ok: true }), dispose() {}, query }) }, options: { fileTimeoutMs: 15 } });
    try {
      await f.command.ready();
      const fast = await f.command.query('chrome', 80);
      const completed = await nextMore(f);
      assert.equal(completed.pending, false, name);
      assert.equal(completed.replace, true, name);
      assert.match(completed.notice, pattern);
      assert.deepEqual(completed.items.map(item => item.key), fast.items.map(item => item.key), name);
      await f.command.run(completed.items.find(item => item.source === 'apps').key);
      assert.deepEqual(f.opened, ['test-chrome.lnk']);
    } finally { f.cleanup(); }
  }
});

test('실행을 요청한 직후 새 질의가 들어와도 이미 선택한 항목을 다른 항목으로 바꾸지 않는다', async () => {
  const f = fixture();
  try {
    await f.command.ready();
    const app = (await f.command.query('크롬')).items.find(item => item.source === 'apps');
    const running = f.command.run(app.key);
    await f.command.query('2+2');
    assert.deepEqual(await running, { ok: true, hide: true });
    assert.deepEqual(f.opened, ['test-chrome.lnk']);
    assert.deepEqual(f.copied, []);
  } finally { f.cleanup(); }
});

test('서로 다른 계산 질의의 key가 같아도 요청한 질의가 바뀌면 다른 계산 결과를 복사하지 않는다', async () => {
  const f = fixture();
  try {
    await f.command.ready();
    const first = (await f.command.query('2+2')).items[0];
    const second = (await f.command.query('3+3')).items[0];
    assert.equal(first.key, second.key, '같은 종류의 계산 결과는 key를 재사용합니다');
    await assert.rejects(f.command.run(first.key, null, { query: '2+2' }), /검색 내용이 바뀌었습니다/);
    assert.deepEqual(f.copied, []);
    await f.command.run(second.key, null, { query: '  3+3  ' });
    assert.deepEqual(f.copied, ['6'], '질의 정규화 후 현재 계산 결과는 실행할 수 있어야 합니다');
    await f.command.run(second.key);
    assert.deepEqual(f.copied, ['6', '6'], 'query 없는 기존 호출도 계속 지원합니다');
  } finally { f.cleanup(); }
});

test('메모의 초성·본문·태그 검색은 WHENNOTE 저장소를 재사용하고 보관함·휴지통은 제외한다', async () => {
  const f = fixture();
  const notes = createNoteStore(path.join(f.dataDir,'note','store.sqlite'));
  f.domain.note = notes;
  try {
    notes.insertCaptures([
      { id:'n1', body:'배포 점검\n내일 확인할 배포 절차와 담당자 #릴리스', captured_at:'2026-10-29T01:00:00.000Z' },
      { id:'n2', body:'보관 문서\n내일 확인할 배포 절차 #릴리스', captured_at:'2026-10-29T01:01:00.000Z' },
      { id:'n3', body:'삭제 문서\n내일 확인할 배포 절차 #릴리스', captured_at:'2026-10-29T01:02:00.000Z' },
    ]);
    notes.setArchived('n2',true); notes.removeNote('n3');
    await f.command.ready();
    for (const query of ['ㅂㅍ ㅈㄱ','담당자','#릴리스','배포 #릴리스']) {
      const matches = (await f.command.query(query)).items.filter(item => item.source === 'notes');
      assert.deepEqual(matches.map(item => item.key),['notes:n1'],query);
      assert.equal(matches[0].title,'배포 점검');
      assert.ok(matches[0].subtitle.includes('#릴리스'));
      assert.equal(matches[0].action,undefined);
      assert.deepEqual((await f.command.run(matches[0].key)).route,{view:'notes',id:'n1'});
    }
    assert.equal((await f.command.query('#다른태그')).items.some(item=>item.source==='notes'),false);
    assert.equal(notes.getNote('n1').body,'배포 점검\n내일 확인할 배포 절차와 담당자 #릴리스','검색과 열기는 본문을 변경하지 않아야 합니다');
  } finally { notes.close(); f.cleanup(); }
});

test('메모 화면 이동과 명시적인 메모 추가는 기존 할 일 추가와 구분된다', async () => {
  const f = fixture();
  try {
    await f.command.ready();
    for (const query of ['메모','노트','WHENNOTE']) {
      const navigation=(await f.command.query(query)).items.find(item=>item.key==='builtin:notes');
      assert.ok(navigation,query);
      assert.deepEqual((await f.command.run(navigation.key)).route,{view:'notes'});
    }
    for (const [query,body] of [['메모 추가 배포 확인 #릴리스','배포 확인 #릴리스'],['노트 추가 내일 볼 내용','내일 볼 내용'],['note add sample text','sample text'],['메모 추가','']]) {
      const capture=(await f.command.query(query)).items[0];
      assert.equal(capture.key,'capture:note');assert.equal(capture.source,'notes');
      assert.deepEqual((await f.command.run(capture.key,null,{query})).route,{view:'notes',id:'new-note'});
      assert.deepEqual(f.mutations.at(-1),{type:'note.create',payload:{body}});
    }
    const task=(await f.command.query('할 일 추가 메모 정리')).items[0];
    assert.equal(task.key,'capture:todo');await f.command.run(task.key);
    assert.equal(f.mutations.at(-1).type,'task.create');
    const first=(await f.command.query('메모 추가 첫 내용')).items[0];
    await f.command.query('메모 추가 다른 내용');
    const before=f.mutations.length;
    await assert.rejects(f.command.run(first.key,null,{query:'메모 추가 첫 내용'}),/검색 내용이 바뀌었습니다/);
    assert.equal(f.mutations.length,before,'검색이 바뀐 뒤 예전 메모 내용을 저장하면 안 됩니다');
  } finally { f.cleanup(); }
});

test('영문 메뉴와 기존 한국어 이름으로 같은 화면을 열고 Work는 현재 작업 분류를 유지한다', async () => {
  const f=fixture();
  try {
    await f.command.ready();
    const routes=[
      ['dashboard',['Dashboard','대시보드'],{view:'dashboard'}],
      ['work',['Work','작업','WHENWORK'],{view:'work'}],
      ['notes',['Note','메모'],{view:'notes'}],
      ['calendar',['Calendar','캘린더'],{view:'calendar'}],
      ['inbox',['InBox','인박스'],{view:'tasks',tab:'inbox'}],
      ['todo',['ToDo','할 일'],{view:'tasks',tab:'todo'}],
      ['waiting',['Waiting','대기'],{view:'tasks',tab:'waiting'}],
      ['done',['Done','완료 기록'],{view:'tasks',tab:'done'}],
    ];
    for(const [id,queries,route]of routes)for(const query of queries){
      const item=(await f.command.query(query)).items.find(item=>item.key===`builtin:${id}`);
      assert.ok(item,query);
      assert.deepEqual((await f.command.run(item.key,null,{query})).route,route,query);
    }
    assert.deepEqual(f.mutations,[],'화면 이동은 작업 분류나 본문을 변경하지 않습니다.');
    assert.deepEqual(f.opened,[],'화면 이름 검색으로 외부 앱을 실행하지 않습니다.');
  } finally { f.cleanup(); }
});
