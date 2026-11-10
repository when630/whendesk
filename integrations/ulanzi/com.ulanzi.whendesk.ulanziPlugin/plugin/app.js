/* global $UD, Draw */
// WHENDESK 덱 플러그인 주 서비스.
// 앱의 로컬 통로(127.0.0.1:37632, main/deck.mjs)에서 상태를 SSE로 받아 키마다 그린다.
//  - 오늘: 남은 할 일 수와 지연·오늘 마감·오늘 완료. 누르면 대시보드
//  - 할 일: 놓은 키를 위→아래, 왼쪽→오른쪽 순으로 세어 N번째 키에 N번째 할 일(대시보드 ToDo 순서).
//    짧게 누르면 완료, 길게(0.6초) 누르면 취소. 5초 안에 다시 누르면 되돌린다
//  - 다음 일정: 시각·남은 시간·제목. 누르면 캘린더의 그 일정
//  - 개수: 인박스·대기·마감 지남 등 하나. 누르면 그 목록
//  - 담기: 클립보드 글 또는 정해 둔 문구를 담는다(접두 기호 . 할 일 · @ 일정 · - 메모)
//  - 열기: 입력줄·대시보드·인박스·할 일·대기·캘린더

const BASE = 'http://127.0.0.1:37632'
const PLUGIN = 'com.ulanzi.ulanzistudio.whendesk'
const KIND_BY_UUID = {
  [`${PLUGIN}.today`]: 'today',
  [`${PLUGIN}.task`]: 'task',
  [`${PLUGIN}.next`]: 'next',
  [`${PLUGIN}.count`]: 'count',
  [`${PLUGIN}.capture`]: 'capture',
  [`${PLUGIN}.open`]: 'open',
}
const COUNTS = ['inbox', 'waiting', 'staleWaiting', 'overdue', 'dueToday', 'postponed', 'doneToday', 'todo']
const VIEWS = ['command', 'dashboard', 'inbox', 'todo', 'waiting', 'calendar']
const COUNT_VIEW = { inbox: 'inbox', waiting: 'waiting', staleWaiting: 'waiting', overdue: 'todo', dueToday: 'todo', postponed: 'todo', doneToday: 'dashboard', todo: 'todo' }
const LONG_PRESS = 600
const UNDO_WINDOW = 5000

/** context → { kind, key, actionid, slot, pick, view, mode, phrase } */
const keys = new Map()
/** context → 마지막으로 보낸 그림 (같으면 다시 보내지 않는다) */
const sent = new Map()
/** context → 지금 보여 주는 할 일 (누르면 완료할 것) */
const target = new Map()
/** context → { task, kind: 'done' | 'cancelled', until } 막 닫은 할 일. 그동안 키는 그 일을 붙들고 있다 */
const flash = new Map()
/** context → { ok, message, until } 담기 결과 */
const notice = new Map()
/** context → { at, timer, long } 누르고 있는 키 */
const pressing = new Map()
/** context → keydown·keyup으로 처리한 시각. run이 뒤따라 와도 두 번 하지 않는다 */
const lastHandled = new Map()
let state = null
let online = false
let offlineTimer = null

$UD.connect(PLUGIN)

/** 키 위치 'col_row' → 정렬 값. 모르는 형식이면 뒤로 */
function order(key) {
  const m = /^(\d+)_(\d+)$/.exec(key || '')
  return m ? Number(m[2]) * 1000 + Number(m[1]) : 1e9
}

function register(jsn) {
  const ctx = jsn.context
  const { uuid, key, actionid } = $UD.decodeContext(ctx)
  // 키를 옮기면 Studio는 새 위치로 add만 보내고 옛 위치를 clear하지 않는다(WHENTERMINAL 플러그인에서 겪음). ActionID로 정리한다
  let prev = keys.get(ctx)
  for (const [other, k] of keys) {
    if (other === ctx || k.actionid !== actionid) continue
    prev = prev || k
    forget(other)
  }
  keys.set(ctx, {
    kind: KIND_BY_UUID[uuid] || 'today',
    key,
    actionid,
    slot: prev ? prev.slot : 0,
    pick: prev ? prev.pick : 'inbox',
    view: prev ? prev.view : 'dashboard',
    mode: prev ? prev.mode : 'clipboard',
    phrase: prev ? prev.phrase : '',
  })
  applySettings(ctx, jsn.param)
}

function forget(ctx) {
  keys.delete(ctx)
  sent.delete(ctx)
  target.delete(ctx)
  flash.delete(ctx)
  notice.delete(ctx)
  const p = pressing.get(ctx)
  if (p) clearTimeout(p.timer)
  pressing.delete(ctx)
}

