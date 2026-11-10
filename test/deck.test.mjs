import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import { summarize, captureIntent, DeckBridge, localDay } from '../main/deck.mjs';

const context = {};
vm.runInNewContext(fs.readFileSync(new URL('../renderer/rapid.js', import.meta.url), 'utf8'), context);
const rapid = context.WhendeskRapid;

const NOW = new Date(2026, 10, 10, 14, 0); // 11월 10일 14:00 (로컬)
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();
const item = (over) => ({ id: over.id, project_id: null, kind: 'todo', title: over.id, due: null, captured_at: at(9, 9), done_at: null, deleted_at: null, cancelled: 0, postponed: 0, nudged_at: null, ...over });

test('summarize: 대시보드와 같은 순서로 열린 할 일을 낸다', () => {
  const s = summarize({
    now: NOW,
    projects: [{ id: 1, name: '덱' }],
    items: [
      item({ id: 'a', due: null }),
      item({ id: 'b', due: '2026-11-12', project_id: 1 }),
      item({ id: 'c', due: '2026-11-08', postponed: 3 }),
      item({ id: 'd', done_at: at(10, 9) }),
      item({ id: 'e', deleted_at: at(10, 9) }),
      item({ id: 'f', kind: 'inbox' }),
    ],
  });
  assert.deepEqual(s.todos.map(t => t.id), ['c', 'b', 'a']);
  assert.equal(s.todos[1].project, '덱');
  assert.equal(s.todos[0].postponed, 3);
  assert.equal(s.today, '2026-11-10');
});

test('summarize: 개수 — 마감은 분류와 관계없이, 오늘 완료는 취소를 빼고 센다', () => {
  const { counts } = summarize({
    now: NOW,
    items: [
      item({ id: 'over', due: '2026-11-09' }),
      item({ id: 'inboxOver', kind: 'inbox', due: '2026-11-01' }),
      item({ id: 'today', due: '2026-11-10' }),
      item({ id: 'w1', kind: 'waiting', captured_at: at(1, 9) }),
      item({ id: 'w2', kind: 'waiting', captured_at: at(1, 9), nudged_at: at(9, 9) }),
      item({ id: 'done', done_at: at(10, 9) }),
      item({ id: 'cancel', done_at: at(10, 10), cancelled: 1 }),
      item({ id: 'yesterday', done_at: at(9, 9) }),
      item({ id: 'p', postponed: 4 }),
    ],
  });
  assert.deepEqual(counts, { todo: 3, inbox: 1, waiting: 2, overdue: 2, dueToday: 1, staleWaiting: 1, postponed: 1, doneToday: 1 });
});

test('summarize: 다음 일정은 끝나지 않은 첫 일정, 진행 중이면 그것', () => {
  const events = [
    { id: 1, title: '지난 회의', startsAt: at(10, 9), endsAt: at(10, 10) },
    { id: 2, title: '진행 중', startsAt: at(10, 13, 30), endsAt: at(10, 14, 30) },
    { id: 3, title: '나중', startsAt: at(10, 16), endsAt: at(10, 17) },
    { id: 4, title: '내일', startsAt: at(11, 9), endsAt: at(11, 10) },
    { id: 5, title: '종일', allDay: true, startsAt: new Date(2026, 10, 10).toISOString(), endsAt: new Date(2026, 10, 11).toISOString() },
  ];
  const s = summarize({ now: NOW, events });
  assert.equal(s.next.title, '진행 중');
  assert.deepEqual(s.events, { total: 4, remaining: 2, allDay: ['종일'] });
  const later = summarize({ now: new Date(2026, 10, 10, 18), events });
  assert.equal(later.next.title, '내일');
  assert.equal(later.events.remaining, 0);
});

test('captureIntent: 접두 기호를 따르고, 없으면 할 일', () => {
  assert.deepEqual({ ...captureIntent('보고서 쓰기', rapid) }, { kind: 'task', text: '보고서 쓰기' });
  assert.deepEqual({ ...captureIntent('. 보고서', rapid) }, { kind: 'task', text: '보고서' });
  assert.deepEqual({ ...captureIntent('- 생각', rapid) }, { kind: 'note', text: '생각' });
  assert.deepEqual({ ...captureIntent('@ 내일 3시 회의', rapid) }, { kind: 'event', text: '내일 3시 회의' });
  assert.equal(captureIntent('   ', rapid), null);
  assert.equal(captureIntent('-3도', rapid).kind, 'task');
});

test('localDay는 로컬 날짜를 쓴다', () => {
  assert.equal(localDay(new Date(2026, 0, 1, 0, 30)), '2026-01-01');
});

function request(port, { method = 'GET', path = '/state', host = `127.0.0.1:${port}`, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Host: host };
    if (origin) headers.Origin = origin;
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('DeckBridge: 상태·쓰기·거절', async t => {
  const calls = [];
  let busy = false;
  const port = 37690 + Math.floor(Math.random() * 200);
  const bridge = new DeckBridge({
    busy: () => busy,
    snapshot: () => ({ counts: { todo: 1 } }),
    complete: async (id, done) => { calls.push(['complete', id, done]); },
    cancel: async (id, cancelled) => { calls.push(['cancel', id, cancelled]); },
    capture: async text => { calls.push(['capture', text]); return { kind: 'task', message: 'ok' }; },
    clipboard: () => '  ',
    open: (view, opts) => { calls.push(['open', view, opts]); },
  }, { port });
  bridge.start();
  await new Promise(r => bridge.server.once('listening', r));
  t.after(() => bridge.stop());

  const state = await request(port);
  assert.equal(state.status, 200);
  assert.equal(state.body.counts.todo, 1);

  assert.equal((await request(port, { host: 'evil.example:80' })).status, 403);
  assert.equal((await request(port, { origin: 'https://evil.example' })).status, 403);

  assert.equal((await request(port, { method: 'POST', path: '/task/complete?id=a' })).status, 200);
  assert.equal((await request(port, { method: 'POST', path: '/task/complete?id=a&done=0' })).status, 200);
  assert.equal((await request(port, { method: 'POST', path: '/task/cancel?id=b' })).status, 200);
  assert.equal((await request(port, { method: 'POST', path: '/task/complete' })).status, 400);
  assert.equal((await request(port, { method: 'POST', path: '/capture', body: JSON.stringify({ text: '. 사기' }) })).status, 200);
  const empty = await request(port, { method: 'POST', path: '/capture/clipboard' });
  assert.equal(empty.status, 409);
  assert.match(empty.body.error, /클립보드/);
  assert.equal((await request(port, { method: 'POST', path: '/open?view=calendar&id=3&date=2026-11-10' })).status, 204);

  busy = true;
  assert.equal((await request(port, { method: 'POST', path: '/task/complete?id=a' })).status, 503);

  assert.deepEqual(calls, [
    ['complete', 'a', true],
    ['complete', 'a', false],
    ['cancel', 'b', true],
    ['capture', '. 사기'],
    ['open', 'calendar', { id: '3', date: '2026-11-10' }],
  ]);
});
