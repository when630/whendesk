// 스트림덱 플러그인(integrations/ulanzi)용 로컬 통로. whenpc(37631)·WHENTERMINAL(37630)과 같은 방식이다.
// 127.0.0.1에서만 듣고 Host·Origin을 확인해 다른 사이트의 페이지가 읽거나 조작하지 못하게 한다.
//   GET  /state                  지금 상태 한 번
//   GET  /events                 SSE: 붙으면 지금 상태, 이후 바뀔 때마다
//   POST /task/complete?id=      완료 (&done=0이면 완료 해제)
//   POST /task/cancel?id=        안 하기로 함 (&cancelled=0이면 해제)
//   POST /capture                본문(JSON {text})을 담는다. 접두 기호(. 할 일 · @ 일정 · - 메모)를 따른다
//   POST /capture/clipboard      클립보드 글을 담는다
//   POST /open?view=             dashboard · command · inbox · todo · waiting · calendar (&id= 일정·할 일)
import http from 'node:http';

export const DECK_PORT = 37632;
export const STALE_WAITING_DAYS = 5;
const TODO_LIMIT = 40;
const BODY_LIMIT = 64 * 1024;

// 플러그인 WebView는 file:// 이나 로컬 서버에서 뜬다.
const allowedOrigin = origin =>
  !origin || origin === 'null' || origin.startsWith('file://') || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);

const pad = value => String(value).padStart(2, '0');
export const localDay = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * 덱 키가 그리는 작고 안정된 모양. Electron·DB 없이 시험할 수 있게 순수 함수로 둔다.
 * items·projects는 work.exportAll()의 행, events는 calendar.listBetween()의 일정(반복은 펼쳐진 것)이다.
 */
export function summarize({ items = [], projects = [], events = [], now = new Date() } = {}) {
  const today = localDay(now);
  const projectName = new Map(projects.map(project => [project.id, project.name]));
  const live = items.filter(item => !item.deleted_at);
  const open = live.filter(item => !item.done_at);
  const staleCutoff = now.getTime() - STALE_WAITING_DAYS * 86_400_000;
  // 대시보드 ToDo와 같은 순서: 마감 이른 순, 마감 없는 일은 뒤로.
  const todos = open
    .filter(item => item.kind === 'todo')
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))
    .slice(0, TODO_LIMIT)
    .map(item => ({
      id: item.id,
      title: item.title,
      project: projectName.get(item.project_id) ?? '',
      due: item.due ?? '',
      postponed: Number(item.postponed ?? 0),
    }));
  const waiting = open.filter(item => item.kind === 'waiting');
  const counts = {
    todo: open.filter(item => item.kind === 'todo').length,
    inbox: open.filter(item => item.kind === 'inbox').length,
    waiting: waiting.length,
    // 마감은 어느 분류에 있든 챙긴다(아침 브리핑과 같은 규칙).
    overdue: open.filter(item => item.due && item.due < today).length,
    dueToday: open.filter(item => item.due === today).length,
    staleWaiting: waiting.filter(item => Date.parse(item.nudged_at || item.captured_at) < staleCutoff).length,
    postponed: open.filter(item => Number(item.postponed ?? 0) >= 3).length,
    doneToday: live.filter(item => item.done_at && !item.cancelled && localDay(item.done_at) === today).length,
  };
  const nowMs = now.getTime();
  const timed = events
    .filter(event => !event.allDay && event.startsAt)
    .map(event => ({
      id: Number(event.id),
      title: event.title || '',
      startsAt: event.startsAt,
      endsAt: event.endsAt || null,
      date: localDay(event.startsAt),
      location: event.location || '',
    }))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  // 다음 일정: 아직 끝나지 않은 첫 일정(진행 중이면 그것). 끝이 없으면 시작 시각 한 점이다.
  const next = timed.find(event => Date.parse(event.endsAt || event.startsAt) > nowMs) || null;
  const todayTimed = timed.filter(event => event.date === today);
  const allDay = events.filter(event => event.allDay && event.startsAt && localDay(event.startsAt) <= today && (!event.endsAt || Date.parse(event.endsAt) > Date.parse(`${today}T00:00:00`)));
  return {
    v: 1,
    today,
    counts,
    todos,
    next,
    events: {
      total: todayTimed.length + allDay.length,
      remaining: todayTimed.filter(event => Date.parse(event.endsAt || event.startsAt) > nowMs).length,
      allDay: allDay.map(event => event.title || '').slice(0, 5),
    },
  };
}

/** 담을 글 → { kind, text }. 접두 기호가 없으면 할 일이다. 여러 줄이면 첫 줄이 제목, 나머지는 상세 내용 */
export function captureIntent(raw, rapid) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return null;
  const parsed = rapid?.parse(text);
  if (parsed) return parsed;
  return { kind: 'task', text };
}