function applySettings(ctx, param) {
  const k = keys.get(ctx)
  if (!k || !param) return
  const has = (name) => Object.prototype.hasOwnProperty.call(param, name)
  if (has('slot')) k.slot = Number(param.slot) || 0
  if (COUNTS.includes(param.pick)) k.pick = param.pick
  if (VIEWS.includes(param.view)) k.view = param.view
  if (param.mode === 'clipboard' || param.mode === 'phrase') k.mode = param.mode
  if (has('phrase')) k.phrase = String(param.phrase || '').slice(0, 500)
}

/** 할 일 키마다 순번. 고정한 키는 그 번호, 나머지는 위치 순으로 1부터 */
function slots() {
  const list = [...keys.entries()].filter(([, k]) => k.kind === 'task')
  const auto = list.filter(([, k]) => !k.slot).sort(([, a], [, b]) => order(a.key) - order(b.key) || String(a.actionid).localeCompare(String(b.actionid)))
  const out = new Map()
  auto.forEach(([ctx], i) => out.set(ctx, i + 1))
  for (const [ctx, k] of list) if (k.slot) out.set(ctx, k.slot)
  return out
}

function send(ctx, img) {
  if (sent.get(ctx) === img) return
  sent.set(ctx, img)
  $UD.setBaseDataIcon(ctx, img)
}

function render() {
  const now = Date.now()
  for (const [ctx, f] of flash) if (f.until <= now) flash.delete(ctx)
  for (const [ctx, n] of notice) if (n.until <= now) notice.delete(ctx)
  const ready = online && state && state.ok
  // 막 닫은 할 일은 목록에서 빠졌어도 그 키에 남긴다. 나머지 키는 빠진 일을 건너뛴 순서로 채운다
  const held = new Set([...flash.values()].map((f) => f.task.id))
  const todos = ready ? state.todos.filter((t) => !held.has(t.id)) : []
  const map = slots()
  const flashed = [...map.entries()].filter(([ctx]) => flash.has(ctx)).map(([, n]) => n)
  const last = Math.max(0, ...map.values())
  for (const [ctx, k] of keys) {
    if (k.kind === 'open') {
      send(ctx, Draw.open(k.view))
      continue
    }
    if (k.kind === 'capture') {
      send(ctx, Draw.capture(k.mode, k.phrase, notice.get(ctx) || null))
      continue
    }
    if (!ready) {
      target.delete(ctx)
      send(ctx, Draw.offline())
      continue
    }
    if (k.kind === 'today') send(ctx, Draw.today(state))
    else if (k.kind === 'next') send(ctx, Draw.next(state.next, state.events, now))
    else if (k.kind === 'count') send(ctx, Draw.count(k.pick, state.counts[k.pick] || 0))
    else if (k.kind === 'task') {
      const n = map.get(ctx)
      const f = flash.get(ctx)
      if (f) {
        send(ctx, Draw.task(f.task, state.today, f.kind, n))
        continue
      }
      // 붙들고 있는 키가 앞 순번이면 그만큼 당겨 쓴다
      const index = n - 1 - flashed.filter((m) => m < n).length
      if (n === last && todos.length > index + 1) {
        target.delete(ctx)
        send(ctx, Draw.overflow(todos.length - index, n))
        continue
      }
      const t = todos[index]
      if (!t) {
        target.delete(ctx)
        send(ctx, Draw.empty(n))
        continue
      }
      target.set(ctx, t)
      send(ctx, Draw.task(t, state.today, null, n))
    }
  }
}

// 남은 시간(12분 후)과 되돌리기 창이 흐르므로 자주 다시 그린다. 같은 그림은 보내지 않는다
setInterval(render, 1000)

function connect() {
  const es = new EventSource(`${BASE}/events`)
  es.onmessage = (e) => {
    try {
      state = JSON.parse(e.data)
    } catch {
      return
    }
    online = true
    if (offlineTimer) {
      clearTimeout(offlineTimer)
      offlineTimer = null
    }
    render()
  }
  // EventSource는 스스로 다시 붙는다. 잠깐 끊긴 것으로 키가 깜빡이지 않게 3초 기다린 뒤 OFFLINE
  es.onerror = () => {
    if (offlineTimer || !online) {
      if (!online) render()
      return
    }
    offlineTimer = setTimeout(() => {
      offlineTimer = null
      online = false
      render()
    }, 3000)
  }
}

