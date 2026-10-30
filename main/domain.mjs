// WHENDESK의 Work·Calendar 데이터 경계. 기존 앱의 복사본 저장 모듈을 사용하고
// 원본 앱의 데이터 경로는 열지 않는다. 모든 경로는 호출자가 정한 dataDir 아래다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ICAL from 'ical.js';
import { createStore as createWorkStore } from '../modules/work/main/store.mjs';
import { createQueue } from '../modules/work/main/queue.mjs';
import { parseDue } from '../modules/work/main/parse.mjs';
import { createStore as createCalendarStore } from '../modules/calendar/main/store.mjs';
import { parseLine } from '../modules/calendar/main/parse.mjs';
import { parseIcs, buildIcs, isCancelled } from '../modules/calendar/main/ics.mjs';
import { syncCalendar, syncAll } from '../modules/calendar/main/sync.mjs';
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
function normalizeEvent(event) {
  return {
    ...event,
    id: Number(event.id),
    title: event.title,
    date: day(event.startsAt),
    time: event.allDay ? '' : hm(event.startsAt),
    end: event.allDay || !event.endsAt ? '' : hm(event.endsAt),
    endDate: event.endsAt ? day(event.endsAt) : '',
    location: event.location ?? '',
    note: event.note ?? '',
    readonly: event.calendarKind === 'subscription',
    rrule: event.rrule ?? '',
  };
}

