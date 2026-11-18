// WHENDESK의 데이터 경계. 할 일·일정·한 줄 메모는 모두 Work 저장소의 item(불릿 저널의 • ○ –)이고,
// 긴 글은 Note 저장소다. 원본 앱의 데이터 경로는 열지 않는다. 모든 경로는 호출자가 정한 dataDir 아래다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ICAL from 'ical.js';
import { createStore as createWorkStore } from '../modules/work/main/store.mjs';
import { createQueue } from '../modules/work/main/queue.mjs';
import { parseDue } from '../modules/work/main/parse.mjs';
import { DatabaseSync } from 'node:sqlite';
import * as holidayYears from '@hyunbinseo/holidays-kr/all';
import { parseLine, describe } from '../modules/calendar/main/parse.mjs';
import { expand } from '../modules/calendar/main/recur.mjs';
import { matches } from '../modules/calendar/main/search.mjs';
import { createStore as createNoteStore } from '../modules/note/main/store.mjs';
import { createAttachments, isSafeName, sniffImageExt } from '../modules/note/main/attachments.mjs';
import { parseQuery, toChoseong, makeSnippet } from '../modules/note/main/search.mjs';
import { safeFilename, noteToMarkdown } from '../modules/note/main/export.mjs';

const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const pad = value => String(value).padStart(2, '0');
const day = value => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const hm = value => {
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
function text(value, label, { empty = false, limit = 200_000 } = {}) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > limit) {
    throw new Error(`${label}을(를) 올바르게 입력해 주세요.`);
  }
  return value;
}
function dateKey(value, label = '날짜', { empty = false } = {}) {
  if (empty && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  const parsed = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(parsed.getTime()) || day(parsed) !== value) throw new Error(`${label}이(가) 올바르지 않습니다.`);
  return value;
}
function clock(value, label) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${label}이(가) 올바르지 않습니다.`);
  return value;
}
function iso(value, label) {
  if (typeof value !== 'string' || !value.includes('T') || !Number.isFinite(Date.parse(value))) throw new Error(`${label}이(가) 올바르지 않습니다.`);
  return new Date(value).toISOString();
}
function recurrence(value) {
  if (value == null || value === '') return null;
  const clean = text(value, '반복 규칙', { limit: 2000 }).replace(/^RRULE:/i, '').toUpperCase();
  try {
    const rule = ICAL.Recur.fromString(clean);
    if (!rule.freq || !/^(SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)$/.test(rule.freq)) throw new Error();
  } catch { throw new Error('반복 규칙이 올바르지 않습니다.'); }
  return clean;
}
/* 반복 일정의 회차를 다른 날로 옮기면 반복 규칙의 요일·날짜도 같이 옮긴다.
 * 그러지 않으면 시작만 수요일로 가고 규칙은 BYDAY=TU로 남아, 옮긴 회차가 사라지고 다음 화요일부터 이어진다. */
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export function localDayShift(fromISO, toISO) {
  const from = new Date(fromISO), to = new Date(toISO);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return 0;
  return Math.round((new Date(to.getFullYear(), to.getMonth(), to.getDate(), 12) - new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12)) / 86_400_000);
}
export function shiftRrule(rrule, days, startsAt) {
  if (!rrule || !days) return rrule;
  const start = new Date(startsAt);
  return String(rrule).split(';').map(part => {
    const [key, value] = part.split('=');
    if (key?.toUpperCase() === 'BYDAY' && value) {
      return `${key}=${value.split(',').map(token => {
        const match = /^([+-]?\d*)([A-Z]{2})$/i.exec(token.trim());
        const index = match ? RRULE_DAYS.indexOf(match[2].toUpperCase()) : -1;
        return index < 0 ? token : match[1] + RRULE_DAYS[(((index + days) % 7) + 7) % 7];
      }).join(',')}`;
    }
    // 매월 며칠(하나)이면 옮긴 날짜의 일로 맞춘다. 여러 날짜는 사람이 정한 규칙이라 그대로 둔다.
    if (key?.toUpperCase() === 'BYMONTHDAY' && /^\d+$/.test(value || '') && Number.isFinite(start.getTime())) return `${key}=${start.getDate()}`;
    return part;
  }).join(';');
}

// 관보 기준 공휴일(@hyunbinseo/holidays-kr). 항목이 아니라 달력에 덧그리는 표시라 날짜 → 이름 목록만 둔다.
const HOLIDAYS = Object.freeze(Object.assign({}, ...Object.values(holidayYears)));

function normalizeEvent(event) {
  return {
    ...event,
    id: String(event.id),
    title: event.title,
    date: day(event.startsAt),
    time: event.allDay ? '' : hm(event.startsAt),
    end: event.allDay || !event.endsAt ? '' : hm(event.endsAt),
    endDate: event.endsAt ? day(event.endsAt) : '',
    location: event.location ?? '',
    note: event.note ?? '',
    readonly: false,
    rrule: event.rrule ?? '',
    project_id: event.projectId ?? null,
  };
}

export function createDomain({ dataDir, fetchImpl = globalThis.fetch } = {}) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('절대 경로인 데이터 폴더가 필요합니다.');
  fs.mkdirSync(dataDir, { recursive: true });
  const workFile = path.join(dataDir, 'work', 'store.sqlite');
  // 통합 전 캘린더 저장소. 처음 한 번 일정을 Work로 옮긴 뒤에는 읽지도 쓰지도 않고 보관만 한다.
  const legacyCalendarFile = path.join(dataDir, 'calendar', 'store.sqlite');
  const noteFile = path.join(dataDir, 'note', 'store.sqlite');
  const queue = createQueue(path.join(dataDir, 'work', 'capture.jsonl'));
  const noteQueue = createQueue(path.join(dataDir, 'note', 'capture.jsonl'));
  const work = createWorkStore(workFile);
  let note;
  try { note = createNoteStore(noteFile); }
  catch (error) { work.close(); throw error; }
  const attachments = createAttachments(path.join(dataDir, 'note', 'attachments'));
  let closed = false;

  function mustOpen() {
    if (closed) throw new Error('저장소가 닫혀 있습니다.');
    const status = work.status();
    if (!status.ok) throw new Error(status.notice || '할 일 저장소를 열지 못했습니다.');
    if (!note.status().ok) throw new Error(note.status().notice || '메모 저장소를 열지 못했습니다.');
  }
  try { mustOpen(); } catch (error) { work.close(); note.close(); throw error; }
  queue.replayPending(entries => work.insertCaptures(entries));
  noteQueue.replayPending(entries => note.insertCaptures(entries));
  // 일정은 Work 저장소의 item(kind='event')이다. 덱·Command·브리핑이 쓰던 캘린더 모양(listBetween·searchEvents…)은
  // 이 얇은 어댑터가 그대로 내준다 — 반복 일정은 조회 범위만큼만 펼친다.
  const calendar = {
    listBetween: (fromISO, toISO) => work.eventsBetween(fromISO, toISO, expand),
    searchEvents: (query, limit = 80) => String(query ?? '').trim() ? work.allEvents().filter(event => matches(event.title, query)).slice(0, limit) : [],
    getEvent: id => work.getEvent(String(id)),
    allEvents: () => work.allEvents(),
  };
  importLegacyCalendar();
  importOneLineNotes();

  /* 통합 전 캘린더 저장소의 직접 등록 일정(반복·회차 수정 포함)을 한 번만 Work로 옮긴다. 구독 일정은 옮기지 않는다.
   * 옛 파일은 지우지 않고 그대로 둔다(되돌릴 근거). 옮겼다는 표시는 Work의 기록에 같은 트랜잭션으로 남는다. */
  function importLegacyCalendar() {
    if (work.hasLog('calendar.imported') || !fs.existsSync(legacyCalendarFile)) return;
    let source;
    try { source = new DatabaseSync(legacyCalendarFile, { readOnly: true }); }
    catch (error) { console.error('옛 캘린더를 열지 못했습니다:', error.message); return; }
    try {
      const tables = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
      if (!tables.has('event') || !tables.has('calendar')) { work.importEvents([], 'calendar.imported'); return; }
      const rows = source.prepare(`SELECT e.* FROM event e JOIN calendar c ON c.id = e.calendar_id
        WHERE c.kind = 'local' AND e.deleted_at IS NULL ORDER BY e.starts_at, e.id`).all();
      const overrides = tables.has('override') ? source.prepare('SELECT * FROM override').all() : [];
      work.importEvents(rows.map(row => ({
        title: row.title, startsAt: row.starts_at, endsAt: row.ends_at ?? null, allDay: !!row.all_day,
        location: row.location || null, note: row.note || null, rrule: row.rrule || null,
        exdates: row.exdates ? JSON.parse(row.exdates) : null, capturedAt: row.created_at || new Date().toISOString(),
        overrides: overrides.filter(o => o.event_id === row.id).map(o => ({ recurrenceId:o.recurrence_id, startsAt:o.starts_at, endsAt:o.ends_at, title:o.title, cancelled:!!o.cancelled })),
      })), 'calendar.imported');
    } finally { source.close(); }
  }
  /* 한 줄짜리 Note는 불릿 저널의 – 메모다. 첨부·링크·고정·보관이 없는 것만 Work의 메모 항목으로 옮기고 원본은 휴지통에 둔다. */
  function importOneLineNotes() {
    if (work.hasLog('notes.imported')) return;
    const candidates = note.listNotes().filter(item => !item.deleted_at && !item.pinned_at && !item.archived_at && !item.attachments?.length
      && item.body.trim() && !item.body.trim().includes('\n') && item.body.trim().length <= 500)
      .filter(item => { const full = note.getNote(item.id); return !full?.links?.length && !full?.backlinks?.length; });
    work.importNoteItems(candidates.map(item => ({ title:item.body.trim(), capturedAt:item.created_at })), 'notes.imported');
    for (const item of candidates) { try { note.removeNote(item.id); } catch (error) { console.error('메모를 휴지통에 옮기지 못했습니다:', error.message); } }
  }

  function rawNote(id, { writable = false } = {}) {
    if (typeof id !== 'string' || !id || id.length > 1000) throw new Error('메모를 찾을 수 없습니다.');
    const item = note.getNote(id);
    if (!item || writable && item.deleted_at) throw new Error('메모를 찾을 수 없습니다.');
    return item;
  }
  function noteView(item, snippet) {
    return { ...item, createdAt:item.created_at, updatedAt:item.updated_at, openedAt:item.opened_at,
      pinned:!!item.pinned_at, archived:!!item.archived_at, deleted:!!item.deleted_at, pinOrder:item.pin_order ?? null,
      tags:item.tags || [], links:item.links || [], backlinks:item.backlinks || [], attachments:item.attachments || [],
      snippet:snippet ?? makeSnippet(item.body) };
  }
  function searchNotes(payload = {}) {
    mustOpen();
    const q = text(payload.q ?? payload.query ?? '', '메모 검색어', { empty:true, limit:8192 });
    const scope = payload.scope ?? (payload.deleted ? 'trash' : payload.archived ? 'archived' : 'active');
    if (!['active','archived','trash'].includes(scope)) throw new Error('메모 조회 범위가 올바르지 않습니다.');
    const limit = Number(payload.limit ?? 500);
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('메모 조회 개수가 올바르지 않습니다.');
    if (scope === 'trash') {
      const query = parseQuery(q);
      const items = note.listNotes().filter(item => {
        if (!item.deleted_at) return false;
        const content = item.title + '\n' + item.body;
        const haystack = (query.choseong ? toChoseong(content) : content.toLowerCase());
        return query.terms.every(term => haystack.includes(query.choseong ? term : term.toLowerCase())) && query.tags.every(tag => item.tags.some(value => value.toLowerCase() === tag.toLowerCase()));
      }).sort((a,b) => String(b.deleted_at).localeCompare(String(a.deleted_at))).slice(0,limit).map(item => noteView(item,makeSnippet(item.body,query)));
      return { query, items };
    }
    const found = note.searchNotes({ q, limit, archived:scope === 'archived' });
    return { query:found.query, items:found.items.map(item => noteView(rawNote(item.id),item.snippet)) };
  }
  function noteAttachmentPath(id, file) {
    mustOpen();
    const item = rawNote(id);
    if (!isSafeName(file) || !/\.(?:png|jpe?g|gif|webp|bmp)$/.test(file) || !item.attachments.some(attachment => attachment.file === file)) throw new Error('이 메모의 첨부 파일을 찾을 수 없습니다.');
    const target = attachments.resolve(file);
    if (!target || !fs.existsSync(target) || !fs.lstatSync(target).isFile()) throw new Error('첨부 파일을 찾을 수 없습니다.');
    if (fs.statSync(target).size > 16 * 1024 * 1024) throw new Error('첨부 파일이 허용 크기를 초과했습니다.');
    const descriptor = fs.openSync(target,'r'), header = Buffer.alloc(12);
    try { fs.readSync(descriptor,header,0,12,0); } finally { fs.closeSync(descriptor); }
    if (!sniffImageExt(header)) throw new Error('지원하는 이미지 첨부가 아닙니다.');
    return target;
  }
  function attachmentView(id, file) {
    const target = noteAttachmentPath(id,file), bytes = fs.readFileSync(target);
    if (bytes.length > 16 * 1024 * 1024) throw new Error('첨부 파일이 허용 크기를 초과했습니다.');
    const ext = sniffImageExt(bytes);
    if (!ext) throw new Error('지원하는 이미지 첨부가 아닙니다.');
    const mime = ({ png:'image/png', jpg:'image/jpeg', gif:'image/gif', webp:'image/webp', bmp:'image/bmp' })[ext];
    const base64 = bytes.toString('base64'); return { file, mime, base64, dataUrl:`data:${mime};base64,${base64}` };
  }

  function workData() { mustOpen(); return work.exportAll(); }
  function rawTask(id, { deleted = false } = {}) {
    const task = workData().item.find(item => item.id === id && item.kind !== 'event' && (deleted || !item.deleted_at));
    if (!task) throw new Error('할 일을 찾을 수 없습니다.');
    return task;
  }
  function taskView(task, projects = workData().project) {
    const project = projects.find(project => project.id === task.project_id)?.name ?? '';
    return {
      id: task.id, title: task.title, kind: task.kind,
      project_id: task.project_id,
      project, project_name:project || null,
      due: task.due ?? '', note: task.note ?? '', waitingFor: task.waiting_for ?? '',
      done: !!task.done_at, doneAt: task.done_at ?? null,
      // 불릿 저널 상태: 취소(줄 긋기)는 닫힌 일의 한 갈래, postponed는 마감을 뒤로 민 횟수(>).
      cancelled: !!task.done_at && !!task.cancelled, postponed: Number(task.postponed ?? 0),
      deleted: !!task.deleted_at, deletedAt: task.deleted_at ?? null,
      capturedAt: task.captured_at, nudgedAt: task.nudged_at ?? null,
      nudgeCount: task.nudge_count ?? 0,
      // 원본 Work의 검색·그룹·마감 계산 모듈이 같은 필드를 그대로 읽는다.
      captured_at:task.captured_at, done_at:task.done_at ?? null, deleted_at:task.deleted_at ?? null,
      waiting_for:task.waiting_for ?? null, nudged_at:task.nudged_at ?? null, nudge_count:task.nudge_count ?? 0,
    };
  }
  function rawProject(value, { active = false } = {}) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('프로젝트를 찾을 수 없습니다.');
    const project = workData().project.find(project => project.id === id && (!active || project.status === 'active'));
    if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');
    return project;
  }
  function projectId(payload, current) {
    const all = workData().project;
    if (owns(payload, 'project_id')) {
      if (payload.project_id == null || payload.project_id === '') return null;
      const id = Number(payload.project_id);
      if (!Number.isInteger(id) || !all.some(project => project.id === id && project.status === 'active')) throw new Error('프로젝트를 찾을 수 없습니다.');
      return id;
    }
    if (owns(payload, 'project')) {
      if (!payload.project) return null;
      const found = all.find(project => project.name === payload.project && project.status === 'active');
      if (!found) throw new Error('프로젝트를 찾을 수 없습니다.');
      return found.id;
    }
    return current?.project_id ?? null;
  }
  function patchTask(payload) {
    const current = rawTask(payload.id);
    const patch = {};
    if (owns(payload, 'title')) patch.title = text(payload.title, '제목', { limit: 10_000 });
    if (owns(payload, 'note')) patch.note = text(payload.note ?? '', '상세 내용', { empty: true });
    if (owns(payload, 'due')) {
      patch.due = dateKey(payload.due, '마감', { empty: true });
      // 이미 있던 마감을 더 뒤로 밀면 한 번 미룬 것이다. 처음 정하기·당기기·해제는 세지 않는다.
      if (current.due && patch.due && patch.due > current.due) patch.postponed = Number(current.postponed ?? 0) + 1;
    }
    // 되돌리기는 직전 횟수를 그대로 돌려놓는다.
    if (owns(payload, 'postponed')) {
      if (!Number.isSafeInteger(payload.postponed) || payload.postponed < 0) throw new Error('미룬 횟수가 올바르지 않습니다.');
      patch.postponed = payload.postponed;
    }
    if (owns(payload, 'waitingFor') || owns(payload, 'waiting_for')) patch.waiting_for = text(payload.waitingFor ?? payload.waiting_for ?? '', '대기 상대', { empty: true, limit: 10_000 }) || null;
    const isNote = current.kind === 'note';
    if (isNote && ['due','done','cancelled','kind','waitingFor','waiting_for','postponed'].some(key => owns(payload, key))) throw new Error('메모에는 상태·마감·완료가 없습니다.');
    if (owns(payload, 'kind')) {
      if (!['inbox', 'todo', 'waiting'].includes(payload.kind)) throw new Error('할 일 상태가 올바르지 않습니다.');
      patch.kind = payload.kind;
    }
    if (owns(payload, 'project') || owns(payload, 'project_id')) {
      patch.project_id = projectId(payload, current);
      // 기존 Work의 프로젝트 지정은 인박스를 할 일로 세운다. 명시한 상태가 있으면 그 선택을 따른다.
      if (!owns(payload, 'kind') && current.kind === 'inbox' && patch.project_id != null) patch.kind = 'todo';
    }
    if (owns(payload, 'done')) {
      if (typeof payload.done !== 'boolean') throw new Error('완료 상태가 올바르지 않습니다.');
      // 취소한 일을 완료로 바꾸면 그 순간 끝낸 것이다 — 취소 시각을 완료 시각으로 물려받지 않는다.
      patch.done_at = payload.done ? (current.done_at && !current.cancelled ? current.done_at : new Date().toISOString()) : null;
      patch.cancelled = 0;
    }
    if (owns(payload, 'cancelled')) {
      if (typeof payload.cancelled !== 'boolean') throw new Error('취소 상태가 올바르지 않습니다.');
      if (payload.cancelled) { patch.done_at = current.done_at && current.cancelled ? current.done_at : new Date().toISOString(); patch.cancelled = 1; }
      else { patch.done_at = null; patch.cancelled = 0; }
    }
    work.patchItem(payload.id, patch);
    return taskView(rawTask(payload.id));
  }
  function rawEvent(id) {
    if (typeof id !== 'string' && typeof id !== 'number') throw new Error('일정을 찾을 수 없습니다.');
    const event = work.getEvent(String(id));
    if (!event) throw new Error('일정을 찾을 수 없습니다.');
    return event;
  }
  function eventFields(payload, current = null) {
    const title = text(payload.title ?? current?.title, '일정 제목', { limit: 10_000 });
    const allDay = owns(payload, 'allDay') ? !!payload.allDay : !!current?.allDay;
    const sourceDate = payload.date ?? (current ? day(current.startsAt) : null);
    let startsAt;
    if (owns(payload, 'startsAt')) startsAt = iso(payload.startsAt, '시작 시각');
    else {
      const date = dateKey(sourceDate);
      const time = allDay ? '00:00' : clock(payload.time ?? (current ? hm(current.startsAt) : '09:00'), '시작 시간');
      startsAt = new Date(`${date}T${time}:00`).toISOString();
    }
    let endsAt;
    if (owns(payload, 'endsAt')) endsAt = payload.endsAt == null ? null : iso(payload.endsAt, '종료 시각');
    else if (allDay) {
      if (payload.endDate) endsAt = new Date(`${dateKey(payload.endDate, '종료 날짜')}T00:00:00`).toISOString();
      else {
        const duration = current?.allDay && current.endsAt ? Date.parse(current.endsAt) - Date.parse(current.startsAt) : 86_400_000;
        endsAt = new Date(Date.parse(startsAt) + Math.max(86_400_000, duration)).toISOString();
      }
    } else if (owns(payload, 'end')) {
      endsAt = new Date(`${dateKey(payload.endDate || day(startsAt), '종료 날짜')}T${clock(payload.end, '종료 시간')}:00`).toISOString();
    } else {
      const duration = current?.endsAt ? Date.parse(current.endsAt) - Date.parse(current.startsAt) : 3_600_000;
      endsAt = new Date(Date.parse(startsAt) + Math.max(60_000, duration)).toISOString();
    }
    if (endsAt != null && Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('종료 시간을 시작 시간 이후로 정해 주세요.');
    return {
      title, startsAt, endsAt, allDay,
      projectId: projectId(payload, current ? { project_id: current.projectId ?? null } : null),
      location: text(payload.location ?? current?.location ?? '', '장소', { empty: true, limit: 10_000 }) || null,
      note: text(payload.note ?? current?.note ?? '', '상세 내용', { empty: true }) || null,
      rrule: owns(payload, 'rrule') ? recurrence(payload.rrule) : current?.rrule ?? null,
    };
  }
  function state({ year = new Date().getFullYear(), month = new Date().getMonth(), includeDeleted = false } = {}) {
    mustOpen();
    year = Number(year); month = Number(month);
    if (!Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(month) || month < 0 || month > 11) throw new Error('조회할 날짜가 올바르지 않습니다.');
    const from = new Date(year, month, -34);
    const to = new Date(year, month + 1, 36);
    const data = workData();
    const workView = work.getViewState();
    const deletedProjects = (workView.deletedProjects || []).map(project => ({ ...project, deletedAt:project.deleted_at, itemCount:project.item_count }));
    return {
      tasks: data.item.filter(item => item.kind !== 'event' && (includeDeleted || !item.deleted_at)).map(item => taskView(item, data.project)),
      projects: workView.projects.map(project => ({ id: project.id, name: project.name, sort: project.sort })),
      archivedProjects: deletedProjects,
      deletedProjects,
      events: calendar.listBetween(from.toISOString(), to.toISOString()).map(normalizeEvent),
      // 대시보드 저널은 캘린더가 어느 달을 보고 있든 오늘 일정이 필요하다.
      todayEvents: calendar.listBetween(new Date(new Date().setHours(0, 0, 0, 0)).toISOString(), new Date(new Date().setHours(24, 0, 0, 0)).toISOString()).map(normalizeEvent),
      holidays: HOLIDAYS,
      notes: note.listNotes().map(item => noteView(item)),
      noteTags: note.listTags(),
      notices: [work.status().notice, note.status().notice].filter(Boolean),
    };
  }
  /* 불릿 저널의 Future Log: 내일부터 months달 뒤 1일 전까지의 단발 일정. 반복 일정은 매번 같은 줄이 쌓여 계획이 묻히므로 뺀다. */
  function future({ months = 6 } = {}) {
    mustOpen();
    months = Number(months);
    if (!Number.isInteger(months) || months < 1 || months > 24) throw new Error('조회할 기간이 올바르지 않습니다.');
    const now = new Date(), from = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), to = new Date(now.getFullYear(), now.getMonth() + months, 1);
    const events = calendar.listBetween(from.toISOString(), to.toISOString()).map(normalizeEvent).filter(event => !event.rrule && !event.recurrenceId && !event.occurrenceOf);
    return { from: day(from.toISOString()), to: day(to.toISOString()), events };
  }
  async function mutate(type, payload = {}) {
    mustOpen();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('요청 형식이 올바르지 않습니다.');
    switch (type) {
      case 'note.create': {
        const body = text(payload.body ?? '', '메모 내용', { empty:true, limit:2 * 1024 * 1024 });
        const entry = { id:crypto.randomUUID(), body, captured_at:new Date().toISOString(), allow_empty:true };
        noteQueue.append(entry); note.insertCaptures([entry]); return noteView(rawNote(entry.id));
      }
      case 'note.get': return noteView(rawNote(payload.id));
      case 'note.open': { const item = rawNote(payload.id); if (!item.deleted_at) note.touchOpened(item.id); return noteView(rawNote(item.id)); }
      case 'note.search': return searchNotes(payload);
      case 'note.tags': return note.listTags();
      case 'note.update': { rawNote(payload.id,{ writable:true }); note.updateNote(payload.id,text(payload.body,'메모 내용',{ empty:true, limit:2 * 1024 * 1024 })); return noteView(rawNote(payload.id)); }
      case 'note.pin':
      case 'note.archive': {
        const item = rawNote(payload.id,{ writable:true }), field = type === 'note.pin' ? 'pinned_at' : 'archived_at';
        if (owns(payload,'on') && typeof payload.on !== 'boolean') throw new Error('메모 상태가 올바르지 않습니다.');
        const on = payload.on ?? !item[field];
        if (type === 'note.pin') note.setPinned(item.id,on); else note.setArchived(item.id,on);
        return noteView(rawNote(item.id));
      }
      case 'note.reorder': {
        rawNote(payload.id,{ writable:true });
        const direction = payload.direction ?? payload.dir;
        if (![1,-1,'up','down'].includes(direction)) throw new Error('메모 이동 방향이 올바르지 않습니다.');
        note.movePinned(payload.id,direction === 'up' || direction === -1 ? -1 : 1); return noteView(rawNote(payload.id));
      }
      case 'note.delete': rawNote(payload.id,{ writable:true }); note.removeNote(payload.id); return noteView(rawNote(payload.id));
      case 'note.restore': rawNote(payload.id); note.restoreNote(payload.id); return noteView(rawNote(payload.id));
      case 'note.attach': {
        rawNote(payload.id,{ writable:true });
        const base64 = payload.base64 ?? payload.bytes;
        if (typeof base64 !== 'string' || base64.length > 24 * 1024 * 1024 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('첨부 파일 형식이 올바르지 않습니다.');
        const bytes = Buffer.from(base64,'base64'); if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error('첨부는 16MB 이하 이미지를 선택해 주세요.');
        const ext = sniffImageExt(bytes); if (!ext) throw new Error('지원하는 이미지 첨부가 아닙니다.');
        const result = attachments.save(bytes,ext); note.addAttachment(payload.id,result.file);
        const label = String(payload.name || '이미지').replace(/[\[\]\\\r\n]/g,' ').slice(0,200);
        return { ...result, markdown:`![${label}](attachments/${result.file})` };
      }
      case 'note.attachment':
      case 'note.attachments': return attachmentView(payload.id,payload.file);
      case 'note.export': {
        const items = payload.id ? [rawNote(payload.id)] : note.allNotes();
        const files = items.map(item => ({ id:item.id, filename:safeFilename(item.title,item.id), text:noteToMarkdown(item,item.tags), attachments:rawNote(item.id).attachments.map(attachment => attachment.file) }));
        return { filename:files.length === 1 ? files[0].filename : 'WHENDESK 메모.md', text:files.map(file => file.text).join('\n\n'), files, attachments:files.flatMap(file => file.attachments.map(attachment => ({ id:file.id,file:attachment }))) };
      }
      case 'task.create': {
        const title = text(payload.title, '제목', { limit: 10_000 });
        // 한 줄 메모(–)는 담기 큐를 거치지 않는다 — 큐는 InBox 할 일 전용 형식이다.
        if (payload.kind === 'note') return taskView(rawTask(work.addNoteItem({ title })));
        const entry = { id: crypto.randomUUID(), title, captured_at: new Date().toISOString() };
        queue.append(entry);
        work.insertCaptures([entry]);
        return taskView(rawTask(entry.id));
      }
      case 'task.update': return patchTask(payload);
      case 'task.setDue': {
        rawTask(payload.id);
        const input = text(payload.text ?? '', '마감', { empty:true, limit:1000 });
        const parsed = parseDue(input);
        if (!parsed.ok) throw new Error('마감 형식이 올바르지 않습니다. 오늘 / 내일 / +3 / 8-12처럼 입력해 주세요.');
        return patchTask({ id:payload.id, due:parsed.value });
      }
      case 'task.complete': return patchTask({ id: payload.id, done: payload.done ?? true });
      case 'task.cancel': return patchTask({ id: payload.id, cancelled: payload.cancelled ?? true });
      case 'task.delete': rawTask(payload.id); work.removeItem(payload.id); return { id: payload.id };
      case 'task.restore': rawTask(payload.id, { deleted: true }); work.restoreItem(payload.id); return taskView(rawTask(payload.id));
      case 'task.nudge': {
        const task = rawTask(payload.id);
        if (task.kind !== 'waiting' || task.done_at) throw new Error('대기 중인 할 일만 재촉할 수 있습니다.');
        return work.nudgeItem(payload.id);
      }
      case 'task.nudgeUndo': {
        rawTask(payload.id);
        const at = payload.at == null ? null : iso(payload.at,'재촉 시각');
        if (!Number.isSafeInteger(payload.count) || payload.count < 0) throw new Error('재촉 횟수가 올바르지 않습니다.');
        work.nudgeRestore(payload.id,at,payload.count); return taskView(rawTask(payload.id));
      }
      case 'work.history': {
        const days = owns(payload,'days') ? payload.days : 7;
        if (![7,30,null].includes(days)) throw new Error('완료 기록 조회 기간이 올바르지 않습니다.');
        const result = work.getHistory(days), data = workData(), byId = new Map(data.item.map(item => [item.id,item]));
        return { items:result.items.map(item => taskView(byId.get(item.id) || item,data.project)), commits:result.commits };
      }
      case 'work.archive': {
        const data = workData(), byId = new Map(data.item.map(item => [item.id,item]));
        return work.searchArchive().map(item => taskView(byId.get(item.id) || item,data.project));
      }
      case 'project.create': {
        const name = text(payload.name, '프로젝트 이름', { limit: 1000 }).trim();
        const id = work.createProject(name);
        if (!id) throw new Error('같은 이름의 프로젝트가 이미 있습니다.');
        return { id, name };
      }
      case 'project.update': {
        const { id } = rawProject(payload.id,{ active:true });
        const name = text(payload.name, '프로젝트 이름', { limit: 1000 }).trim();
        if (workData().project.some(project => project.id !== id && project.name === name)) throw new Error('같은 이름의 프로젝트가 이미 있습니다.');
        work.updateProject(id, { name }); return { id, name };
      }
      case 'project.archive': {
        const { id } = rawProject(payload.id,{ active:true });
        return { id, ...work.deleteProject(id) };
      }
      case 'project.restore': {
        const { id } = rawProject(payload.id);
        const movedItemIds = payload.movedItemIds ?? [];
        if (!Array.isArray(movedItemIds) || movedItemIds.some(id => typeof id !== 'string' || !id)) throw new Error('복원할 할 일 목록이 올바르지 않습니다.');
        work.restoreProject(id,movedItemIds); return { id };
      }
      case 'project.move': {
        const { id } = rawProject(payload.id,{ active:true });
        if (!['up','down'].includes(payload.direction)) throw new Error('프로젝트 이동 방향이 올바르지 않습니다.');
        work.moveProject(id,payload.direction); return { id };
      }
      case 'event.create': {
        const fields = eventFields(payload);
        const id = work.addEvent(fields);
        return normalizeEvent(rawEvent(id));
      }
      case 'event.update': {
        const current = rawEvent(payload.id);
        const occurrenceId = payload.recurrenceId ? iso(payload.recurrenceId, '회차 시각') : null;
        const duration = current.endsAt ? Date.parse(current.endsAt) - Date.parse(current.startsAt) : null;
        const base = occurrenceId
          ? { ...current, startsAt: occurrenceId, endsAt: duration == null ? null : new Date(Date.parse(occurrenceId) + duration).toISOString() }
          : current;
        const fields = eventFields(payload, base);
        // 반복 규칙을 직접 바꾸지 않았는데 회차를 다른 날로 옮겼으면 규칙의 요일·날짜도 같은 만큼 옮긴다(이 회차만은 예외 회차라 규칙과 무관).
        if (fields.rrule && !owns(payload, 'rrule') && payload.scope !== 'one') {
          const days = localDayShift(base.startsAt, fields.startsAt);
          if (days) fields.rrule = shiftRrule(fields.rrule, days, fields.startsAt);
        }
        if (occurrenceId && payload.scope === 'all') {
          const offset = Date.parse(current.startsAt) - Date.parse(occurrenceId);
          fields.startsAt = new Date(Date.parse(fields.startsAt) + offset).toISOString();
          if (fields.endsAt) fields.endsAt = new Date(Date.parse(fields.endsAt) + offset).toISOString();
        }
        if (payload.recurrenceId && payload.scope === 'one') {
          if (fields.location !== current.location || fields.note !== current.note || fields.rrule !== current.rrule || fields.projectId !== current.projectId) {
            throw new Error('장소·상세 내용·반복 규칙 변경은 전체 반복 일정에 적용해 주세요.');
          }
          if (!work.setOverride(current.id, occurrenceId, fields)) throw new Error('회차를 수정하지 못했습니다.');
        } else if (payload.recurrenceId && payload.scope === 'future') {
          if (!current.rrule) throw new Error('반복 일정만 회차부터 나눌 수 있습니다.');
          if (!owns(payload, 'rrule')) {
            const parsed = ICAL.Recur.fromString(current.rrule);
            if (parsed.count) {
              const iterator = parsed.iterator(ICAL.Time.fromJSDate(new Date(current.startsAt), false));
              let before = 0;
              for (let next = iterator.next(); next && next.toJSDate().getTime() < Date.parse(occurrenceId); next = iterator.next()) {
                if (++before > 5000) throw new Error('반복 범위가 너무 큽니다.');
              }
              const remaining = parsed.count - before;
              if (remaining < 1) throw new Error('반복 범위 안의 회차를 선택해 주세요.');
              fields.rrule = current.rrule.replace(/COUNT=\d+/i, `COUNT=${remaining}`);
            }
          }
          const id = work.splitEventSeries(current.id, occurrenceId, fields);
          if (!id) throw new Error('반복 일정을 나누지 못했습니다.');
          // 새 시리즈로 넘어온 제외일·회차 수정은 옛 시각을 가리킨다. 첫 회차가 옮겨진 만큼 함께 옮긴다.
          work.shiftExceptions(id, Date.parse(fields.startsAt) - Date.parse(occurrenceId));
          return normalizeEvent(rawEvent(id));
        } else {
          if (!work.updateEvent(current.id, fields)) throw new Error('일정을 수정하지 못했습니다.');
          // 반복 시리즈 전체를 옮겼으면 제외일·회차 수정도 같은 만큼 옮긴다(빼 둔 회차가 되살아나지 않게).
          if (current.rrule && fields.rrule) work.shiftExceptions(current.id, Date.parse(fields.startsAt) - Date.parse(current.startsAt));
        }
        return normalizeEvent(rawEvent(current.id));
      }
      case 'event.delete': {
        const current = rawEvent(payload.id);
        // 회차 삭제는 규칙·제외일만 바꾼다. 되돌리기(event.reshape)가 쓰도록 바꾸기 전 모양을 돌려준다.
        const previous = { rrule: current.rrule ?? null, exdates: current.exdates ?? null };
        if (payload.recurrenceId && payload.scope === 'one') work.excludeOccurrence(current.id, iso(payload.recurrenceId, '회차 시각'));
        else if (payload.recurrenceId && payload.scope === 'future') work.truncateSeries(current.id, iso(payload.recurrenceId, '회차 시각'));
        else { work.removeItem(current.id); return { id: current.id }; }
        return { id: current.id, previous };
      }
      case 'event.reshape': {
        const current = rawEvent(payload.id);
        const rrule = payload.rrule == null ? null : text(payload.rrule, '반복 규칙', { limit: 10_000 });
        const exdates = payload.exdates == null ? null : [].concat(payload.exdates).map(value => iso(value, '제외 회차'));
        if (!work.setSeriesShape(current.id, rrule, exdates)) throw new Error('반복 일정을 되돌리지 못했습니다.');
        return normalizeEvent(rawEvent(current.id));
      }
      case 'event.restore': rawEvent(payload.id); work.restoreItem(String(payload.id)); return normalizeEvent(rawEvent(payload.id));
      case 'calendar.parse': {
        const now = payload.now == null ? new Date() : new Date(payload.now);
        if (!Number.isFinite(now.getTime())) throw new Error('기준 날짜가 올바르지 않습니다.');
        // 원본 WHENCALENDAR ipc.mjs처럼 사람이 읽는 한 줄(시작–종료 · 종일 · 여러 날 · 반복)을 붙여 돌려준다.
        const parsed = parseLine(text(payload.text, '일정 입력', { limit: 10_000 }), now);
        return { ...parsed, summary: describe(parsed) };
      }
      default: throw new Error(`지원하지 않는 작업입니다: ${type}`);
    }
  }
  function exportAll() {
    mustOpen();
    return { app: 'whendesk', version: 2, exportedAt: new Date().toISOString(), work: work.exportAll(), note:note.exportAll() };
  }
  function close() {
    if (closed) return;
    closed = true;
    work.close(); note.close();
  }
  return { state, future, mutate, exportAll, close, work, calendar, note, searchNotes, noteAttachmentPath };
}
