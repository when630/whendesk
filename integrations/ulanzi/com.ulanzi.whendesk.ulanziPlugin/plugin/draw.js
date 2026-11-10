// 키 화면 그리기 (196×196 PNG). whenpc(NOIR)·WHENTERMINAL 덱 키와 같은 결:
// 순검정 바탕 · 흰 글자 · 빨강 하나. 지금 봐야 하는 키(마감 지난 할 일, 곧 시작하거나 진행 중인 일정)는 키 전체를 빨강으로 칠한다
/* exported Draw */
const Draw = (() => {
  const SIZE = 196
  const PAD = 16
  const K = '#0a0a0a'
  const W = '#ffffff'
  const R = '#ff2a12'
  const DIM = '#7a7a7a'
  const FAINT = '#4a4a4a'
  const LINE = '#2a2a2a'
  const FONT = "'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif"
  const MONO = "'Cascadia Mono', Consolas, 'Malgun Gothic', monospace"
  const WEEK = '일월화수목금토'

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')

  /** 바탕이 빨강이면 모든 글자·선이 흰색이 된다 (WHENTERMINAL NEEDS YOU와 같다) */
  function palette(alarm) {
    return alarm
      ? { bg: R, ink: W, dim: W, faint: W, line: W, sig: W }
      : { bg: K, ink: W, dim: DIM, faint: FAINT, line: LINE, sig: R }
  }

  function clear(bg) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
  }

  function font(weight, px, family = FONT) {
    ctx.font = `${weight} ${px}px ${family}`
  }

  function text(str, x, y, color, align = 'left') {
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(str, x, y)
  }

  /** 폭에 맞춰 줄을 나눈다. 한글은 글자 단위, 영문·숫자 단어는 단어째 넘긴다. 넘치면 마지막 줄 끝을 … */
  function wrap(str, width, maxLines) {
    const lines = []
    let line = ''
    for (const ch of Array.from(String(str).replace(/\s+/g, ' ').trim())) {
      if (ctx.measureText(line + ch).width > width && line) {
        const word = /[A-Za-z0-9]$/.test(line) && /[A-Za-z0-9]/.test(ch) ? /[A-Za-z0-9._-]+$/.exec(line)[0] : ''
        if (word && word.length < line.length) {
          lines.push(line.slice(0, -word.length).trimEnd())
          line = word + ch
        } else {
          lines.push(line.trimEnd())
          line = ch === ' ' ? '' : ch
        }
        if (lines.length === maxLines) break
      } else line += ch
    }
    if (lines.length < maxLines && line) lines.push(line)
    else if (lines.length === maxLines && line) {
      let last = lines[maxLines - 1]
      while (last && ctx.measureText(last + '…').width > width) last = last.slice(0, -1)
      lines[maxLines - 1] = last + '…'
    }
    return lines
  }

  function fit(str, width) {
    if (ctx.measureText(str).width <= width) return str
    let t = str
    while (t && ctx.measureText(t + '…').width > width) t = t.slice(0, -1)
    return t + '…'
  }

  /** 맨 위 줄: 이름(왼쪽, 흰색 굵게) · 보조 글(오른쪽) + 구분선. whenpc header와 같은 자리 */
  function header(c, name, side, sideColor) {
    font(800, 22)
    text(name, PAD, 36, c.ink)
    if (side) {
      font(700, 16, MONO)
      text(side, SIZE - PAD, 35, sideColor || c.dim, 'right')
    }
    ctx.fillStyle = c.line
    ctx.fillRect(PAD, 50, SIZE - PAD * 2, 3)
  }

  /** 가로 막대 (whenpc 요약과 같은 결) */
  function bar(c, y, ratio) {
    ctx.fillStyle = c.line
    ctx.fillRect(PAD, y, SIZE - PAD * 2, 10)
    if (ratio > 0) {
      ctx.fillStyle = c.ink
      ctx.fillRect(PAD, y, Math.round((SIZE - PAD * 2) * Math.min(1, ratio)), 10)
    }
  }

  const png = () => canvas.toDataURL('image/png')
  const dayMs = (key) => new Date(`${key}T12:00:00`).getTime()

  /** 마감 배지: 오늘 · D-3 · D+2(지남) */
  function dueBadge(due, today) {
    if (!due) return null
    const diff = Math.round((dayMs(due) - dayMs(today)) / 86400e3)
    if (diff === 0) return { text: '오늘', hot: true, over: false }
    if (diff < 0) return { text: `D+${-diff}`, hot: true, over: true }
    return { text: `D-${diff}`, hot: false, over: false }
  }

  function hhmm(iso) {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  /** 불릿 저널 기호 하나 (• 할 일 · × 완료 · 줄 그은 • 취소) */
  function bullet(kind, x, y, color, r = 8) {
    ctx.fillStyle = color
    ctx.strokeStyle = color
    if (kind === 'done') {
      ctx.lineWidth = 6
      ctx.lineCap = 'square'
      ctx.beginPath()
      ctx.moveTo(x - r, y - r)
      ctx.lineTo(x + r, y + r)
      ctx.moveTo(x + r, y - r)
      ctx.lineTo(x - r, y + r)
      ctx.stroke()
      return
    }
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    if (kind === 'cancelled') {
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(x - r * 2, y)
      ctx.lineTo(x + r * 2, y)
      ctx.stroke()
    }
  }

  /** 오늘: 남은 할 일 수, 오늘 끝낸 비율 막대, 아래에 지연(빨강) · 오늘 마감 · 오늘 완료 중 하나 */
  function today(s) {
    const c = palette(false)
    clear(c.bg)
    const d = new Date(`${s.today}T12:00:00`)
    header(c, 'TODAY', `${d.getMonth() + 1}/${d.getDate()} ${WEEK[d.getDay()]}`)
    font(900, 76)
    text(String(s.counts.todo), PAD - 2, 128, s.counts.todo ? c.ink : c.faint)
    const numW = ctx.measureText(String(s.counts.todo)).width
    font(700, 22)
    text('남음', PAD + numW + 6, 128, c.dim)
    const total = s.counts.todo + s.counts.doneToday
    bar(c, 142, total ? s.counts.doneToday / total : 0)
    font(800, 18)
    if (s.counts.overdue) text(`지연 ${s.counts.overdue}`, PAD, 182, c.sig)
    else if (s.counts.dueToday) text(`오늘 마감 ${s.counts.dueToday}`, PAD, 182, c.ink)
    else text('지연 없음', PAD, 182, c.dim)
    font(700, 16)
    text(`완료 ${s.counts.doneToday}`, SIZE - PAD, 182, c.dim, 'right')
    return png()
  }

  /**
   * 할 일 하나: 위에 기호와 마감, 가운데 제목(세 줄), 아래 프로젝트. 마감이 지났으면 키 전체가 빨강.
   * flash: null | 'done' | 'cancelled' — 막 누른 키. 다시 누르면 되돌린다는 안내를 아래에 둔다
   */
  function task(t, todayKey, flash, slot) {
    const closed = flash === 'done' || flash === 'cancelled'
    const badge = closed ? null : dueBadge(t.due, todayKey)
    const c = palette(!!(badge && badge.over))
    clear(c.bg)
    bullet(flash || 'open', PAD + 10, 29, closed ? c.dim : c.ink)
    font(700, 16, MONO)
    text(String(slot).padStart(2, '0'), SIZE - PAD, 35, c.faint, 'right')
    let right = SIZE - PAD - 30
    if (badge) {
      font(800, 21)
      text(badge.text, right, 36, badge.hot ? c.sig : c.dim, 'right')
      right -= ctx.measureText(badge.text).width + 10
    }
    if (!closed && t.postponed >= 3) {
      font(800, 21)
      text(`>${t.postponed}`, right, 36, c.sig, 'right')
    }
    ctx.fillStyle = c.line
    ctx.fillRect(PAD, 50, SIZE - PAD * 2, 3)
    font(800, 26)
    const lines = wrap(t.title, SIZE - PAD * 2, 3)
    lines.forEach((line, i) => {
      const y = 88 + i * 32
      text(line, PAD, y, closed ? c.dim : c.ink)
      if (closed) {
        ctx.fillStyle = c.dim
        ctx.fillRect(PAD, y - 9, ctx.measureText(line).width, 3)
      }
    })
    font(700, 18)
    if (closed) text(flash === 'done' ? '완료 · 다시 눌러 되돌림' : '취소 · 다시 눌러 되돌림', SIZE / 2, 182, c.sig, 'center')
    else text(fit(t.project || '미지정', SIZE - PAD * 2), PAD, 182, c.dim)
    return png()
  }

  /** 할 일이 키보다 많을 때 마지막 키 (WHENTERMINAL overflow와 같은 자리) */
  function overflow(count, slot) {
    const c = palette(false)
    clear(c.bg)
    font(700, 16, MONO)
    text(String(slot).padStart(2, '0'), SIZE - PAD, 34, c.dim, 'right')
    font(900, 64)
    text(`+${count}`, SIZE / 2, 118, c.ink, 'center')
    font(800, 20)
    text('MORE', SIZE / 2, 160, c.dim, 'center')
    return png()
  }

  /** 보여 줄 할 일이 없는 키 (WHENTERMINAL empty와 같은 자리) */
  function empty(slot) {
    const c = palette(false)
    clear(c.bg)
    font(800, 24)
    text('EMPTY', SIZE / 2, 42, c.dim, 'center')
    ctx.fillStyle = c.line
    ctx.fillRect(PAD, 58, SIZE - PAD * 2, 3)
    font(900, 72, MONO)
    text(String(slot).padStart(2, '0'), SIZE / 2, 142, c.faint, 'center')
    font(700, 19)
    text('빈 자리', SIZE / 2, 182, c.dim, 'center')
    return png()
  }

  /** 남은 시간 말: 진행 중 · 곧 시작 · 12분 후 · 2시간 후 · 내일. alarm: 키 전체를 빨강으로 칠할 때 */
  function until(ev, now) {
    const start = new Date(ev.startsAt).getTime()
    if (start <= now) return { label: '진행 중', alarm: true }
    const min = Math.ceil((start - now) / 60000)
    if (min <= 1) return { label: '곧 시작', alarm: true }
    if (min < 60) return { label: `${min}분 후`, alarm: min <= 5, hot: min <= 15 }
    if (new Date(start).toDateString() === new Date(now).toDateString()) return { label: `${Math.floor(min / 60)}시간 ${min % 60 ? `${min % 60}분 ` : ''}후` }
    return { label: '내일' }
  }

  /** 다음 일정: 시각 · 남은 시간 · 제목. 15분 안이면 빨간 글자, 5분 안·진행 중이면 키 전체가 빨강 */
  function next(ev, events, now) {
    if (!ev) {
      const c = palette(false)
      clear(c.bg)
      header(c, 'NEXT')
      font(800, 24)
      text('일정 없음', SIZE / 2, 116, c.dim, 'center')
      if (events && events.allDay.length) {
        font(700, 17)
        text(fit(`종일 · ${events.allDay[0]}`, SIZE - PAD * 2), SIZE / 2, 176, c.dim, 'center')
      }
      return png()
    }
    const u = until(ev, now)
    const c = palette(u.alarm)
    clear(c.bg)
    header(c, u.label === '진행 중' ? 'NOW' : 'NEXT', u.label, u.hot || u.alarm ? c.sig : c.dim)
    font(900, 46, MONO)
    text(hhmm(ev.startsAt), PAD - 2, 102, c.ink)
    font(800, 22)
    const lines = wrap(ev.title, SIZE - PAD * 2, 2)
    lines.forEach((line, i) => text(line, PAD, 138 + i * 28, c.ink))
    if (lines.length < 2 && ev.location) {
      font(700, 17)
      text(fit(ev.location, SIZE - PAD * 2), PAD, 178, c.dim)
    } else if (events && events.remaining > 1) {
      font(700, 15, MONO)
      text(`+${events.remaining - 1} 오늘`, SIZE - PAD, 186, c.dim, 'right')
    }
    return png()
  }

  const COUNT = {
    inbox: { label: 'INBOX', sub: '분류할 것', hot: false },
    waiting: { label: 'WAITING', sub: '기다리는 일', hot: false },
    staleWaiting: { label: 'WAITING', sub: '5일 넘게', hot: true },
    overdue: { label: 'OVERDUE', sub: '마감 지남', hot: true },
    dueToday: { label: 'DUE', sub: '오늘 마감', hot: false },
    postponed: { label: 'POSTPONED', sub: '세 번 넘게 미룸', hot: true },
    doneToday: { label: 'DONE', sub: '오늘 끝냄', hot: false },
    todo: { label: 'TODO', sub: '남은 할 일', hot: false },
  }

  /** 개수 하나. 신호 항목은 0보다 크면 큰 숫자가 빨강 (whenpc CPU 100%처럼), 0이면 흐리게 */
  function count(pick, value) {
    const k = COUNT[pick] || COUNT.inbox
    const c = palette(false)
    clear(c.bg)
    header(c, k.label)
    font(900, 84)
    text(String(value), SIZE / 2, 142, !value ? c.faint : k.hot ? c.sig : c.ink, 'center')
    font(700, 19)
    text(k.sub, SIZE / 2, 182, c.dim, 'center')
    return png()
  }

  /** 담기 키. flash: null | { ok, message } — 실패하면 키 전체가 빨강 */
  function capture(mode, phrase, flash) {
    const c = palette(!!(flash && !flash.ok))
    clear(c.bg)
    header(c, mode === 'clipboard' ? 'CLIP' : 'CAPTURE')
    if (flash) {
      ctx.strokeStyle = c.ink
      ctx.lineWidth = 12
      ctx.lineCap = 'square'
      ctx.beginPath()
      if (flash.ok) {
        ctx.moveTo(70, 98)
        ctx.lineTo(90, 118)
        ctx.lineTo(128, 80)
      } else {
        ctx.moveTo(SIZE / 2, 74)
        ctx.lineTo(SIZE / 2, 110)
      }
      ctx.stroke()
      if (!flash.ok) {
        ctx.fillStyle = c.ink
        ctx.fillRect(SIZE / 2 - 6, 122, 12, 12)
      }
      font(800, 18)
      wrap(flash.message, SIZE - PAD * 2, 2).forEach((line, i) => text(line, SIZE / 2, 164 + i * 22, c.ink, 'center'))
      return png()
    }
    ctx.fillStyle = c.ink
    ctx.fillRect(SIZE / 2 - 5, 72, 10, 56)
    ctx.fillRect(SIZE / 2 - 28, 95, 56, 10)
    font(700, 18)
    const sub = mode === 'clipboard' ? '복사한 글 담기' : phrase || '문구를 정해 주세요'
    text(fit(sub, SIZE - PAD * 2), SIZE / 2, 176, phrase || mode === 'clipboard' ? c.ink : c.dim, 'center')
    return png()
  }

  const VIEW = {
    command: { label: 'COMMAND', name: '입력줄' },
    dashboard: { label: 'DESK', name: '대시보드' },
    inbox: { label: 'INBOX', name: '인박스' },
    todo: { label: 'TODO', name: '할 일' },
    waiting: { label: 'WAITING', name: '대기' },
    calendar: { label: 'CALENDAR', name: '캘린더' },
  }

  /** 화면 열기 키: 이름 · 화살표(↗) · 화면 이름 */
  function open(view) {
    const v = VIEW[view] || VIEW.dashboard
    const c = palette(false)
    clear(c.bg)
    header(c, v.label)
    ctx.strokeStyle = c.ink
    ctx.lineWidth = 10
    ctx.lineCap = 'square'
    ctx.lineJoin = 'miter'
    ctx.beginPath()
    ctx.moveTo(78, 126)
    ctx.lineTo(118, 86)
    ctx.moveTo(88, 82)
    ctx.lineTo(122, 82)
    ctx.lineTo(122, 116)
    ctx.stroke()
    font(800, 22)
    text(v.name, SIZE / 2, 178, c.ink, 'center')
    return png()
  }

  /** 앱에 연결하지 못함: WHENDESK 글리프(•_)와 빨간 커서 — whenpc PC_■ · WHENTERMINAL >_ 와 같은 자리 */
  function offline() {
    const c = palette(false)
    clear(c.bg)
    bullet('open', 66, 92, c.dim, 18)
    ctx.fillStyle = R
    ctx.fillRect(98, 116, 36, 12)
    font(800, 18)
    text('OFFLINE', SIZE / 2, 166, R, 'center')
    font(700, 14)
    text('WHENDESK 실행 필요', SIZE / 2, 186, c.dim, 'center')
    return png()
  }

  return { today, task, overflow, empty, next, count, capture, open, offline, SIZE }
})()
