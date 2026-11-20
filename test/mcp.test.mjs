import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDomain } from '../main/domain.mjs';
import { createReader } from '../mcp/read.mjs';
import { dayKey } from '../modules/work/main/brief.mjs';

const SERVER = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));

// 앱이 켜진 채로(도메인이 DB를 쥔 채로) 읽는다 — 실제 사용과 같은 조건이다.
async function setup(t) {
  const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(temporaryRoot, 'whendesk-mcp-'));
  const domain = createDomain({ dataDir });
  t.after(() => { domain.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const today = dayKey();
  const shift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return dayKey(d); };
  const project = await domain.mutate('project.create', { name: 'WHENDESK' });
  const late = await domain.mutate('task.create', { title: '지난 마감 할 일' });
  await domain.mutate('task.update', { id: late.id, project_id: project.id, due: shift(-2), note: '상세 내용' });
  const due = await domain.mutate('task.create', { title: '오늘 마감' });
  await domain.mutate('task.update', { id: due.id, kind: 'todo', due: today });
  const wait = await domain.mutate('task.create', { title: '회신 기다림' });
  await domain.mutate('task.update', { id: wait.id, kind: 'waiting', waitingFor: '김 담당' });
  await domain.mutate('task.create', { title: '분류 전' });
  const finished = await domain.mutate('task.create', { title: '끝낸 일' });
  await domain.mutate('task.update', { id: finished.id, kind: 'todo' });
  await domain.mutate('task.complete', { id: finished.id, done: true });
  const gone = await domain.mutate('task.create', { title: '지운 일' });
  await domain.mutate('task.update', { id: gone.id, kind: 'todo' });
  await domain.mutate('task.delete', { id: gone.id });
  await domain.mutate('task.create', { title: '한 줄 메모', kind: 'note' });
  const start = new Date(); start.setHours(15, 0, 0, 0);
  await domain.mutate('event.create', { title: '주간 회의', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600_000).toISOString() });
  const n1 = await domain.mutate('note.create', { body: '배포 체크리스트\n릴리스 전에 서명 확인 #release' });
  const n2 = await domain.mutate('note.create', { body: '보관한 메모\n옛 배포 기록 #release' });
  await domain.mutate('note.archive', { id: n2.id, on: true });
  return { domain, dataDir, ids: { late: late.id, gone: gone.id, n1: n1.id, n2: n2.id }, today, shift };
}

test('오늘 저널은 대시보드와 같은 칸으로 나뉘고 지운 일·InBox는 목록에서 빠진다', async (t) => {
  const { dataDir, today } = await setup(t);
  const r = createReader({ dataDir }).today();
  assert.equal(r.date, today);
  assert.deepEqual(r.carryOver.map((x) => x.title), ['지난 마감 할 일']);
  assert.equal(r.carryOver[0].project, 'WHENDESK');
  assert.equal(r.carryOver[0].hasNote, true);
  assert.deepEqual(r.dueToday.map((x) => x.title), ['오늘 마감']);
  assert.deepEqual(r.waiting.map((x) => [x.title, x.waitingFor]), [['회신 기다림', '김 담당']]);
  assert.deepEqual(r.done.map((x) => [x.title, x.status]), [['끝낸 일', 'done']]);
  assert.deepEqual(r.notes.map((x) => x.title), ['한 줄 메모']);
  assert.deepEqual(r.events.map((x) => x.title), ['주간 회의']);
  assert.equal(r.inboxCount, 1);
  assert.ok(!JSON.stringify(r).includes('지운 일'));
});

test('할 일 목록·상세·프로젝트는 지운 것을 숨기고 조건으로 거른다', async (t) => {
  const { dataDir, ids, shift } = await setup(t);
  const reader = createReader({ dataDir });
  const open = reader.listTasks();
  assert.equal(open.tasks[0].title, '지난 마감 할 일'); // 마감 빠른 순, 마감 없는 일은 뒤
  assert.ok(!open.tasks.some((x) => x.title === '지운 일' || x.title === '끝낸 일'));
  assert.deepEqual(reader.listTasks({ kind: 'waiting' }).tasks.map((x) => x.title), ['회신 기다림']);
  assert.deepEqual(reader.listTasks({ project: 'whendesk' }).tasks.map((x) => x.title), ['지난 마감 할 일']);
  assert.deepEqual(reader.listTasks({ dueFrom: shift(-1) }).tasks.map((x) => x.title), ['오늘 마감']);
  assert.deepEqual(reader.listTasks({ query: '상세' }).tasks.map((x) => x.title), ['지난 마감 할 일']);
  assert.deepEqual(reader.listTasks({ status: 'done' }).tasks.map((x) => x.title), ['끝낸 일']);
  assert.equal(reader.listTasks({ limit: 1 }).truncated, true);
  assert.equal(reader.getTask(ids.late).note, '상세 내용');
  assert.equal(reader.getTask(ids.gone), null);
  assert.deepEqual(reader.listProjects(), [{ name: 'WHENDESK', openTasks: 1 }]);
  assert.throws(() => reader.listTasks({ dueFrom: '2026/1/1' }), /YYYY-MM-DD/);
});