/** POST. 성공하면 응답 본문, 실패하면 { error } */
async function post(path, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 204) return {}
    const data = await res.json().catch(() => ({}))
    return res.ok ? data : { error: data.error || `오류 ${res.status}` }
  } catch {
    return { error: 'WHENDESK가 꺼져 있어요' }
  }
}

async function closeTask(ctx, kind) {
  const t = target.get(ctx)
  if (!t) {
    post('/open?view=todo')
    return
  }
  flash.set(ctx, { task: t, kind, until: Date.now() + UNDO_WINDOW })
  sent.delete(ctx)
  render()
  const r = await post(kind === 'done' ? `/task/complete?id=${encodeURIComponent(t.id)}` : `/task/cancel?id=${encodeURIComponent(t.id)}`)
  if (r.error) {
    flash.delete(ctx)
    $UD.toast(r.error)
    render()
  }
}

async function undo(ctx) {
  const f = flash.get(ctx)
  flash.delete(ctx)
  render()
  const r = await post(f.kind === 'done' ? `/task/complete?id=${encodeURIComponent(f.task.id)}&done=0` : `/task/cancel?id=${encodeURIComponent(f.task.id)}&cancelled=0`)
  if (r.error) $UD.toast(r.error)
}

function pressTask(ctx, long) {
  if (flash.has(ctx)) {
    undo(ctx)
    return
  }
  closeTask(ctx, long ? 'cancelled' : 'done')
}

async function capture(ctx, k) {
  let r
  if (k.mode === 'phrase') {
    if (!k.phrase.trim()) {
      $UD.toast('키 설정에서 담을 문구를 정해 주세요')
      return
    }
    r = await post('/capture', { text: k.phrase })
  } else r = await post('/capture/clipboard')
  notice.set(ctx, { ok: !r.error, message: r.error || r.message || '담았어요', until: Date.now() + 1800 })
  render()
}

function act(ctx) {
  const k = keys.get(ctx)
  if (!k) return
  if (k.kind === 'today') post('/open?view=dashboard')
  else if (k.kind === 'next') {
    const ev = state && state.next
    post(ev ? `/open?view=calendar&id=${ev.id}&date=${ev.date}` : '/open?view=calendar')
  } else if (k.kind === 'count') post(`/open?view=${COUNT_VIEW[k.pick] || 'dashboard'}`)
  else if (k.kind === 'open') post(`/open?view=${k.view}`)
  else if (k.kind === 'capture') capture(ctx, k)
}

$UD.onConnected(() => connect())

$UD.onAdd((jsn) => {
  register(jsn)
  sent.delete(jsn.context)
  render()
})

$UD.onSetActive((jsn) => {
  // 페이지를 넘겨 다시 보이면 그림을 새로 보낸다
  if (jsn.active) {
    sent.delete(jsn.context)
    render()
  }
})

// 할 일 키는 누른 길이로 완료·취소를 가른다. 길게 누르면 손을 떼기 전에 취소한다(누르는 동안 결과가 보인다)
$UD.onKeyDown((jsn) => {
  const k = keys.get(jsn.context)
  if (!k || k.kind !== 'task') return
  const ctx = jsn.context
  const prev = pressing.get(ctx)
  if (prev) clearTimeout(prev.timer)
  const p = { at: Date.now(), long: false, timer: null }
  p.timer = setTimeout(() => {
    p.long = true
    pressTask(ctx, true)
  }, LONG_PRESS)
  pressing.set(ctx, p)
})

$UD.onKeyUp((jsn) => {
  const p = pressing.get(jsn.context)
  if (!p) return
  pressing.delete(jsn.context)
  clearTimeout(p.timer)
  if (!p.long) pressTask(jsn.context, false)
  lastHandled.set(jsn.context, Date.now())
})

$UD.onRun((jsn) => {
  const k = keys.get(jsn.context)
  if (!k) return
  if (k.kind === 'task') {
    // keydown·keyup이 오지 않는 환경(시뮬레이터 우클릭 등)에서는 run을 짧게 누른 것으로 본다
    if (pressing.has(jsn.context) || Date.now() - (lastHandled.get(jsn.context) || 0) < 1500) return
    pressTask(jsn.context, false)
    return
  }
  act(jsn.context)
})

$UD.onClear((jsn) => {
  for (const item of jsn.param || []) forget(item.context)
  render()
})

$UD.onParamFromApp((jsn) => {
  if (!keys.has(jsn.context)) register(jsn)
  else applySettings(jsn.context, jsn.param)
  sent.delete(jsn.context)
  render()
})

$UD.onParamFromPlugin((jsn) => {
  applySettings(jsn.context, jsn.param)
  sent.delete(jsn.context)
  render()
})
