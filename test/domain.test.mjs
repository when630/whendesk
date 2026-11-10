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
  assert.equal(domain.calendar.countEvents(), 0);
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

test('구독 일정은 수정·삭제할 수 없고 동기화 실패에도 기존 내용이 남는다', async t => {
  let fail = false;
  const { domain } = setup(t, { fetchImpl: async () => fail ? { ok: false, status: 503 } : { ok: true, status: 200, text: async () => sampleIcs, headers: { get: () => null } } });
  const sub = await domain.mutate('subscription.add', { url: 'https://example.test/calendar.ics' });
  assert.equal(sub.ok, true);
  const event = domain.state(range).events.find(item => item.calendarId === sub.id);
  assert.equal(event.readonly, true);
  await assert.rejects(domain.mutate('event.update', { id: event.id, title: '막혀야 함' }), /읽기 전용/);
  await assert.rejects(domain.mutate('event.delete', { id: event.id }), /읽기 전용/);
  fail = true;
  const synced = await domain.mutate('subscription.sync', { id: sub.id });
  assert.equal(synced.ok, false);
  assert.equal(domain.state(range).events.find(item => item.id === event.id).title, '구독 일정');
  await domain.mutate('subscription.toggle', { id: sub.id, enabled: false });
  assert.equal(domain.state(range).events.length, 0);
});

test('ICS 가져오기·내보내기는 수정 회차와 제외일을 잃지 않는다', async t => {
  const { domain } = setup(t);
  const event = await domain.mutate('event.create', { title: '반복', date: '2026-10-26', time: '09:00', end: '10:00', rrule: 'FREQ=DAILY;COUNT=4' });
  const occurrences = domain.state(range).events;
  await domain.mutate('event.update', { id: event.id, recurrenceId: occurrences[1].recurrenceId, scope: 'one', title: '한 번 바꾼 내용' });
  await domain.mutate('event.delete', { id: event.id, recurrenceId: occurrences[2].recurrenceId, scope: 'one' });
  const content = await domain.mutate('ics.export');
  assert.match(content, /RECURRENCE-ID/);
  assert.match(content, /EXDATE/);
  const imported = await domain.mutate('ics.import', { text: content });
  const events = domain.state(range).events.filter(item => item.calendarId === imported.calendarId);
  assert.equal(events.length, 3);
  assert.ok(events.some(item => item.title === '한 번 바꾼 내용'));
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