export function createDomain({ dataDir, fetchImpl = globalThis.fetch } = {}) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('절대 경로인 데이터 폴더가 필요합니다.');
  fs.mkdirSync(dataDir, { recursive: true });
  const workFile = path.join(dataDir, 'work', 'store.sqlite');
  const calendarFile = path.join(dataDir, 'calendar', 'store.sqlite');
  const noteFile = path.join(dataDir, 'note', 'store.sqlite');
  const queue = createQueue(path.join(dataDir, 'work', 'capture.jsonl'));
  const noteQueue = createQueue(path.join(dataDir, 'note', 'capture.jsonl'));
  const work = createWorkStore(workFile);
  let calendar, note;
  try { calendar = createCalendarStore(calendarFile); note = createNoteStore(noteFile); }
  catch (error) { work.close(); calendar?.close(); throw error; }
  const attachments = createAttachments(path.join(dataDir, 'note', 'attachments'));
  let closed = false;
  let subscriptionBusy = false;

  function mustOpen() {
    if (closed) throw new Error('저장소가 닫혀 있습니다.');
    const status = work.status();
    if (!status.ok) throw new Error(status.notice || '할 일 저장소를 열지 못했습니다.');
    if (!calendar.ok) throw new Error(calendar.state.detail || '캘린더 저장소를 열지 못했습니다.');
    if (!note.status().ok) throw new Error(note.status().notice || '메모 저장소를 열지 못했습니다.');
  }
  try { mustOpen(); } catch (error) { work.close(); calendar.close(); note.close(); throw error; }
  queue.replayPending(entries => work.insertCaptures(entries));
  noteQueue.replayPending(entries => note.insertCaptures(entries));
  // 직접 등록 달력만 만들며 예제 프로젝트·할 일·일정을 실제 데이터에 넣지 않는다.
  calendar.localCalendarId();

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
    const task = workData().item.find(item => item.id === id && (deleted || !item.deleted_at));
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
    if (owns(payload, 'due')) patch.due = dateKey(payload.due, '마감', { empty: true });
    if (owns(payload, 'waitingFor') || owns(payload, 'waiting_for')) patch.waiting_for = text(payload.waitingFor ?? payload.waiting_for ?? '', '대기 상대', { empty: true, limit: 10_000 }) || null;
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
      patch.done_at = payload.done ? (current.done_at || new Date().toISOString()) : null;
    }
    work.patchItem(payload.id, patch);
    return taskView(rawTask(payload.id));
  }
  function rawEvent(id, { writable = false } = {}) {
    const event = calendar.getEvent(Number(id));
    if (!event) throw new Error('일정을 찾을 수 없습니다.');
    if (writable && event.calendarKind === 'subscription') throw new Error('구독 일정은 읽기 전용입니다. 원본 캘린더에서 수정해 주세요.');
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
    const calendarId = payload.calendarId == null ? (current?.calendarId ?? calendar.localCalendarId()) : Number(payload.calendarId);
    const target = calendar.listCalendars().find(item => item.id === calendarId);
    if (!target || target.kind !== 'local') throw new Error('직접 등록 가능한 캘린더를 선택해 주세요.');
    return {
      title, startsAt, endsAt, allDay, calendarId,
      location: text(payload.location ?? current?.location ?? '', '장소', { empty: true, limit: 10_000 }) || null,
      note: text(payload.note ?? current?.note ?? '', '상세 내용', { empty: true }) || null,
      rrule: owns(payload, 'rrule') ? recurrence(payload.rrule) : current?.rrule ?? null,
      ...(payload.uid ? { uid: text(payload.uid, '일정 식별자', { limit: 10_000 }) } : {}),
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
      tasks: data.item.filter(item => includeDeleted || !item.deleted_at).map(item => taskView(item, data.project)),
      projects: workView.projects.map(project => ({ id: project.id, name: project.name, sort: project.sort })),
      archivedProjects: deletedProjects,
      deletedProjects,
      events: calendar.listBetween(from.toISOString(), to.toISOString()).map(normalizeEvent),
      calendars: calendar.listCalendars(),
      notes: note.listNotes().map(item => noteView(item)),
      noteTags: note.listTags(),
      notices: [work.status().notice, note.status().notice, calendar.state.reason === 'recovered' ? '손상된 이전 캘린더 파일을 보관했습니다.' : null].filter(Boolean),
    };
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
        const id = calendar.addEvent(fields);
        return normalizeEvent(rawEvent(id));
      }
      case 'event.update': {
        const current = rawEvent(payload.id, { writable: true });
        const occurrenceId = payload.recurrenceId ? iso(payload.recurrenceId, '회차 시각') : null;
        const duration = current.endsAt ? Date.parse(current.endsAt) - Date.parse(current.startsAt) : null;
        const base = occurrenceId
          ? { ...current, startsAt: occurrenceId, endsAt: duration == null ? null : new Date(Date.parse(occurrenceId) + duration).toISOString() }
          : current;
        const fields = eventFields(payload, base);
        if (occurrenceId && payload.scope === 'all') {
          const offset = Date.parse(current.startsAt) - Date.parse(occurrenceId);
          fields.startsAt = new Date(Date.parse(fields.startsAt) + offset).toISOString();
          if (fields.endsAt) fields.endsAt = new Date(Date.parse(fields.endsAt) + offset).toISOString();
        }
        if (payload.recurrenceId && payload.scope === 'one') {
          if (fields.location !== current.location || fields.note !== current.note || fields.rrule !== current.rrule || fields.calendarId !== current.calendarId) {
            throw new Error('장소·상세 내용·반복 규칙 변경은 전체 반복 일정에 적용해 주세요.');
          }
          if (!calendar.setOverride(current.id, occurrenceId, fields)) throw new Error('회차를 수정하지 못했습니다.');
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
          const id = calendar.splitEventSeries(current.id, occurrenceId, fields);
          if (!id) throw new Error('반복 일정을 나누지 못했습니다.');
          return normalizeEvent(rawEvent(id));
        } else if (!calendar.updateEvent(current.id, fields)) throw new Error('일정을 수정하지 못했습니다.');
        return normalizeEvent(rawEvent(current.id));
      }
      case 'event.delete': {
        const current = rawEvent(payload.id, { writable: true });
        if (payload.recurrenceId && payload.scope === 'one') calendar.excludeOccurrence(current.id, iso(payload.recurrenceId, '회차 시각'));
        else if (payload.recurrenceId && payload.scope === 'future') calendar.truncateSeries(current.id, iso(payload.recurrenceId, '회차 시각'));
        else calendar.softDeleteEvent(current.id);
        return { id: current.id };
      }
      case 'event.restore': rawEvent(payload.id, { writable: true }); calendar.restoreEvent(Number(payload.id)); return normalizeEvent(rawEvent(payload.id));
      case 'calendar.parse': {
        const now = payload.now == null ? new Date() : new Date(payload.now);
        if (!Number.isFinite(now.getTime())) throw new Error('기준 날짜가 올바르지 않습니다.');
        return parseLine(text(payload.text, '일정 입력', { limit: 10_000 }), now);
      }
      case 'subscription.list': return calendar.listCalendars().filter(item => item.kind === 'subscription');
      case 'subscription.add': {
        const url = text(payload.url, '구독 주소', { limit: 10_000 }).trim();
        let parsed; try { parsed = new URL(url); } catch { throw new Error('http(s) 구독 주소를 입력해 주세요.'); }
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('http(s) 구독 주소를 입력해 주세요.');
        if (calendar.listCalendars().some(item => item.url === url)) throw new Error('이미 등록된 구독 주소입니다.');
        const id = calendar.addCalendar({ kind: 'subscription', name: payload.name ? text(payload.name, '이름', { limit: 1000 }) : url, url });
        const result = await syncCalendar(calendar, calendar.listCalendars().find(item => item.id === id), { fetchImpl });
        return { id, ...result };
      }
      case 'subscription.sync': {
        if (subscriptionBusy) throw new Error('캘린더를 동기화하고 있습니다.');
        subscriptionBusy = true;
        try {
          if (payload.id == null) return await syncAll(calendar, { fetchImpl });
          const item = calendar.listCalendars().find(item => item.id === Number(payload.id) && item.kind === 'subscription');
          if (!item) throw new Error('구독을 찾을 수 없습니다.');
          return await syncCalendar(calendar, item, { fetchImpl });
        } finally { subscriptionBusy = false; }
      }
      case 'subscription.toggle': {
        const item = calendar.listCalendars().find(item => item.id === Number(payload.id) && item.kind === 'subscription');
        if (!item) throw new Error('구독을 찾을 수 없습니다.');
        const enabled = owns(payload, 'enabled') ? !!payload.enabled : !item.enabled;
        calendar.updateCalendar(item.id, { enabled }); return { id: item.id, enabled };
      }
      case 'subscription.delete': {
        const item = calendar.listCalendars().find(item => item.id === Number(payload.id) && item.kind === 'subscription');
        if (!item) throw new Error('구독을 찾을 수 없습니다.');
        calendar.deleteCalendar(item.id); return { id: item.id };
      }
      case 'ics.import': {
        const content = text(payload.text, 'iCalendar 파일', { limit: 8 * 1024 * 1024 });
        const parsed = parseIcs(content);
        if (!parsed.ok) throw new Error('iCalendar 파일을 읽지 못했습니다.');
        const id = calendar.addCalendar({ kind: 'local', name: payload.name ? text(payload.name, '달력 이름', { limit: 1000 }) : parsed.name || '가져온 일정' });
        const originals = parsed.events.filter(event => !event.recurrenceId && !isCancelled(event));
        const stats = calendar.replaceCalendarEvents(id, originals);
        for (const override of parsed.events.filter(event => event.recurrenceId)) {
          const parent = calendar.allEvents().find(event => event.calendarId === id && event.uid === override.uid);
          if (parent) calendar.setOverride(parent.id, override.recurrenceId, { ...override, cancelled: isCancelled(override) });
        }
        return { calendarId: id, ...stats, errors: parsed.errors.length };
      }
      case 'ics.export': {
        const events = calendar.allEvents().filter(event => event.calendarKind === 'local').map(event => ({ ...event, overrides: calendar.listOverrides(event.id) }));
        return buildIcs(events, { name: 'WHENDESK' });
      }
      default: throw new Error(`지원하지 않는 작업입니다: ${type}`);
    }
  }
  function exportAll() {
    mustOpen();
    return { app: 'whendesk', version: 1, exportedAt: new Date().toISOString(), work: work.exportAll(), calendar: calendar.exportAll(), note:note.exportAll() };
  }
  function close() {
    if (closed) return;
    closed = true;
    work.close(); calendar.close(); note.close();
  }
  return { state, mutate, exportAll, close, work, calendar, note, searchNotes, noteAttachmentPath };
}
