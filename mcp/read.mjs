// mcp/read.mjs — Claude(MCP)가 읽는 창구. 읽기 전용이다.
//
// 앱의 저장소(createStore)는 열 때 마이그레이션·무결성 검사·격리까지 하므로 바깥 프로세스가 쓰면 안 된다.
// 여기서는 매 호출마다 DB를 readOnly로 열고 바로 닫는다 — WAL이라 앱이 켜져 있어도 마지막으로 커밋된 상태를 읽고,
// 앱이 꺼져 있어도 된다. 조회 규칙은 앱과 같아야 하므로 기준이 된 곳을 주석으로 적어 둔다.
//
// 노출 범위(기본): 지운 것은 어디서도 보이지 않는다. 보관한 메모와 첨부파일은 옵션을 켰을 때만 보인다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expand } from '../modules/calendar/main/recur.mjs';
import { parseQuery, splitTerms, ftsMatch, likePattern, makeSnippet } from '../modules/note/main/search.mjs';
import { dayKey } from '../modules/work/main/brief.mjs';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function defaultDataDir(env = process.env) {
  if (env.WHENDESK_DATA_DIR) return path.resolve(env.WHENDESK_DATA_DIR);
  const appData = env.APPDATA || path.join(env.USERPROFILE || env.HOME || '.', 'AppData', 'Roaming');
  return path.join(appData, 'whendesk');
}

// 로컬 날짜 하루의 [시작, 다음날 시작) — 앱의 dateKey·dayKey와 같은 로컬 달력 기준이다.
function dayRange(day) {
  const [y, m, d] = day.split('-').map(Number);
  return [new Date(y, m - 1, d).toISOString(), new Date(y, m - 1, d + 1).toISOString()];
}
const localDay = (iso) => (iso ? dayKey(new Date(iso)) : '');

