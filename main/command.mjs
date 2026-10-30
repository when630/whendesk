// WHENCOMMAND의 검색·별칭·계산·랭킹·OS 공급원을 WHENDESK 저장소에 연결한다.
// 렌더러에는 실행 사양을 노출하지 않고, 직전 질의에서 발급한 key만 실행한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { match } from '../modules/command/main/search.mjs';
import { rank } from '../modules/command/main/rank.mjs';
import { DEFAULT_ALIASES, aliasesFor, loadUserAliases, mergeAliases, matchWithAliases } from '../modules/command/main/aliases.mjs';
import { calc, convert } from '../modules/command/main/sources/calc.mjs';
import { createStore } from '../modules/command/main/store.mjs';
import { parseHeader, lineCount } from '../modules/command/main/scripts.mjs';
import { actionsFor, altAction } from '../modules/command/main/actions.mjs';
import { detectIntents } from '../modules/command/main/intent.mjs';

const MAX_ROWS = 12;
const MAX_TEXT = 8192;
const MAX_OUTPUT = 256 * 1024;
const FILE_WEIGHT = .85;
const MIN_FILE_CHARS = 3;
const DANGEROUS_SYSTEM = new Set(['lock', 'sleep', 'empty-trash']);

const messageOf = error => String(error?.message ?? error);
const readText = file => { try { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; } };
const compactDir = file => path.dirname(file).startsWith(os.homedir()) ? '~' + path.dirname(file).slice(os.homedir().length) : path.dirname(file);

function publicItem(item) {
  const actions = actionsFor(item).map(({ id, title }) => ({ id, title }));
  const preferredAlt = item.action?.type === 'capture-task' ? 'add-open' : { files: 'reveal', apps: 'reveal', scripts: 'edit' }[item.source];
  return { key: item.key, title: item.title, subtitle: item.subtitle || '', source: item.source,
    icon: item.icon || 'command', kind: item.kind, positions: item.positions || [], via: item.via || null,
    ...(item.path ? { path: item.path } : {}), actions,
    altId: actions.some(x => x.id === preferredAlt) ? preferredAlt : null,
    final: item.final };
}

function localDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function executeFile(command, args) {
  return new Promise((resolve, reject) => execFile(command, args, { windowsHide: true, timeout: 15000, maxBuffer: MAX_OUTPUT },
    (error, stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim())) : resolve(String(stdout || '').trim())));
}

