// WHENCOMMAND의 검색·별칭·계산·랭킹·OS 공급원을 WHENDESK 저장소에 연결한다.
// 렌더러에는 실행 사양을 노출하지 않고, 직전 질의에서 발급한 key만 실행한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { match } from '../modules/command/main/search.mjs';
import { rank } from '../modules/command/main/rank.mjs';
import { DEFAULT_ALIASES, aliasesFor, loadUserAliases, mergeAliases, matchWithAliases } from '../modules/command/main/aliases.mjs';
import { candidates as hintCandidates, saves as hintSaves } from '../modules/command/main/hint.mjs';
import { classifyClipboard, brief } from '../modules/command/main/clip.mjs';
import { calc, convert } from '../modules/command/main/sources/calc.mjs';
import { createStore } from '../modules/command/main/store.mjs';
import { parseHeader, lineCount, route as scriptRoute, locate as scriptLocate } from '../modules/command/main/scripts.mjs';
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
  const preferredAlt = ['capture-task', 'capture-event'].includes(item.action?.type) ? 'add-open' : { files: 'reveal', apps: 'reveal', scripts: 'edit', tasks: 'complete', notes: 'edit' }[item.source];
  return { key: item.key, title: item.title, subtitle: item.subtitle || '', source: item.source,
    icon: item.icon || 'command', kind: item.kind, positions: item.positions || [], via: item.via || null,
    ...(item.path ? { path: item.path } : {}), actions,
    altId: actions.some(x => x.id === preferredAlt) ? preferredAlt : null,
    final: item.final };
}

