// SMTC Worker — 애드온을 만지는 유일한 곳이다 (D-16).
//
// 애드온을 메인이나 렌더러에서 직접 쓰면 그 스레드가 잠긴다. 그래서 이 파일
// 밖에서는 .node를 require하지 않는다. 메인과는 postMessage로만 말한다.
//
// 이벤트 콜백은 애드온이 네이티브 스레드에서 부른다. 여기서는 받은 것을
// 그대로 넘기기만 하고, 해석은 전부 메인의 session.mjs가 한다.
import { createRequire } from 'node:module'
import { parentPort, workerData } from 'node:worker_threads'

const require = createRequire(import.meta.url)

let smtc = null
let addon = null

function send(msg) {
  parentPort?.postMessage(msg)
}

function fail(stage, err) {
  send({ type: 'fatal', stage, message: String(err?.message ?? err) })
}

try {
  // 경로는 메인이 계산해 넘긴다. 포장된 앱에서는 asar 밖에 있고(asarUnpack),
  // 개발 중에는 vendor/에 있다 — 그 분기를 worker가 알 필요는 없다.
  addon = require(workerData.addonPath)
} catch (err) {
  fail('load', err)
}

if (addon) {
  try {
    smtc = new addon.SMTCMonitor()

    // 애드온 콜백은 (error, data) 꼴이다. error가 오면 그 이벤트만 버린다 —
    // 한 번 실패했다고 감시를 통째로 끊을 이유는 없다.
    const on = (register, name, pick) => {
      register.call(smtc, (error, data) => {
        if (error) return
        send({ type: 'event', name, payload: pick(data) })
      })
    }

    on(smtc.onSessionAdded, 'session-added', (media) => ({ appId: media.sourceAppId, media }))
    on(smtc.onSessionRemoved, 'session-removed', (appId) => ({ appId }))
    on(smtc.onCurrentSessionChanged, 'current-changed', (appId) => ({ appId }))
    on(smtc.onMediaPropertiesChanged, 'media-changed', (d) => ({
      appId: d.sourceAppId,
      mediaProps: d.mediaProps,
    }))
    on(smtc.onPlaybackInfoChanged, 'playback-changed', (d) => ({
      appId: d.sourceAppId,
      playbackInfo: d.playbackInfo,
    }))
    on(smtc.onTimelinePropertiesChanged, 'timeline-changed', (d) => ({
      appId: d.sourceAppId,
      timelineProps: d.timelineProps,
    }))

    // **콜백을 다 건 뒤에 initialize한다.** 순서를 뒤집으면 이벤트가 한 건도
    // 오지 않는다 — 애드온 래퍼(index.js)도 _bindEvents() 다음에
    // _initialize()를 부른다. 실제로 반대로 두고 한동안 못 알아챘다:
    // 카드는 1초마다 보간으로 그려지고 있어서 멀쩡해 보였고, 이력은 앱을
    // 재시작할 때마다 새 줄이 생겨 쌓이는 것처럼 보였다.
    smtc.initialize()

    send({ type: 'ready', sessions: addon.getSessions() })
  } catch (err) {
    fail('init', err)
  }
}

// 메인이 보내는 요청은 둘뿐이다 — 지금 상태를 다시 읽어 달라, 이 세션을 조작해 달라.
parentPort?.on('message', (msg) => {
  if (!addon) {
    if (msg?.id != null) send({ type: 'result', id: msg.id, ok: false, error: 'addon-unavailable' })
    return
  }

  try {
    switch (msg.type) {
      case 'poll':
        send({ type: 'sessions', sessions: addon.getSessions() })
        break

      case 'cmd':
        send({ type: 'result', id: msg.id, ok: true, value: runCommand(msg) })
        break

      case 'stop':
        try {
          smtc?.destroy()
        } finally {
          parentPort.close()
        }
        break
    }
  } catch (err) {
    if (msg?.id != null) {
      send({ type: 'result', id: msg.id, ok: false, error: String(err?.message ?? err) })
    }
  }
})

function runCommand({ action, appId, sec }) {
  switch (action) {
    case 'play':
      return addon.tryPlay(appId)
    case 'pause':
      return addon.tryPause(appId)
    case 'next':
      return addon.trySkipNext(appId)
    case 'prev':
      return addon.trySkipPrevious(appId)
    case 'seek':
      return addon.tryChangePlaybackPosition(appId, Math.max(0, sec))
    case 'capabilities':
      return addon.getCapabilities(appId)
    case 'session':
      return addon.getSessionById(appId)
    default:
      throw new Error(`unknown action: ${action}`)
  }
}
