import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDomain } from '../main/domain.mjs';

function setup(t, options = {}) {
  const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(temporaryRoot, 'whendesk-domain-'));
  const domain = createDomain({ dataDir, ...options });
  t.after(() => { domain.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { domain, dataDir };
}
const range = { year: 2026, month: 9 };
const sampleIcs = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:테스트 구독\r\nBEGIN:VEVENT\r\nUID:test-sub-1\r\nDTSTART:20261029T090000Z\r\nDTEND:20261029T100000Z\r\nSUMMARY:구독 일정\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

test('원문 캡처·분류·프로젝트·오래된 완료 기록과 원자적 검증', async t => {
  const { domain } = setup(t);
  assert.deepEqual(domain.state(range).tasks, []);
  assert.deepEqual(domain.state(range).projects, []);
  const task = await domain.mutate('task.create', { title: '#201 이슈 확인' });
  assert.equal(task.title, '#201 이슈 확인');
  assert.equal(task.kind, 'inbox');
  const project = await domain.mutate('project.create', { name: 'WHENDESK' });
  await domain.mutate('task.update', { id: task.id, project_id: project.id, due: '2026-10-29', note: '자료 확인' });
  assert.equal(domain.state(range).tasks[0].kind, 'todo');
  await domain.mutate('task.update', { id: task.id, kind: 'waiting', waitingFor: '담당자' });
  const next = await domain.mutate('project.create', { name: '개인' });
  await domain.mutate('task.update', { id: task.id, project_id: next.id });
  assert.equal(domain.state(range).tasks[0].kind, 'waiting');
  await assert.rejects(domain.mutate('task.update', { id: task.id, title: '적용되면 안 됨', due: '2026-02-31' }), /마감/);
  assert.equal(domain.state(range).tasks[0].title, '#201 이슈 확인');
  await domain.mutate('task.complete', { id: task.id, done: true });
  domain.work.patchItem(task.id, { done_at: '2020-01-01T00:00:00.000Z' });
  assert.equal(domain.state(range).tasks[0].done, true);
  await domain.mutate('task.delete', { id: task.id });
  assert.equal(domain.state(range).tasks.length, 0);
  assert.equal(domain.state({ ...range, includeDeleted: true }).tasks[0].deleted, true);
  await domain.mutate('task.restore', { id: task.id });
  await domain.mutate('task.complete', { id: task.id, done: false });
  assert.equal(domain.state(range).tasks[0].done, false);
});

test('프로세스 재시작 뒤 SQLite·캡처 큐를 재생하되 중복을 만들지 않는다', async t => {
  const { domain, dataDir } = setup(t);
  const task = await domain.mutate('task.create', { title: '영속적인 할 일' });
  const event = await domain.mutate('event.create', { title: '치과 예약', date: '2026-10-29', time: '18:00', end: '18:30' });
  domain.close();
  const pending = { id: 'queued-task', title: '종료 직전에 담은 일', captured_at: '2026-10-29T00:00:00.000Z' };
  fs.appendFileSync(path.join(dataDir, 'work', 'capture.jsonl'), JSON.stringify(pending) + '\n');
  const reopened = createDomain({ dataDir });
  t.after(() => reopened.close());
  const state = reopened.state(range);
  assert.equal(state.tasks.length, 2);
  assert.equal(state.tasks.filter(item => item.id === task.id).length, 1);
  assert.ok(state.tasks.some(item => item.id === pending.id));
  assert.ok(state.events.some(item => item.id === event.id && item.date === '2026-10-29' && item.time === '18:00'));
  reopened.close();
  const again = createDomain({ dataDir });
  t.after(() => again.close());
  assert.equal(again.state(range).tasks.length, 2);
  again.close();
});

test('잘못된 날짜·시간·제목을 거부하고 일반·종일 일정과 소프트 삭제를 보존한다', async t => {
  const { domain } = setup(t);
  await assert.rejects(domain.mutate('event.create', { title: '오류', date: '2026-10-29', time: '18:00', end: '17:00' }), /종료/);
  await assert.rejects(domain.mutate('event.create', { title: '오류', date: '2026-02-31', time: '18:00', end: '19:00' }), /날짜/);
  assert.equal(domain.calendar.allEvents().length, 0);
  const event = await domain.mutate('event.create', { title: '일반 일정', date: '2026-10-29', time: '09:30', end: '10:00', location: '장소' });
  await domain.mutate('event.update', { id: event.id, title: '변경한 일정' });
  const updated = domain.state(range).events.find(item => item.id === event.id);
  assert.equal(updated.time, '09:30');
  assert.equal(updated.end, '10:00');
  const allDay = await domain.mutate('event.create', { title: '종일 일정', date: '2026-10-30', allDay: true });
  assert.equal(allDay.date, '2026-10-30');
  assert.equal(allDay.time, '');
  assert.equal(allDay.endDate, '2026-10-31');
  await domain.mutate('event.delete', { id: event.id });
  assert.equal(domain.state(range).events.some(item => item.id === event.id), false);
  await domain.mutate('event.restore', { id: event.id });
  assert.equal(domain.state(range).events.some(item => item.id === event.id), true);
});

test('반복 일정의 한 회차 수정·삭제와 전체 수정은 시리즈 시작일을 옮기지 않는다', async t => {
  const { domain } = setup(t);
  const event = await domain.mutate('event.create', { title: '반복', date: '2026-10-26', time: '09:00', end: '10:00', rrule: 'FREQ=DAILY;COUNT=5' });
  let occurrences = domain.state(range).events.filter(item => item.id === event.id);
  assert.equal(occurrences.length, 5);
  const third = occurrences[2];
  await domain.mutate('event.update', { id: event.id, recurrenceId: third.recurrenceId, scope: 'one', title: '이번만 변경' });
  occurrences = domain.state(range).events.filter(item => item.id === event.id);
  assert.equal(occurrences[2].title, '이번만 변경');
  assert.equal(occurrences[2].date, '2026-10-28');
  const fourth = occurrences[3];
  await domain.mutate('event.update', { id: event.id, recurrenceId: fourth.recurrenceId, scope: 'all', title: '전체 변경', date: fourth.date, time: '09:00', end: '10:00' });
  assert.equal(domain.calendar.getEvent(event.id).startsAt, event.startsAt);
  await domain.mutate('event.delete', { id: event.id, recurrenceId: fourth.recurrenceId, scope: 'one' });
  assert.equal(domain.state(range).events.filter(item => item.id === event.id).length, 4);
});

test('반복 회차 삭제(이 회차만·뒤 전부)는 돌려받은 이전 모양으로 되돌린다', async t => {
  const { domain } = setup(t);
  const event = await domain.mutate('event.create', { title: '반복', date: '2026-10-26', time: '09:00', end: '10:00', rrule: 'FREQ=DAILY;COUNT=5' });
  const count = () => domain.state(range).events.filter(item => item.id === event.id).length;
  const [, second, third] = domain.state(range).events.filter(item => item.id === event.id);
  const one = await domain.mutate('event.delete', { id: event.id, recurrenceId: second.recurrenceId, scope: 'one' });
  assert.equal(count(), 4);
  const future = await domain.mutate('event.delete', { id: event.id, recurrenceId: third.recurrenceId, scope: 'future' });
  assert.equal(count(), 1);
  await domain.mutate('event.reshape', { id: event.id, ...future.previous });
  assert.equal(count(), 4);
  await domain.mutate('event.reshape', { id: event.id, ...one.previous });
  assert.equal(count(), 5);
});

test('반복을 이 회차부터 나누어도 COUNT가 늘어나거나 앞부분이 사라지지 않는다', async t => {
  const { domain } = setup(t);
  const event = await domain.mutate('event.create', { title: '이전 이름', date: '2026-10-26', time: '09:00', end: '10:00', rrule: 'FREQ=DAILY;COUNT=5' });
  const third = domain.state(range).events.filter(item => item.id === event.id)[2];
  const changed = await domain.mutate('event.update', { id: event.id, recurrenceId: third.recurrenceId, scope: 'future', title: '새 이름' });
  const events = domain.state(range).events;
  assert.equal(events.filter(item => item.id === event.id).length, 2);
  assert.equal(events.filter(item => item.id === changed.id).length, 3);
  assert.equal(events.length, 5);
});

test('매주 화요일 회의를 이 회차부터 수요일로 옮기면 반복 요일도 수요일로 옮겨 회차가 사라지지 않는다', async t => {
  const { domain } = setup(t);
  const november = { year: 2026, month: 10 };
  const event = await domain.mutate('event.create', { title: '주간회의', date: '2026-10-27', time: '10:30', end: '11:30', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
  const today = domain.state(november).events.find(item => item.id === event.id && item.date === '2026-11-10');
  assert.ok(today, '11/10(화) 회차가 있어야 한다');
  const moved = await domain.mutate('event.update', { id: event.id, recurrenceId: today.recurrenceId, scope: 'future', startsAt: new Date('2026-11-11T10:30:00').toISOString(), endsAt: new Date('2026-11-11T11:30:00').toISOString(), allDay: false });
  const events = domain.state(november).events;
  const after = events.filter(item => item.id === moved.id).map(item => item.date);
  assert.deepEqual(after.slice(0, 3), ['2026-11-11', '2026-11-18', '2026-11-25'], '옮긴 회차(수)부터 매주 수요일');
  assert.match(domain.calendar.getEvent(moved.id).rrule, /BYDAY=WE/);
  const before = events.filter(item => item.id === event.id).map(item => item.date);
  assert.ok(before.includes('2026-11-03') && !before.includes('2026-11-10'), '앞 시리즈는 11/3까지');
  // 전체를 옮겨도 요일이 따라간다(시리즈 시작일은 그대로 같은 주의 수요일로).
  const series = await domain.mutate('event.create', { title: '전체 이동', date: '2026-11-02', time: '09:00', end: '10:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
  const monday = domain.state(november).events.find(item => item.id === series.id && item.date === '2026-11-09');
  await domain.mutate('event.update', { id: series.id, recurrenceId: monday.recurrenceId, scope: 'all', startsAt: new Date('2026-11-11T09:00:00').toISOString(), endsAt: new Date('2026-11-11T10:00:00').toISOString(), allDay: false });
  const days = domain.state(november).events.filter(item => item.id === series.id).map(item => new Date(item.startsAt).getDay());
  assert.ok(days.length > 2 && days.every(day => day === 3), '전체 이동 뒤 모든 회차가 수요일');
  // 이 회차만 옮기면 규칙은 그대로다.
  const once = await domain.mutate('event.create', { title: '한 번만', date: '2026-11-03', time: '14:00', end: '15:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
  const occurrence = domain.state(november).events.find(item => item.id === once.id && item.date === '2026-11-10');
  await domain.mutate('event.update', { id: once.id, recurrenceId: occurrence.recurrenceId, scope: 'one', startsAt: new Date('2026-11-12T14:00:00').toISOString(), endsAt: new Date('2026-11-12T15:00:00').toISOString(), allDay: false });
  assert.match(domain.calendar.getEvent(once.id).rrule, /BYDAY=TU/);
});

test('반복 일정의 시각을 옮겨도 빼 둔 회차는 빠진 채, 고친 회차는 한 번만 보인다', async t => {
  const { domain } = setup(t);
  const november = { year: 2026, month: 10 };
  const at = (date, time) => new Date(`${date}T${time}:00`).toISOString();
  const event = await domain.mutate('event.create', { title: '주간회의', date: '2026-11-03', time: '17:00', end: '18:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
  const occurrence = date => domain.state(november).events.find(item => item.id === event.id && item.date === date);
  await domain.mutate('event.delete', { id: event.id, recurrenceId: occurrence('2026-11-10').recurrenceId, scope: 'one' });
  await domain.mutate('event.update', { id: event.id, recurrenceId: occurrence('2026-11-17').recurrenceId, scope: 'one', title: '이번만 다른 이름' });
  // 전체를 17:00 → 10:30으로
  const first = occurrence('2026-11-03');
  await domain.mutate('event.update', { id: event.id, recurrenceId: first.recurrenceId, scope: 'all', startsAt: at('2026-11-03', '10:30'), endsAt: at('2026-11-03', '11:30'), allDay: false });
  const list = domain.state(november).events.filter(item => item.id === event.id);
  const byDate = date => list.filter(item => item.date === date);
  assert.equal(byDate('2026-11-10').length, 0, '빼 둔 11/10 회차가 되살아났다');
  assert.equal(byDate('2026-11-17').length, 1, '고친 11/17 회차가 두 번 보인다');
  assert.equal(byDate('2026-11-17')[0].title, '이번만 다른 이름');
  assert.equal(byDate('2026-11-17')[0].time, '10:30', '제자리 수정 회차도 새 시각으로');
  assert.ok(list.every(item => item.time === '10:30'));
  // 이 회차부터 하루 뒤(수)로 나누어도 넘어간 제외일이 맞는다
  await domain.mutate('event.delete', { id: event.id, recurrenceId: occurrence('2026-11-24').recurrenceId, scope: 'one' });
  const split = await domain.mutate('event.update', { id: event.id, recurrenceId: occurrence('2026-11-17').recurrenceId, scope: 'future', startsAt: at('2026-11-18', '10:30'), endsAt: at('2026-11-18', '11:30'), allDay: false });
  const after = domain.state(november).events.filter(item => item.id === split.id).map(item => item.date);
  assert.ok(after.includes('2026-11-18'), '옮긴 첫 회차가 있다');
  assert.ok(!after.includes('2026-11-25'), '빼 둔 회차(11/24 → 11/25)가 되살아났다');
});

test('자연어 파서·프로젝트 보관·내보내기와 닫힌 저장소 오류', async t => {
  const { domain } = setup(t);
  const parsed = await domain.mutate('calendar.parse', { text: '내일 오후 3시 병원 1시간', now: '2026-10-29T00:00:00.000Z' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.title, '병원');
  const project = await domain.mutate('project.create', { name: '보관할 프로젝트' });
  const task = await domain.mutate('task.create', { title: '보존할 항목' });
  await domain.mutate('task.update', { id: task.id, project_id: project.id });
  const archived = await domain.mutate('project.archive', { id: project.id });
  assert.equal(domain.state(range).tasks[0].kind, 'inbox');
  assert.equal(domain.state(range).tasks[0].project_id, null);
  await domain.mutate('project.restore', archived);
  assert.equal(domain.state(range).tasks[0].project_id, project.id);
  const bundle = domain.exportAll();
  assert.equal(bundle.app, 'whendesk');
  assert.equal(bundle.work.item.length, 1);
  domain.close();
  assert.throws(() => domain.state(range), /닫혀/);
});

test('Future Log는 내일부터 정한 달 수만큼의 단발 일정만 돌려주고 반복 일정과 오늘·기간 밖 일정은 뺀다', async t => {
  const { domain } = setup(t);
  const key = (days, months = 0) => { const now = new Date(), d = new Date(now.getFullYear(), now.getMonth() + months, now.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  await domain.mutate('event.create', { title: '오늘 일정', date: key(0), time: '09:00', end: '10:00' });
  await domain.mutate('event.create', { title: '내일 일정', date: key(1), time: '09:00', end: '10:00' });
  await domain.mutate('event.create', { title: '두 달 뒤', date: key(0, 2), allDay: true });
  await domain.mutate('event.create', { title: '반복 회의', date: key(1), time: '11:00', end: '12:00', rrule: 'FREQ=WEEKLY;COUNT=10' });
  await domain.mutate('event.create', { title: '일곱 달 뒤', date: key(0, 7), allDay: true });
  const result = domain.future({ months: 6 });
  assert.deepEqual(result.events.map(event => event.title).sort(), ['내일 일정', '두 달 뒤']);
  assert.equal(result.from, key(1));
  assert.throws(() => domain.future({ months: 0 }), /기간/);
  assert.equal(domain.future({ months: 12 }).events.some(event => event.title === '일곱 달 뒤'), true);
});

test('일정과 한 줄 메모는 Work 항목이다: 일정은 할 일 목록·완료 기록에 섞이지 않고, 메모는 완료가 없다', async t => {
  const { domain } = setup(t);
  const project = await domain.mutate('project.create', { name: '현장' });
  const event = await domain.mutate('event.create', { title: '현장 회의', date: '2026-10-29', time: '10:00', end: '11:00', project_id: project.id });
  assert.equal(typeof event.id, 'string');
  assert.equal(event.project_id, project.id);
  assert.equal(domain.state(range).tasks.some(task => task.id === event.id), false, '일정이 할 일 목록에 섞였습니다.');
  await assert.rejects(domain.mutate('task.complete', { id: event.id }), /찾을 수 없/);
  const memo = await domain.mutate('task.create', { title: '자재 단가가 올랐다', kind: 'note' });
  assert.equal(memo.kind, 'note');
  await assert.rejects(domain.mutate('task.complete', { id: memo.id }), /메모/);
  await assert.rejects(domain.mutate('task.update', { id: memo.id, due: '2026-11-01' }), /메모/);
  const moved = await domain.mutate('task.update', { id: memo.id, project_id: project.id });
  assert.equal(moved.kind, 'note', '메모에 프로젝트를 정해도 할 일이 되면 안 됩니다.');
  await domain.mutate('event.delete', { id: event.id });
  assert.equal((await domain.mutate('work.archive', {})).some(item => item.id === event.id), false, '지운 일정이 할 일 보관 검색에 나왔습니다.');
  assert.ok(domain.state(range).holidays['2026-10-03'], '공휴일 데이터가 없습니다.');
});

test('처음 열 때 옛 캘린더의 직접 등록 일정(반복·회차 수정 포함)을 한 번만 옮기고 구독 일정은 버린다', async t => {
  const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(temporaryRoot, 'whendesk-legacy-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dataDir, 'calendar'), { recursive: true });
  const { DatabaseSync } = await import('node:sqlite');
  const legacy = new DatabaseSync(path.join(dataDir, 'calendar', 'store.sqlite'));
  legacy.exec(`CREATE TABLE calendar (id INTEGER PRIMARY KEY, kind TEXT, name TEXT, url TEXT, color INTEGER, enabled INTEGER, created_at TEXT);
    CREATE TABLE event (id INTEGER PRIMARY KEY, calendar_id INTEGER, uid TEXT, title TEXT, starts_at TEXT, ends_at TEXT, all_day INTEGER DEFAULT 0, tzid TEXT, rrule TEXT, exdates TEXT, location TEXT, note TEXT, remind_min INTEGER, source_hash TEXT, deleted_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE override (id INTEGER PRIMARY KEY, event_id INTEGER, recurrence_id TEXT, starts_at TEXT, ends_at TEXT, title TEXT, cancelled INTEGER DEFAULT 0);
    INSERT INTO calendar VALUES (1,'local','이 PC',NULL,1,1,'2026-10-01T00:00:00Z'),(2,'subscription','휴일','https://x',2,1,'2026-10-01T00:00:00Z');
    INSERT INTO event (id,calendar_id,title,starts_at,ends_at,rrule,exdates,created_at,updated_at) VALUES
      (1,1,'주간회의','2026-10-06T01:30:00.000Z','2026-10-06T02:30:00.000Z','FREQ=WEEKLY;BYDAY=TU','["2026-10-13T01:30:00.000Z"]','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'),
      (2,1,'치과','2026-10-29T09:00:00.000Z','2026-10-29T10:00:00.000Z',NULL,NULL,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'),
      (3,2,'개천절','2026-10-03T00:00:00.000Z',NULL,NULL,NULL,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'),
      (4,1,'지운 일정','2026-10-20T00:00:00.000Z',NULL,NULL,NULL,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z');
    UPDATE event SET deleted_at='2026-10-02T00:00:00Z' WHERE id=4;
    INSERT INTO override (event_id,recurrence_id,starts_at,ends_at,title) VALUES (1,'2026-10-20T01:30:00.000Z','2026-10-20T05:00:00.000Z','2026-10-20T06:00:00.000Z','주간회의(오후)');`);
  legacy.close();
  const first = createDomain({ dataDir });
  try {
    const titles = first.state(range).events.map(event => event.title);
    assert.ok(titles.includes('치과'));
    assert.ok(titles.includes('주간회의(오후)'), '회차 수정이 옮겨지지 않았습니다.');
    assert.equal(titles.includes('개천절'), false, '구독 일정이 옮겨졌습니다.');
    assert.equal(titles.includes('지운 일정'), false);
    const meetings = first.state(range).events.filter(event => event.title.startsWith('주간회의')).map(event => event.date);
    assert.equal(meetings.includes('2026-10-13'), false, '제외일이 옮겨지지 않았습니다.');
    assert.ok(meetings.includes('2026-10-27'), '반복이 옮겨지지 않았습니다.');
  } finally { first.close(); }
  const second = createDomain({ dataDir });
  try { assert.equal(second.calendar.allEvents().length, 2, '두 번째 실행에서 다시 옮겼습니다.'); }
  finally { second.close(); }
  assert.ok(fs.existsSync(path.join(dataDir, 'calendar', 'store.sqlite')), '옛 캘린더 파일을 지웠습니다.');
});

test('처음 열 때 첨부·링크 없는 한 줄 Note는 Work 메모 항목으로 옮기고 원본은 휴지통에 둔다', async t => {
  const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(temporaryRoot, 'whendesk-notes-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const before = createDomain({ dataDir });
  let short, long;
  try {
    short = await before.mutate('note.create', { body: '견적 회신은 금요일까지' });
    long = await before.mutate('note.create', { body: '회의록\n- 첫째\n- 둘째' });
    // 이미 옮기기를 마친 저장소라 표시를 지워 처음 여는 것처럼 만든다.
    before.work.close();
  } finally { before.close(); }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dataDir, 'work', 'store.sqlite'));
  db.exec("DELETE FROM event WHERE kind = 'notes.imported'");
  db.close();
  const after = createDomain({ dataDir });
  try {
    const memo = after.state(range).tasks.find(task => task.kind === 'note');
    assert.equal(memo?.title, '견적 회신은 금요일까지');
    assert.equal((await after.mutate('note.get', { id: short.id })).deleted, true, '옮긴 원본이 휴지통에 가지 않았습니다.');
    assert.equal((await after.mutate('note.get', { id: long.id })).deleted, false, '여러 줄 메모까지 옮겼습니다.');
  } finally { after.close(); }
});