function dayKey(days = 0, now = new Date()) {
  const date = new Date(now); date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
/* 일정 미리보기 표기: 10월 31일 (금) 오후 3:00. 종일 일정은 날짜만. */
function eventWhen(parsed) {
  const start = new Date(parsed?.startsAt);
  if (!Number.isFinite(start.getTime())) return '';
  const day = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(start);
  return parsed.allDay ? day : `${day} ${new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' }).format(start)}`;
}

/* 일정 해석 미리보기 한 줄(원본 WHENCALENDAR previewParse): 요약 · 제목 · ＊ 짚어 둔 점. 해석기는 제목이 없을 때만 실패한다. */
export function eventPreviewLine(parsed) {
  if (!parsed?.startsAt) return '날짜·시각·제목을 알아서 읽습니다';
  const notes = (parsed.notes || []).map(note => `＊ ${note?.msg ?? note}`);
  if (parsed.ok === false) return ['＊ 제목이 없습니다', ...notes].join(' · ');
  return [parsed.summary || eventWhen(parsed), parsed.title, ...notes].filter(Boolean).join(' · ');
}

/* 문장에서 짚은 의도를 WHENDESK 안의 받을 곳으로 잇는다(원본 WHENCOMMAND SRCH-10·D-35). */
const INTENT_CAPTURE = {
  todo:{ source:'tasks', title:'할 일 추가', icon:'circle-plus', type:'capture-task' },
  schedule:{ source:'events', title:'일정 추가', icon:'calendar-plus', type:'capture-event' },
  note:{ source:'notes', title:'메모 추가', icon:'notebook-pen', type:'capture-note' },
};
function intentItem(intent, text, extra = {}) {
  const target = INTENT_CAPTURE[intent];
  return { key:`intent:${intent}`, source:target.source, title:target.title, subtitle:text, icon:target.icon, base:.6, ...extra, action:{ type:target.type, text } };
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

export function createCommand({ dataDir, domain, onMore, onLaunch, platform: providedPlatform, effects: providedEffects, fileDebounceMs = 120, fileTimeoutMs = 1500 }) {
  if (!dataDir || !domain) throw new Error('Command 데이터 폴더와 저장소가 필요합니다.');
  const commandDir = path.join(dataDir, 'command');
  const scriptsDir = path.join(commandDir, 'scripts');
  const firstScriptsDir = !fs.existsSync(scriptsDir) && !fs.existsSync(path.join(os.homedir(), '.whencommand', 'scripts'));
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
    if (firstScriptsDir && platform.exampleScript) { const example = platform.exampleScript(); try { fs.writeFileSync(path.join(scriptsDir, example.name), example.content, 'utf8'); } catch {} }
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
      ['calendar-subscriptions', '캘린더 구독 관리', { view: 'calendar', action: 'subscriptions' }, 'rss', '구독 ICS subscribe'],
      ['ics-import', 'ICS 가져오기', { view: 'calendar', action: 'import-ics' }, 'calendar-plus', '캘린더 가져오기 import'],
      ['ics-export', 'ICS 내보내기', { view: 'calendar', action: 'export-ics' }, 'calendar-check', '캘린더 내보내기 export'],
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
        subtitle: [task.cancelled ? '취소' : task.done ? '완료' : task.kind === 'waiting' ? '대기' : task.kind === 'inbox' ? '인박스' : '할 일', task.project, task.due].filter(Boolean).join(' · '),
        searchText: [task.note, task.waitingFor, task.project].filter(Boolean).join(' '), icon: 'circle-check', done: !!task.done, cancelled: !!task.cancelled,
        action: { type: 'route', route: { view: 'tasks', tab: task.done ? 'done' : task.kind, id: task.id } } }, .9);
    }
    // 저장소의 검색은 선택된 달 밖의 일정도 찾는다.
    const events = typeof domain.calendar?.searchEvents === 'function' ? domain.calendar.searchEvents(q) : (state.events || []);
    for (const event of events) {
      addMatched(out, q, { key: `events:${event.id}`, source: 'events', title: event.title,
        subtitle: [event.startsAt || event.starts_at || event.date, event.location].filter(Boolean).join(' · '),
        icon: 'calendar-days', recurring: !!(event.rrule || event.recurrence || event.recurrenceId), action: { type: 'route', route: { view: 'calendar', id: event.id,
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

  async function previewEvents(items) {
    for (const item of items) {
      if (item.action?.type !== 'capture-event') continue;
      try {
        const parsed = await domain.mutate('calendar.parse', { text: item.action.text });
        item.subtitle = eventPreviewLine(parsed);
      } catch { item.subtitle = '일정을 읽지 못했습니다'; }
    }
    return items;
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
      for (const intent of detectIntents(q).filter(x => INTENT_CAPTURE[x.intent]).slice(0, 2)) out.push(intentItem(intent.intent, q, { base:.6 }));
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

  function appItems(q) {
    const out = [];
    for (const app of apps) {
      const m = matchWithAliases(q, app.name, app.aliases);
      if (m.score > 0) out.push({ key: `apps:${app.path}`, source: 'apps', title: app.name,
        subtitle: m.via === 'alias' ? `별칭 ${m.alias}` : '', icon: 'app-window', path: app.path,
        base: m.score, positions: m.positions, via: m.via, action: { type: 'open-app', path: app.path } });
    }
    return out;
  }
  function probe(q) {
    const found = [...appItems(q), ...navigationItems(q), ...domainItems(q)];
    for (const command of system) addMatched(found, q, { key: `system:${command.id}`, source: 'system', title: command.title, action: { type: 'system', id: command.id } }, .9);
    return rank(found, store.picks());
  }
  /* 지름길 힌트(원본 WHENCOMMAND SRCH-11·D-36): 방금 고른 것을 더 짧게 부르는 입력 중 실제로 첫 줄에 오는 가장 짧은 것. 항목마다 한 번. */
  const hinted = new Set();
  let clipItems = [], lastClip = '';
  function setClipboard(raw, exists = file => fs.existsSync(file)) {
    const clip = classifyClipboard(raw, exists);
    if (!clip || clip.value === lastClip) { clipItems = []; return clipItems; }
    lastClip = clip.value;
    const items = [];
    if (clip.kind === 'url') items.push({ key:'clip:url', source:'clip', title:'링크 열기', subtitle:brief(clip.value), icon:'external-link', action:{ type:'open-url', url:clip.value } });
    else if (clip.kind === 'path') items.push({ key:'clip:path', source:'clip', title:'열기', subtitle:brief(clip.value), icon:'folder-open', path:clip.value, action:{ type:'open-path', path:clip.value } });
    const routed = detectIntents(clip.value).filter(x => INTENT_CAPTURE[x.intent]).slice(0, 2).map(x => x.intent);
    for (const intent of routed.length ? routed : clip.kind === 'text' ? ['note'] : []) items.push(intentItem(intent, clip.value, { key:`clip:${intent}`, subtitle:`“${brief(clip.value, 40)}”` }));
    clipItems = items.slice(0, 3);
    return clipItems;
  }
  function hintFor(item, typed) {
    if (!item || !typed || hinted.has(item.key) || item.fallback || !['apps', 'system', 'builtin'].includes(item.source)) return null;
    const aliases = item.source === 'apps' ? apps.find(app => `apps:${app.path}` === item.key)?.aliases || [] : [];
    for (const candidate of hintCandidates(item.title, aliases)) {
      if (!hintSaves(typed, candidate)) continue;
      if (probe(candidate)[0]?.key === item.key) { hinted.add(item.key); return candidate; }
    }
    return null;
  }

  async function query(raw, seq = 0) {
    ensureOpen();
    const q = String(raw ?? '').trim().slice(0, MAX_TEXT);
    queryText = q;
    const token = ++generation;
    cancelPending();
    cache = new Map();
    if (!q) { cache = new Map(clipItems.map(item => [item.key, item])); const shown = clipItems; clipItems = []; return { seq, query: q, items: shown.map(publicItem), empty: true, clip: shown.length > 0, pending: false, appCount: apps.length,
      notice: appError || (!readyPromise ? '앱 목록을 준비하고 있습니다.' : null) }; }
    const found = [];
    const result = convert(q) || calc(q);
    if (result) found.push({ key: `calc:${result.kind}`, source: 'calc', title: result.display, subtitle: result.expr,
      icon: 'calculator', base: 3, action: { type: 'copy', text: result.display } });
    found.push(...appItems(q));
    found.push(...navigationItems(q), ...domainItems(q), ...await previewEvents(captureItems(q)));
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
    onLaunch?.();
    const started = Date.now();
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
    output.ms = Date.now() - started;
    if (scriptRoute(output) === 'toast') {
      const text = output.stdout.trim(), copied = lineCount(text) === 1;
      if (copied) effects.clipboard.writeText(text);
      return { ok:true, title:script.name, hide:true, message:text || '실행했습니다.', toast:{ title:script.name, body:text ? (copied ? `${text}\n복사했습니다` : text) : '실행했습니다.' } };
    }
    return { ok: output.code === 0, title: script.name, hide:false, reshow:true,
      output:{ ...output, path:file, line:scriptLocate(output.stderr, file) } };
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
      // 새로 만든 메모는 이어서 쓰도록 편집으로 연다. 검색 결과로 여는 메모는 보기로 연다.
      result = { ok:true, route:{ view:'notes', id:note.id, edit:true }, message:'메모에 저장했습니다.' };
    } else if (action.type === 'capture-event') {
      const parsed = await domain.mutate('calendar.parse', { text: action.text });
      if (!parsed?.ok) throw new Error('일정의 제목과 날짜를 해석하지 못했습니다.');
      const event = await domain.mutate('event.create', parsed);
      result = action.open ? { ok: true, route: { view: 'calendar', id: event.id, date: event.date }, message: '일정을 추가했습니다.' }
        : { ok: true, clear: true, message: `일정을 추가했습니다 · ${[eventWhen(parsed), parsed.title].filter(Boolean).join(' ')}`, undo: { type: 'event.delete', payload: { id: event.id, scope: 'all' } } };
    } else if (action.type === 'task-complete') {
      await domain.mutate('task.complete', { id: action.id, done: action.done });
      // 취소했던 일을 완료로 바꿨으면 되돌리기는 다시 취소다.
      const undo = item.cancelled ? { type: 'task.cancel', payload: { id: action.id, cancelled: true } } : { type: 'task.complete', payload: { id: action.id, done: !action.done } };
      result = { ok: true, clear: true, message: `${action.done ? '완료했습니다' : '완료를 해제했습니다'} · ${item.title}`, undo };
    } else if (action.type === 'task-cancel') {
      await domain.mutate('task.cancel', { id: action.id, cancelled: action.cancelled });
      const undo = action.cancelled && item.done ? { type: 'task.complete', payload: { id: action.id, done: true } } : { type: 'task.cancel', payload: { id: action.id, cancelled: !action.cancelled } };
      result = { ok: true, clear: true, message: `${action.cancelled ? '안 하기로 했습니다' : '취소를 해제했습니다'} · ${item.title}`, undo };
    } else if (action.type === 'task-due') {
      const before = (domain.state().tasks || []).find(task => task.id === action.id);
      await domain.mutate('task.update', { id: action.id, due: dayKey(action.days) });
      result = { ok: true, clear: true, message: `${action.days ? '내일' : '오늘'} 마감으로 정했습니다 · ${item.title}`, undo: { type: 'task.update', payload: { id: action.id, due: before?.due || null, postponed: before?.postponed ?? 0 } } };
    } else if (action.type === 'task-delete') {
      await domain.mutate('task.delete', { id: action.id });
      result = { ok: true, clear: true, message: `삭제했습니다 · ${item.title}`, undo: { type: 'task.restore', payload: { id: action.id } } };
    } else if (action.type === 'event-delete') {
      await domain.mutate('event.delete', { id: action.id, scope: 'all' });
      result = { ok: true, clear: true, message: `일정을 삭제했습니다 · ${item.title}`, undo: { type: 'event.restore', payload: { id: action.id } } };
    } else if (action.type === 'copy') {
      // 복사하고 닫는다(원본 CALC-02). 닫힌 뒤에도 무엇을 복사했는지 토스트로 알린다.
      onLaunch?.(); effects.clipboard.writeText(String(action.text));
      result.message = `${action.text} 복사됨`; result.hide = true; result.toast = { title:'복사했습니다', body:String(action.text) };
    } else if (action.type === 'open-app') {
      onLaunch?.();
      if (!await platform.openApp(action.path)) throw new Error('앱을 열지 못했습니다.');
      result.hide = true;
    } else if (action.type === 'open-url') {
      onLaunch?.(); await effects.shell.openExternal(action.url); result.hide = true;
    } else if (action.type === 'open-path') {
      onLaunch?.();
      const error = await effects.shell.openPath(action.path);
      if (error) throw new Error(String(error));
      result.hide = true;
    } else if (action.type === 'reveal') { onLaunch?.(); effects.shell.showItemInFolder(action.path); result.hide = true; }
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
      result.hide = ['lock', 'sleep'].includes(command.id);
      if (result.hide) onLaunch?.();
      await executeFile(command.exec.cmd, command.exec.args);
      result.message = `${command.title} 실행됨`;
    } else throw new Error('지원하지 않는 실행 동작입니다.');
    if (result.ok && item.source !== 'calc') store.pick(item.key, item.source);
    // 고른 것이 순위에 반영된 뒤에 힌트를 찾는다 — 다음에 실제로 첫 줄에 오는 입력이어야 한다.
    if (result.ok && !actionId && !result.toast) { const shortcut = hintFor(item, queryText); if (shortcut) result.toast = { title:item.title, body:`다음엔 ‹${shortcut}› 만 쳐도 첫 줄입니다` }; }
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

  return { ready, query, run, refresh, close, status, scriptsDir, setClipboard, appPaths:() => apps.map(app => app.path), get lastQuery() { return queryText; } };
}