export function createReader({ dataDir = defaultDataDir(), includeArchived = false, includeAttachments = false } = {}) {
  const files = { work: path.join(dataDir, 'work', 'store.sqlite'), note: path.join(dataDir, 'note', 'store.sqlite') };

  function withDb(which, fn) {
    const file = files[which];
    if (!fs.existsSync(file)) {
      const label = which === 'work' ? '할 일' : '메모';
      throw new Error(`${label} 데이터 파일이 없습니다: ${file} — WHENDESK를 한 번 실행했는지, 데이터 폴더(--data-dir)가 맞는지 확인하세요.`);
    }
    const db = new DatabaseSync(file, { readOnly: true });
    try { return fn(db); } finally { db.close(); }
  }

  // ── 할 일 ─────────────────────────────────────────────

  const TASK_SELECT = `SELECT i.id, i.kind, i.title, i.due, i.waiting_for, i.captured_at, i.done_at, i.cancelled, i.postponed,
                              i.nudged_at, i.nudge_count, i.note, i.context, i.project_id, p.name AS project_name
                         FROM item i LEFT JOIN project p ON p.id = i.project_id`;
  function taskRow(r, { detail = false } = {}) {
    const out = {
      id: r.id, kind: r.kind, title: r.title, project: r.project_name ?? null,
      due: r.due ?? null, waitingFor: r.waiting_for ?? null, capturedAt: r.captured_at,
      status: r.done_at ? (r.cancelled ? 'cancelled' : 'done') : 'open', doneAt: r.done_at ?? null,
    };
    if (r.postponed) out.postponed = r.postponed;
    if (r.nudge_count) { out.nudgeCount = r.nudge_count; out.nudgedAt = r.nudged_at; }
    if (detail) {
      out.note = r.note ?? null;
      out.context = r.context ? safeJson(r.context) : null;
    } else if (r.note) out.hasNote = true;
    return out;
  }

  function eventsBetween(db, fromISO, toISO) {
    const SELECT = `SELECT i.id, i.title, i.starts_at, i.ends_at, i.all_day, i.location, i.note, i.rrule, i.exdates, p.name AS project_name
                      FROM item i LEFT JOIN project p ON p.id = i.project_id`;
    const row = (r) => ({
      id: r.id, title: r.title, startsAt: r.starts_at, endsAt: r.ends_at, allDay: !!r.all_day, location: r.location,
      note: r.note, rrule: r.rrule, exdates: r.exdates ? safeJson(r.exdates) : null, project: r.project_name ?? null,
    });
    // 기준: modules/work/main/store.mjs eventsBetween — 끝이 없는 일정은 시작 시각 한 점이다.
    const plain = db.prepare(`${SELECT} WHERE i.kind = 'event' AND i.deleted_at IS NULL AND i.rrule IS NULL
                                  AND i.starts_at < ? AND (i.ends_at > ? OR i.starts_at >= ?)`).all(toISO, fromISO, fromISO).map(row);
    const overrides = db.prepare('SELECT * FROM occurrence WHERE item_id = ?');
    const repeating = db.prepare(`${SELECT} WHERE i.kind = 'event' AND i.deleted_at IS NULL AND i.rrule IS NOT NULL AND i.starts_at < ?`)
      .all(toISO).map(row).map((ev) => ({
        ...ev,
        overrides: overrides.all(ev.id).map((o) => ({ recurrenceId: o.recurrence_id, startsAt: o.starts_at, endsAt: o.ends_at, title: o.title, cancelled: !!o.cancelled })),
      }));
    return [...plain, ...expand(repeating, fromISO, toISO)]
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .map((e) => {
        const out = { id: e.occurrenceOf ?? e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt ?? null, allDay: !!e.allDay };
        if (e.location) out.location = e.location;
        if (e.project) out.project = e.project;
        if (e.note) out.note = e.note;
        if (e.rrule) out.repeats = true;
        return out;
      });
  }

  // 오늘 저널 — 기준: renderer/app.js todayRows. 들어오는 것: 분류한 열린 할 일(ToDo·Waiting), 그날 일정,
  // 그날 적은 한 줄 메모, 그날 마친 일. InBox는 분류 전이라 건수만 붙인다.
  function today({ date } = {}) {
    const day = date ?? dayKey();
    if (!DAY_RE.test(day)) throw new Error('date는 YYYY-MM-DD 형식이어야 합니다.');
    const [from, to] = dayRange(day);
    return withDb('work', (db) => {
      const rows = db.prepare(`${TASK_SELECT} WHERE i.deleted_at IS NULL AND i.kind IN ('todo','waiting','inbox','note')`).all();
      const overdue = [], dueToday = [], waiting = [], upcoming = [], noDue = [], notes = [], done = [];
      let inbox = 0;
      for (const r of rows) {
        if (r.kind === 'note') { if (localDay(r.captured_at) === day) notes.push({ id: r.id, title: r.title, project: r.project_name ?? null, at: r.captured_at, ...(r.note ? { note: r.note } : {}) }); continue; }
        if (r.done_at) { if (localDay(r.done_at) === day) done.push(taskRow(r)); continue; }
        if (r.kind === 'inbox') { inbox++; continue; }
        const t = taskRow(r);
        if (r.due && r.due < day) overdue.push(t);
        else if (r.due === day) dueToday.push(t);
        else if (r.kind === 'waiting') waiting.push(t);
        else if (r.due) upcoming.push(t);
        else noDue.push(t);
      }
      const byDue = (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
      const byCaptured = (a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt);
      overdue.sort(byDue); upcoming.sort(byDue); dueToday.sort(byCaptured); waiting.sort(byCaptured); noDue.sort(byCaptured);
      notes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); done.sort((a, b) => Date.parse(a.doneAt) - Date.parse(b.doneAt));
      return {
        date: day,
        carryOver: overdue, // 넘길 일 — 마감이 지났는데 아직 열린 일
        events: eventsBetween(db, from, to),
        dueToday, waiting, upcoming, noDue, notes, done,
        inboxCount: inbox,
      };
    });
  }

  function listTasks({ status = 'open', kind = 'all', project, dueFrom, dueTo, query, doneDays = 7, limit = 100 } = {}) {
    for (const [name, v] of [['dueFrom', dueFrom], ['dueTo', dueTo]]) if (v != null && !DAY_RE.test(v)) throw new Error(`${name}는 YYYY-MM-DD 형식이어야 합니다.`);
    const where = ['i.deleted_at IS NULL'], params = [];
    where.push(kind === 'all' ? "i.kind IN ('inbox','todo','waiting')" : 'i.kind = ?');
    if (kind !== 'all') params.push(kind);
    if (status === 'open') where.push('i.done_at IS NULL');
    else {
      where.push('i.done_at IS NOT NULL');
      if (status === 'done') where.push('i.cancelled = 0'); else if (status === 'cancelled') where.push('i.cancelled = 1');
      if (doneDays != null) { where.push('i.done_at > ?'); params.push(new Date(Date.now() - doneDays * 86400_000).toISOString()); }
    }
    if (project != null) {
      if (project === '') where.push('i.project_id IS NULL');
      else { where.push('p.name = ? COLLATE NOCASE'); params.push(project); }
    }
    if (dueFrom) { where.push('i.due >= ?'); params.push(dueFrom); }
    if (dueTo) { where.push('i.due <= ?'); params.push(dueTo); }
    for (const term of String(query ?? '').trim().split(/\s+/).filter(Boolean)) {
      where.push("(i.title LIKE ? ESCAPE '\\' OR i.note LIKE ? ESCAPE '\\' OR i.waiting_for LIKE ? ESCAPE '\\')");
      const p = likePattern(term); params.push(p, p, p);
    }
    const order = status === 'open' ? 'i.due NULLS LAST, i.captured_at' : 'i.done_at DESC';
    return withDb('work', (db) => {
      const rows = db.prepare(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`).all(...params, limit + 1);
      return { tasks: rows.slice(0, limit).map((r) => taskRow(r)), truncated: rows.length > limit };
    });
  }

  function getTask(id) {
    return withDb('work', (db) => {
      const r = db.prepare(`${TASK_SELECT} WHERE i.id = ? AND i.deleted_at IS NULL AND i.kind IN ('inbox','todo','waiting','note')`).get(id);
      return r ? taskRow(r, { detail: true }) : null;
    });
  }

  function listEvents({ from, to } = {}) {
    if (!DAY_RE.test(from ?? '') || !DAY_RE.test(to ?? '')) throw new Error('from·to는 YYYY-MM-DD 형식이어야 합니다.');
    if (to < from) throw new Error('to가 from보다 앞입니다.');
    const span = (Date.parse(to) - Date.parse(from)) / 86400_000;
    if (span > 366) throw new Error('한 번에 1년(366일)까지만 조회합니다.');
    return withDb('work', (db) => ({ from, to, events: eventsBetween(db, dayRange(from)[0], dayRange(to)[1]) }));
  }

  function listProjects() {
    return withDb('work', (db) => db.prepare(
      `SELECT p.name,
              (SELECT count(*) FROM item i WHERE i.project_id = p.id AND i.deleted_at IS NULL AND i.done_at IS NULL AND i.kind IN ('inbox','todo','waiting')) AS open
         FROM project p WHERE p.status = 'active' AND p.deleted_at IS NULL ORDER BY p.sort, p.id`
    ).all().map((p) => ({ name: p.name, openTasks: Number(p.open) })));
  }

  // ── 메모 ─────────────────────────────────────────────

  // 기준: modules/note/main/store.mjs searchNotes — 같은 검색 규칙(trigram·LIKE 폴백·초성·#태그).
  function searchNotes({ query = '', limit = 20, archived = false } = {}) {
    if (archived && !includeArchived) throw new Error('보관한 메모는 노출하지 않도록 설정되어 있습니다(--include-archived로 켭니다).');
    const q = parseQuery(query);
    const where = ['n.deleted_at IS NULL', archived ? 'n.archived_at IS NOT NULL' : 'n.archived_at IS NULL'];
    const params = [];
    if (q.choseong) {
      for (const t of q.terms) { where.push("(n.title_cho LIKE ? ESCAPE '\\' OR n.body_cho LIKE ? ESCAPE '\\')"); const p = likePattern(t); params.push(p, p); }
    } else {
      const { fts, like } = splitTerms(q.terms);
      const match = ftsMatch(fts);
      if (match) { where.push('n.rid IN (SELECT rowid FROM note_fts WHERE note_fts MATCH ?)'); params.push(match); }
      for (const t of like) { where.push("(n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\')"); const p = likePattern(t); params.push(p, p); }
    }
    for (const tag of q.tags) { where.push('n.id IN (SELECT note_id FROM note_tag WHERE tag = ? COLLATE NOCASE)'); params.push(tag); }
    return withDb('note', (db) => {
      const rows = db.prepare(
        `SELECT n.id, n.title, n.body, n.updated_at, n.pinned_at,
                (SELECT group_concat(tag, ' ') FROM note_tag t WHERE t.note_id = n.id) AS tags
           FROM note n WHERE ${where.join(' AND ')}
          ORDER BY (n.pinned_at IS NOT NULL) DESC, CASE WHEN n.pinned_at IS NOT NULL THEN n.pin_order END ASC, n.opened_at DESC
          LIMIT ?`
      ).all(...params, limit + 1);
      return {
        notes: rows.slice(0, limit).map((r) => ({
          id: r.id, title: r.title, snippet: makeSnippet(r.body, q), updatedAt: r.updated_at,
          pinned: r.pinned_at != null, tags: r.tags ? r.tags.split(' ') : [],
        })),
        truncated: rows.length > limit,
      };
    });
  }

  function getNote(id) {
    return withDb('note', (db) => {
      const n = db.prepare('SELECT id, title, body, created_at, updated_at, pinned_at, archived_at FROM note WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!n || (n.archived_at && !includeArchived)) return null;
      const visible = includeArchived ? '' : ' AND n.archived_at IS NULL';
      const out = {
        id: n.id, title: n.title, body: n.body, createdAt: n.created_at, updatedAt: n.updated_at,
        pinned: n.pinned_at != null,
        tags: db.prepare('SELECT tag FROM note_tag WHERE note_id = ? ORDER BY tag').all(id).map((r) => r.tag),
        links: db.prepare(`SELECT l.to_title AS title, n.id FROM note_link l LEFT JOIN note n ON n.id = l.to_id AND n.deleted_at IS NULL${visible}
                            WHERE l.from_id = ? ORDER BY l.to_title`).all(id).map((r) => ({ title: r.title, id: r.id ?? null })),
        backlinks: db.prepare(`SELECT n.id, n.title FROM note_link l JOIN note n ON n.id = l.from_id
                                WHERE l.to_id = ? AND n.deleted_at IS NULL${visible} ORDER BY n.opened_at DESC`).all(id).map((r) => ({ id: r.id, title: r.title })),
      };
      if (n.archived_at) out.archived = true;
      if (includeAttachments) out.attachments = db.prepare('SELECT file FROM attachment WHERE note_id = ? ORDER BY created_at').all(id).map((r) => r.file);
      return out;
    });
  }

  function listNoteTags() {
    return withDb('note', (db) => db.prepare(
      `SELECT t.tag, count(*) AS count FROM note_tag t JOIN note n ON n.id = t.note_id
        WHERE n.deleted_at IS NULL AND n.archived_at IS NULL GROUP BY t.tag ORDER BY count DESC, t.tag`
    ).all().map((r) => ({ tag: r.tag, count: Number(r.count) })));
  }

  return { dataDir, today, listTasks, getTask, listEvents, listProjects, searchNotes, getNote, listNoteTags };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return text; }
}