test('메모는 앱과 같은 검색 규칙을 쓰고 보관한 메모는 옵션을 켤 때만 보인다', async (t) => {
  const { dataDir, ids } = await setup(t);
  const reader = createReader({ dataDir });
  assert.deepEqual(reader.searchNotes({ query: '체크리스트' }).notes.map((x) => x.title), ['배포 체크리스트']);
  assert.deepEqual(reader.searchNotes({ query: '#release' }).notes.map((x) => x.id), [ids.n1]);
  assert.deepEqual(reader.searchNotes({ query: 'ㅂㅍ' }).notes.map((x) => x.id), [ids.n1]);
  assert.match(reader.getNote(ids.n1).body, /서명 확인/);
  assert.equal(reader.getNote(ids.n1).attachments, undefined);
  assert.equal(reader.getNote(ids.n2), null);
  assert.throws(() => reader.searchNotes({ archived: true }), /보관한 메모/);
  assert.deepEqual(reader.listNoteTags(), [{ tag: 'release', count: 1 }]);

  const wide = createReader({ dataDir, includeArchived: true, includeAttachments: true });
  assert.deepEqual(wide.searchNotes({ archived: true }).notes.map((x) => x.id), [ids.n2]);
  assert.equal(wide.getNote(ids.n2).archived, true);
  assert.deepEqual(wide.getNote(ids.n1).attachments, []);
});

test('데이터 폴더가 없으면 고칠 방법을 말한다', () => {
  assert.throws(() => createReader({ dataDir: path.join(fileURLToPath(new URL('./.tmp/', import.meta.url)), 'nowhere') }).today(), /데이터 파일이 없습니다/);
});

// 프로토콜 끝에서 끝까지 — 줄 단위 JSON-RPC로 초기화·도구 목록·호출을 확인한다.
test('stdio 서버가 초기화·도구 목록·호출에 답한다', async (t) => {
  const { dataDir } = await setup(t);
  const child = spawn(process.execPath, [SERVER, '--data-dir', dataDir], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const waiting = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg); waiting.delete(msg.id);
    }
  });
  let seq = 0;
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => reject(new Error(`${method} 응답 없음`)), 10_000);
    waiting.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'whendesk');
  assert.ok(init.result.capabilities.tools);
  assert.match(init.result.instructions, /읽기만/);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await call('tools/list', {});
  const names = list.result.tools.map((x) => x.name).sort();
  assert.deepEqual(names, ['get_note', 'get_task', 'list_events', 'list_note_tags', 'list_projects', 'list_tasks', 'search_notes', 'today']);
  assert.ok(list.result.tools.every((x) => x.annotations?.readOnlyHint === true));
  const today = await call('tools/call', { name: 'today', arguments: {} });
  assert.equal(today.result.isError, undefined);
  assert.deepEqual(JSON.parse(today.result.content[0].text).carryOver.map((x) => x.title), ['지난 마감 할 일']);
  const bad = await call('tools/call', { name: 'list_events', arguments: { from: '2026-12-31', to: '2026-01-01' } });
  assert.equal(bad.result.isError, true);
});

test('설정의 연결 글은 앱 실행 파일을 Node로 띄우고 데이터 폴더를 환경변수로 넘긴다', async () => {
  const { serverSpec, claudeCodeCommand, claudeDesktopSnippet } = await import('../mcp/connect.mjs');
  const exe = String.raw`C:\Program Files\WHENDESK\WHENDESK.exe`, appPath = String.raw`C:\Program Files\WHENDESK\resources\app`, dataDir = String.raw`C:\Users\me\AppData\Roaming\whendesk`;
  const spec = serverSpec({ execPath: exe, appPath, dataDir });
  const script = path.join(appPath, 'mcp', 'server.mjs');
  assert.deepEqual(spec.args, [script]);
  // --env 바로 뒤에 이름이 오지 않고, 서버 쪽 플래그가 없어 `--` 구분자가 필요 없다
  assert.equal(claudeCodeCommand(spec), `claude mcp add --scope user --env "ELECTRON_RUN_AS_NODE=1" "WHENDESK_DATA_DIR=${dataDir}" --transport stdio whendesk "${exe}" "${script}"`);
  const desktop = JSON.parse(claudeDesktopSnippet(spec)).mcpServers.whendesk;
  assert.deepEqual(desktop, { command: exe, args: [script], env: { ELECTRON_RUN_AS_NODE: '1', WHENDESK_DATA_DIR: dataDir } });
});