export class DeckBridge {
  /**
   * hooks: {
   *   snapshot(): summarize() 결과 · busy(): 데이터 작업 중인지
   *   complete(id, done) · cancel(id, cancelled) · capture(text) → { message } · clipboard(): 글
   *   open(view, { id, date })
   * }
   */
  constructor(hooks, { port = DECK_PORT } = {}) {
    this.hooks = hooks;
    this.port = port;
    this.hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    this.server = null;
    this.clients = new Set();
    this.last = '';
    this.heartbeat = null;
    this.tick = null;
    this.pushTimer = null;
  }

  start() {
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch(error => {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.message || String(error) }));
      });
    });
    server.on('error', error => {
      // 다른 인스턴스(설치본 옆의 개발 실행 등)가 포트를 쓰고 있으면 통로 없이 돈다.
      console.warn(`deck channel unavailable on ${this.port}`, error.code || error);
      this.server = null;
    });
    server.listen(this.port, '127.0.0.1');
    this.server = server;
    this.heartbeat = setInterval(() => { for (const client of this.clients) client.write(': ping\n\n'); }, 25_000);
    // 시간이 흐르면 바뀌는 것(날짜 넘김, 끝난 일정, 지난 마감)을 위해 30초마다 보고, 달라졌을 때만 보낸다.
    this.tick = setInterval(() => this.push(), 30_000);
  }

  stop() {
    clearInterval(this.heartbeat);
    clearInterval(this.tick);
    clearTimeout(this.pushTimer);
    for (const client of this.clients) client.end();
    this.clients.clear();
    this.server?.close();
    this.server = null;
  }

  /** 데이터가 바뀌었다. 몰아서 한 번 보낸다 */
  changed() {
    if (this.clients.size === 0 || this.pushTimer) return;
    this.pushTimer = setTimeout(() => { this.pushTimer = null; this.push(); }, 150);
  }

  state() {
    try {
      return { ok: true, ...this.hooks.snapshot(), at: Date.now() };
    } catch (error) {
      return { ok: false, error: error.message || String(error), at: Date.now() };
    }
  }

  push(force = false) {
    if (this.clients.size === 0) return;
    const { at, ...body } = this.state();
    const key = JSON.stringify(body);
    if (!force && key === this.last) return;
    this.last = key;
    const data = `data: ${JSON.stringify({ ...body, at })}\n\n`;
    for (const client of this.clients) client.write(data);
  }

  async handle(req, res) {
    const origin = req.headers.origin;
    // DNS 리바인딩: 다른 이름으로 들어온 요청은 거절한다.
    if (!this.hosts.has(req.headers.host || '') || !allowedOrigin(origin)) {
      res.writeHead(403).end();
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }).end();
      return;
    }
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const { pathname, searchParams } = url;
    if (req.method === 'GET' && pathname === '/state') {
      json(res, 200, this.state());
      return;
    }
    if (req.method === 'GET' && pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const state = this.state();
      res.write(`retry: 2000\ndata: ${JSON.stringify(state)}\n\n`);
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    if (pathname === '/open') {
      this.hooks.open(searchParams.get('view') || 'dashboard', { id: searchParams.get('id'), date: searchParams.get('date') });
      res.writeHead(204).end();
      return;
    }
    const writes = {
      '/task/complete': async () => {
        await this.hooks.complete(requireId(searchParams), searchParams.get('done') !== '0');
        return {};
      },
      '/task/cancel': async () => {
        await this.hooks.cancel(requireId(searchParams), searchParams.get('cancelled') !== '0');
        return {};
      },
      '/capture': async () => this.hooks.capture(textOf(await readBody(req))),
      '/capture/clipboard': async () => {
        const text = String(this.hooks.clipboard() ?? '').trim();
        if (!text) throw status(409, '클립보드가 비어 있어요');
        return this.hooks.capture(text.slice(0, BODY_LIMIT));
      },
    };
    if (!writes[pathname]) {
      res.writeHead(404).end();
      return;
    }
    if (this.hooks.busy()) {
      json(res, 503, { error: '데이터 작업 중이에요' });
      return;
    }
    try {
      const result = await writes[pathname]();
      json(res, 200, { ok: true, ...(result || {}) });
    } catch (error) {
      json(res, error.status || 400, { error: error.message || String(error) });
    }
    this.changed();
  }
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
}

function status(code, message) {
  const error = new Error(message);
  error.status = code;
  return error;
}

function requireId(params) {
  const id = params.get('id');
  if (!id) throw status(400, '할 일을 고르지 않았어요');
  return id;
}

function textOf(body) {
  if (!body) throw status(400, '담을 글이 없어요');
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.text === 'string') return parsed.text;
  } catch { /* 일반 글로 본다 */ }
  return body;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(status(413, '담을 글이 너무 길어요'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