export function createCommand({ dataDir, domain, onMore, platform: providedPlatform, effects: providedEffects, fileDebounceMs = 120, fileTimeoutMs = 1500 }) {
  if (!dataDir || !domain) throw new Error('Command 데이터 폴더와 저장소가 필요합니다.');
  const commandDir = path.join(dataDir, 'command');
  const scriptsDir = path.join(commandDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const store = createStore(path.join(commandDir, 'whencommand.db'));
  store.picks(); // 원본 pick의 첫 쓰기도 기존 hits를 기준으로 계산하도록 캐시를 먼저 읽는다.
  let platform = providedPlatform;
  let effects = providedEffects;
  let apps = [], scripts = [], system = [];
  let fileSearch = null;
  let readyPromise = null;
  let closed = false;
  let appError = '', fileError = '', scriptError = '';
  let cache = new Map();
  let generation = 0;
  let pendingFile = null;
  let queryText = '';
  const runningScripts = new Set();

  const ensureOpen = () => { if (closed) throw new Error('Command가 종료되었습니다.'); };

  async function dependencies() {
    if (!platform) ({ platform } = await import('../modules/command/main/platform/index.mjs'));
    if (!effects) {
      const electron = await import('electron');
      effects = { shell: electron.shell, clipboard: electron.clipboard, dialog: electron.dialog };
    }
  }

  function scanScripts() {
    const found = new Map();
    scriptError = '';
    // 기존 사용자 스크립트는 읽기만 한다. WHENDESK용 추가 파일은 자기 폴더에 둔다.
    for (const dir of [path.join(os.homedir(), '.whencommand', 'scripts'), scriptsDir]) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (error) {
        if (dir === scriptsDir) scriptError = `스크립트 폴더를 읽지 못했습니다: ${messageOf(error)}`;
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.startsWith('.')) continue;
        const file = path.join(dir, entry.name);
        if (!platform.scriptRunner(file)) continue;
        let content = '';
        let fd;
        try {
          fd = fs.openSync(file, 'r');
          const bytes = Buffer.alloc(4096);
          content = bytes.subarray(0, fs.readSync(fd, bytes, 0, bytes.length, 0)).toString('utf8').replace(/^\uFEFF/, '');
        } catch { continue; } finally { if (fd !== undefined) fs.closeSync(fd); }
        found.set(path.resolve(file), { ...parseHeader(content, entry.name), path: file });
      }
    }
    scripts = [...found.values()];
  }

  async function loadApps() {
    try {
      const table = mergeAliases(DEFAULT_ALIASES, {
        ...loadUserAliases(readText(path.join(os.homedir(), '.whencommand', 'aliases.json'))),
        ...loadUserAliases(readText(path.join(commandDir, 'aliases.json'))),
      });
      const list = await platform.listApps();
      if (closed) return;
      apps = list.filter(a => a?.name && a.path).map(a => ({ ...a,
        aliases: [...new Set([...aliasesFor(a.name, table), ...(a.alt ? [a.alt, ...aliasesFor(a.alt, table)] : [])])],
      }));
      appError = apps.length ? '' : '설치된 앱 목록을 찾지 못했습니다.';
    } catch (error) { appError = `앱 목록을 읽지 못했습니다: ${messageOf(error)}`; }
  }

  async function startFiles() {
    try {
      fileSearch = platform.createFileSearch();
      let timer;
      const result = await Promise.race([fileSearch.ready(), new Promise(resolve => {
        timer = setTimeout(() => resolve({ ok: false, reason: '파일 검색 준비 시간이 초과되었습니다.' }), 8000);
      })]);
      clearTimeout(timer);
      if (closed) return fileSearch.dispose?.();
      if (!result?.ok && !fileSearch.status().ok) fileError = result?.reason || fileSearch.status().reason || '파일 검색을 사용할 수 없습니다.';
    } catch (error) { fileError = `파일 검색을 준비하지 못했습니다: ${messageOf(error)}`; }
  }

  async function ready() {
    ensureOpen();
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      await dependencies();
      system = platform.systemCommands?.() || [];
      scanScripts();
      await Promise.all([loadApps(), startFiles()]);
      return status();
    })();
    return readyPromise;
  }

  function status() {
    return { appCount: apps.length, scripts: scripts.length, scriptsDir,
      apps: { ok: !appError && apps.length > 0, reason: appError || (!readyPromise ? '앱 목록을 준비하고 있습니다.' : '') },
      files: fileSearch?.status?.() || { ok: false, reason: fileError || '파일 검색을 준비하고 있습니다.' },
      scriptError };
  }

  function addMatched(out, q, item, weight = 1) {
    const titleMatch = match(q, item.title);
    const combined = item.searchText ? match(q, `${item.title} ${item.searchText}`) : null;
    // 상세 내용이 길어도 제목의 정확한 일치 점수는 유지한다. 상세 검색과 필드 사이의 질의도 계속 지원한다.
    const matched = combined && combined.score * .8 > titleMatch.score
      ? { ...combined, score: combined.score * .8, positions: combined.positions.filter(position => position < item.title.length) }
      : titleMatch;
    if (matched.score > 0) out.push({ ...item, base: matched.score * weight, positions: matched.positions, via: matched.via });
  }

  function navigationItems(q) {
    const out = [];
    const entries = [
      ['dashboard', '대시보드', { view: 'dashboard' }, 'panels-top-left', 'Dashboard Home'],
      ['work', 'Work', { view: 'work' }, 'briefcase-business', '작업 워크 WHENWORK'],
      ['todo', '할 일', { view: 'tasks', tab: 'todo' }, 'circle-check', 'ToDo'],
      ['inbox', '인박스', { view: 'tasks', tab: 'inbox' }, 'inbox', 'InBox'],
      ['waiting', '대기', { view: 'tasks', tab: 'waiting' }, 'hourglass', 'Waiting'],
      ['done', '완료 기록', { view: 'tasks', tab: 'done' }, 'archive', 'Done'],
      ['notes', '메모', { view: 'notes' }, 'notebook-pen', '노트 WHENNOTE Note notes'],
      ['calendar', '캘린더', { view: 'calendar' }, 'calendar-days', 'Calendar'],
      ['settings', '설정', { view: 'dashboard', settings: true }, 'settings-2', 'Settings'],
    ];
    for (const [id, title, route, icon, aliases] of entries) addMatched(out, q, { key: `builtin:${id}`, source: 'builtin', title,
      subtitle: 'WHENDESK', searchText: aliases, icon, action: { type: 'route', route } }, .9);
    addMatched(out, q, { key: 'builtin:scripts', source: 'builtin', title: '스크립트 폴더', subtitle: scriptsDir,
      icon: 'folder', action: { type: 'open-path', path: scriptsDir } }, .9);
    addMatched(out, q, { key: 'builtin:refresh', source: 'builtin', title: '앱 목록 새로고침', subtitle: '앱과 스크립트 목록 갱신',
      icon: 'refresh-cw', action: { type: 'refresh' } }, .9);
    return out;
  }

  function domainItems(q) {
    const out = [];
    const state = domain.state();
    for (const task of state.tasks || []) {
      if (task.deleted) continue;
      addMatched(out, q, { key: `tasks:${task.id}`, source: 'tasks', title: task.title,
        subtitle: [task.done ? '완료' : task.kind === 'waiting' ? '대기' : task.kind === 'inbox' ? '인박스' : '할 일', task.project, task.due].filter(Boolean).join(' · '),
        searchText: [task.note, task.waitingFor, task.project].filter(Boolean).join(' '), icon: 'circle-check',
        action: { type: 'route', route: { view: 'tasks', tab: task.done ? 'done' : task.kind, id: task.id } } }, .9);
    }
    // 저장소의 검색은 선택된 달 밖의 일정도 찾는다.
    const events = typeof domain.calendar?.searchEvents === 'function' ? domain.calendar.searchEvents(q) : (state.events || []);
    for (const event of events) {
      addMatched(out, q, { key: `events:${event.id}`, source: 'events', title: event.title,
        subtitle: [event.startsAt || event.starts_at || event.date, event.location].filter(Boolean).join(' · '),
        icon: 'calendar-days', action: { type: 'route', route: { view: 'calendar', id: event.id,
          date: event.date || localDate(event.startsAt || event.starts_at) } } }, .85);
    }
    if (typeof domain.note?.searchNotes === 'function') {
      // WHENNOTE의 초성·본문·#태그 검색 규칙은 저장 모듈에 맡긴다. 검색 결과는 활성 메모만 포함한다.
      const found = domain.note.searchNotes({ q, limit:MAX_ROWS * 2, archived:false });
      for (const note of found.items || []) {
        const matched = match(q, note.title);
        out.push({ key:`notes:${note.id}`, source:'notes', title:note.title,
          subtitle:[...(note.tags || []).map(tag => '#' + tag), note.snippet].filter(Boolean).join(' · '),
          icon:'notebook-pen', base:Math.max(matched.score * .9, .55), positions:matched.positions, via:matched.via,
          action:{ type:'route', route:{ view:'notes', id:note.id } } });
      }
    } else {
      for (const note of state.notes || []) {
        if (note.deleted || note.deleted_at || note.archived || note.archived_at) continue;
        addMatched(out, q, { key:`notes:${note.id}`, source:'notes', title:note.title,
          subtitle:note.snippet || '', searchText:[note.body, ...(note.tags || [])].filter(Boolean).join(' '), icon:'notebook-pen',
          action:{ type:'route', route:{ view:'notes', id:note.id } } }, .9);
      }
    }
    return out;
  }

  function captureItems(q) {
    const out = [];
    const todo = q.match(/^(?:할\s*일\s*추가|투두\s*추가|todo\s+add)\s+(.+)$/i);
    const schedule = q.match(/^(?:일정\s*추가|약속\s*추가)\s+(.+)$/i);
    const note = q.match(/^(?:메모\s*추가|노트\s*추가|note\s+add)(?:\s+([\s\S]+))?$/i);
    if (todo) out.push({ key: 'capture:todo', source: 'tasks', title: `할 일 추가: ${todo[1]}`, subtitle: '인박스에 저장', icon: 'circle-plus', base: 1.5,
      action: { type: 'capture-task', text: todo[1] } });
    if (schedule) out.push({ key: 'capture:event', source: 'events', title: `일정 추가: ${schedule[1]}`, subtitle: '날짜와 시간을 해석해 저장', icon: 'calendar-plus', base: 1.5,
      action: { type: 'capture-event', text: schedule[1] } });
    if (note) out.push({ key:'capture:note', source:'notes', title:note[1] ? `메모 추가: ${note[1]}` : '새 메모', subtitle:'메모에 저장', icon:'notebook-pen', base:1.5,
      action:{ type:'capture-note', text:note[1] || '' } });
    if (!todo && !schedule && !note) {
      for (const intent of detectIntents(q).filter(x => ['todo', 'schedule'].includes(x.intent)).slice(0, 1)) {
        out.push({ key: `intent:${intent.intent}`, source: intent.intent === 'todo' ? 'tasks' : 'events',
          title: intent.intent === 'todo' ? '할 일 추가' : '일정 추가', subtitle: q, icon: intent.intent === 'todo' ? 'circle-plus' : 'calendar-plus', base: .6,
          action: { type: intent.intent === 'todo' ? 'capture-task' : 'capture-event', text: q } });
      }
    }
    return out;
  }

  function fileItems(q, rows) {
    return rows.filter(r => r?.path && r.name).flatMap(r => {
      let isDir = r.isDir;
      if (isDir == null) { try { isDir = fs.statSync(r.path).isDirectory(); } catch { return []; } }
      const m = match(q, r.name);
      return [{ key: `files:${r.path}`, source: 'files', kind: isDir ? 'dir' : 'file', title: r.name,
        subtitle: compactDir(r.path), icon: isDir ? 'folder' : 'file', base: Math.max(m.score, .15) * FILE_WEIGHT,
        action: { type: 'open-path', path: r.path }, alt: { type: 'reveal', path: r.path }, positions: m.positions, via: m.via }];
    });
  }

  function cancelPending() {
    if (!pendingFile) return;
    clearTimeout(pendingFile.timer);
    pendingFile = null;
  }

  function lateFiles(q, seq, token, fastItems = [], fallback = []) {
    cancelPending();
    const pending = { timer: null };
    pendingFile = pending;
    const publish = (files, notice = null) => {
      if (closed || generation !== token || pendingFile !== pending) return;
      pendingFile = null;
      const candidates = [...fastItems, ...files];
      const items = rank(candidates.length ? candidates : fallback, store.picks()).slice(0, MAX_ROWS);
      // 같은 질의에서 이미 표시한 동작 메뉴의 대상은 순위 밖으로 밀려도 유효하다. 새 질의가 시작될 때만 비운다.
      for (const item of items) cache.set(item.key, item);
      // 빠른 결과와 파일을 같은 기준으로 정렬한다. 렌더러는 key로 선택을 유지한 채 전체 목록을 교체한다.
      onMore?.({ seq, query: q, items: items.map(publicItem), replace: true, pending: false, notice });
    };
    pending.timer = setTimeout(async () => {
      let guard;
      try {
        const result = await Promise.race([
          Promise.resolve(fileSearch.query(q, 30)).then(rows => ({ rows })),
          new Promise(resolve => { guard = setTimeout(() => resolve({ rows: [], timedOut: true }), fileTimeoutMs); }),
        ]);
        clearTimeout(guard);
        publish(fileItems(q, result.rows || []), result.timedOut ? '파일 검색 응답 시간이 초과되었습니다.' : null);
      } catch (error) {
        clearTimeout(guard);
        publish([], `파일 검색 실패: ${messageOf(error)}`);
      }
    }, fileDebounceMs);
  }

  async function query(raw, seq = 0) {
    ensureOpen();
    const q = String(raw ?? '').trim().slice(0, MAX_TEXT);
    queryText = q;
    const token = ++generation;
    cancelPending();
    cache = new Map();
    if (!q) return { seq, query: q, items: [], empty: true, pending: false, appCount: apps.length,
      notice: appError || (!readyPromise ? '앱 목록을 준비하고 있습니다.' : null) };
    const found = [];
    const result = convert(q) || calc(q);
    if (result) found.push({ key: `calc:${result.kind}`, source: 'calc', title: result.display, subtitle: result.expr,
      icon: 'calculator', base: 3, action: { type: 'copy', text: result.display } });
    for (const app of apps) {
      const m = matchWithAliases(q, app.name, app.aliases);
      if (m.score > 0) found.push({ key: `apps:${app.path}`, source: 'apps', title: app.name,
        subtitle: m.via === 'alias' ? `별칭 ${m.alias}` : '', icon: 'app-window', path: app.path,
        base: m.score, positions: m.positions, via: m.via, action: { type: 'open-app', path: app.path } });
    }
    found.push(...navigationItems(q), ...domainItems(q), ...captureItems(q));
    for (const script of scripts) addMatched(found, q, { key: `scripts:${script.path}`, source: 'scripts', title: script.name,
      subtitle: script.description, icon: 'file-code', action: { type: 'run-script', path: script.path, args: [] } });
    for (const command of system) addMatched(found, q, { key: `system:${command.id}`, source: 'system', title: command.title,
      subtitle: command.description, icon: 'settings-2', action: { type: 'system', id: command.id } }, .9);
    const fallback = [];
    if (!found.length) {
      for (const script of scripts.filter(x => x.fallback)) fallback.push({ key: `scripts:${script.path}`, source: 'scripts', title: script.name,
        subtitle: q, icon: 'file-code', base: .8, action: { type: 'run-script', path: script.path, args: [q] } });
      // 기존 WHENWORK의 명시적 '할 일 추가' 폴백을 로컬 저장소에 연결한다.
      fallback.push({ key: 'capture:fallback', source: 'tasks', title: `할 일 추가: ${q}`, subtitle: '인박스에 저장',
        icon: 'circle-plus', base: .4, action: { type: 'capture-task', text: q } });
    }
    const pending = q.length >= MIN_FILE_CHARS && !!fileSearch?.status?.().ok;
    const items = rank(found.length || pending ? found : fallback, store.picks()).slice(0, MAX_ROWS);
    cache = new Map(items.map(item => [item.key, item]));
    if (pending) lateFiles(q, seq, token, found, fallback);
    return { seq, query: q, items: items.map(publicItem), pending, empty: false, appCount: apps.length,
      notice: q.length >= MIN_FILE_CHARS && !pending ? (fileSearch?.status?.().reason || fileError || null) : appError || null };
  }

  async function runScript(file, args) {
    const script = scripts.find(x => x.path === file);
    if (!script || !fs.existsSync(file)) throw new Error('스크립트를 찾을 수 없습니다. 목록을 새로고침해 주세요.');
    const runner = platform.scriptRunner(file, args);
    if (!runner) throw new Error('지원하지 않는 스크립트 형식입니다.');
    const output = await new Promise(resolve => {
      let stdout = '', stderr = '', finished = false, child, timer;
      const finish = (code, extra = '') => { if (finished) return; finished = true; clearTimeout(timer); if (child) runningScripts.delete(child); resolve({ code, stdout, stderr: stderr + extra }); };
      try { child = spawn(runner.cmd, runner.args, { cwd: path.dirname(file), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (error) { return finish(null, messageOf(error)); }
      runningScripts.add(child);
      timer = setTimeout(() => { child.kill(); finish(null, '\n60초가 지나 중단했습니다.'); }, 60000);
      child.stdout.on('data', data => { stdout = (stdout + data.toString('utf8')).slice(0, MAX_OUTPUT); });
      child.stderr.on('data', data => { stderr = (stderr + data.toString('utf8')).slice(0, MAX_OUTPUT); });
      child.on('error', error => finish(null, messageOf(error)));
      child.on('close', code => finish(code));
    });
    if (output.code === 0 && lineCount(output.stdout) === 1) effects.clipboard.writeText(output.stdout.trim());
    return { ok: output.code === 0, title: script.name, message: output.code === 0 ? output.stdout.trim() || '실행했습니다.' : output.stderr.trim() || `종료 코드 ${output.code}`,
      output, hide: false };
  }

  async function run(key, actionId = null, { query: expectedQuery } = {}) {
    ensureOpen();
    if (expectedQuery !== undefined && String(expectedQuery ?? '').trim().slice(0, MAX_TEXT) !== queryText) {
      throw new Error('검색 내용이 바뀌었습니다. 현재 검색 결과에서 다시 실행해 주세요.');
    }
    if (typeof key !== 'string' || !cache.has(key)) throw new Error('현재 검색 결과에 없는 항목입니다. 다시 검색해 주세요.');
    const item = cache.get(key);
    await dependencies();
    let action = item.action;
    if (actionId === 'alt') action = altAction(item) || item.action;
    else if (actionId) {
      const alternative = actionsFor(item).find(x => x.id === actionId);
      if (!alternative) throw new Error('이 항목에서 사용할 수 없는 동작입니다.');
      action = alternative.action;
    }
    let result = { ok: true };
    if (action.type === 'route') result.route = action.route;
    else if (action.type === 'capture-task') {
      const task = await domain.mutate('task.create', { title: action.text });
      // 기본은 Command에 머물러 연달아 담는다. '담고 열기'(Ctrl+Enter)만 InBox 편집으로 간다.
      result = action.open ? { ok: true, route: { view: 'tasks', tab: 'inbox', id: task.id }, message: '인박스에 담았습니다.' }
        : { ok: true, clear: true, message: `인박스에 담았습니다 · ${task.title || action.text}` };
    } else if (action.type === 'capture-note') {
      const note = await domain.mutate('note.create', { body:action.text });
      result = { ok:true, route:{ view:'notes', id:note.id }, message:'메모에 저장했습니다.' };
    } else if (action.type === 'capture-event') {
      const parsed = await domain.mutate('calendar.parse', { text: action.text });
      if (!parsed?.ok) throw new Error('일정의 제목과 날짜를 해석하지 못했습니다.');
      const event = await domain.mutate('event.create', parsed);
      result = { ok: true, route: { view: 'calendar', id: event.id, date: event.date }, message: '일정을 추가했습니다.' };
    } else if (action.type === 'copy') { effects.clipboard.writeText(String(action.text)); result.message = `${action.text} 복사됨`; }
    else if (action.type === 'open-app') {
      if (!await platform.openApp(action.path)) throw new Error('앱을 열지 못했습니다.');
      result.hide = true;
    } else if (action.type === 'open-path') {
      const error = await effects.shell.openPath(action.path);
      if (error) throw new Error(String(error));
      result.hide = true;
    } else if (action.type === 'reveal') { effects.shell.showItemInFolder(action.path); result.hide = true; }
    else if (action.type === 'refresh') { await refresh(); result.message = '앱과 스크립트 목록을 갱신했습니다.'; }
    else if (action.type === 'run-script') result = await runScript(action.path, action.args || []);
    else if (action.type === 'system') {
      const command = system.find(x => x.id === action.id);
      if (!command) throw new Error('지원하지 않는 시스템 명령입니다.');
      if (DANGEROUS_SYSTEM.has(command.id)) {
        const confirm = await effects.dialog.showMessageBox({ type: 'question', title: 'WHENDESK',
          message: `${command.title}을 실행할까요?`, detail: command.description || '', buttons: ['취소', '실행'], defaultId: 0, cancelId: 0, noLink: true });
        if (confirm.response !== 1) return { ok: false, cancelled: true };
      }
      await executeFile(command.exec.cmd, command.exec.args);
      result.hide = ['lock', 'sleep'].includes(command.id);
      result.message = `${command.title} 실행됨`;
    } else throw new Error('지원하지 않는 실행 동작입니다.');
    if (result.ok && item.source !== 'calc') store.pick(item.key, item.source);
    return result;
  }

  async function refresh() {
    ensureOpen();
    await dependencies();
    await loadApps();
    scanScripts();
    return status();
  }

  function close() {
    if (closed) return;
    closed = true;
    ++generation;
    cancelPending();
    fileSearch?.dispose?.();
    for (const child of runningScripts) { try { child.kill(); } catch {} }
    runningScripts.clear();
    cache.clear();
    store.close();
  }

  return { ready, query, run, refresh, close, status, scriptsDir, get lastQuery() { return queryText; } };
}
