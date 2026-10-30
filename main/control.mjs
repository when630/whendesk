// 제어 경계 (D-04). 애드온이 막히는 환경이 오면 갈아끼우는 자리가 여기다 —
// 미디어 키나 상주 PowerShell(D-18)로 내려가더라도 이 파일의 바깥은 그대로다.
//
// Worker는 여기서만 만든다. 애드온을 메인에서 직접 건드리면 프리징한다(D-16).
import { app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import fs from 'node:fs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ADDON_FILE = 'windows-smtc-monitor.win32-x64-msvc.node'

// 명령 응답이 이보다 늦으면 실패로 본다. 실측 제어 수락은 5ms 수준이라
// 2초는 "무언가 잘못됐다"는 뜻이지 느린 게 아니다.
const CMD_TIMEOUT_MS = 2000

function addonPath() {
  // 포장하면 asar 밖으로 빠진다 (package.json asarUnpack). asar 안의 .node는
  // 애초에 로드되지 않는다.
  if (app.isPackaged) {
    const unpackedApp = path.join(app.getAppPath(), 'vendor', ADDON_FILE)
    if (fs.existsSync(unpackedApp)) return unpackedApp
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', ADDON_FILE)
  }
  return path.join(HERE, '..', 'vendor', ADDON_FILE)
}

export function createControl({ onEvent, onReady, onFail }) {
  let worker = null
  let seq = 0
  let failure = null
  const pending = new Map()

  function settleAll(error) {
    for (const [, p] of pending) {
      clearTimeout(p.timer)
      p.reject(new Error(error))
    }
    pending.clear()
  }

  function markFailed(stage, message) {
    failure = { stage, message }
    settleAll(message)
    onFail?.(failure)
  }

  function handle(msg) {
    switch (msg.type) {
      case 'ready':
        failure = null
        onReady?.(msg.sessions ?? [])
        break

      case 'sessions':
        onEvent?.({ name: 'sessions', payload: { sessions: msg.sessions ?? [] } })
        break

      case 'event':
        onEvent?.(msg)
        break

      case 'result': {
        const p = pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.ok) p.resolve(msg.value)
        else p.reject(new Error(msg.error))
        break
      }

      case 'fatal':
        // 애드온을 못 열었다. 앱은 계속 돈다 — 이력 창은 열려야 한다 (PLAT-03).
        markFailed(msg.stage, msg.message)
        break
    }
  }

  function start() {
    if (worker) return

    try {
      worker = new Worker(new URL('./smtc-worker.mjs', import.meta.url), {
        workerData: { addonPath: addonPath() },
      })
    } catch (err) {
      markFailed('spawn', String(err?.message ?? err))
      return
    }

    worker.on('message', handle)
    worker.on('error', (err) => markFailed('worker', String(err?.message ?? err)))
    worker.on('exit', (code) => {
      worker = null
      if (code !== 0 && !failure) markFailed('exit', `worker exited with ${code}`)
    })
  }

  function request(type, body = {}) {
    if (!worker) return Promise.reject(new Error(failure?.message ?? 'not started'))

    const id = ++seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('timeout'))
      }, CMD_TIMEOUT_MS)

      pending.set(id, { resolve, reject, timer })
      worker.postMessage({ type, id, ...body })
    })
  }

  return {
    start,

    get failure() {
      return failure
    },

    /** 지금 세션 목록을 다시 읽어 달라고 청한다. 응답은 onEvent로 온다. */
    poll() {
      worker?.postMessage({ type: 'poll' })
    },

    // CTL-01 · CTL-02 — 전부 appId로 세션을 지목한다 (CTL-04).
    play: (appId) => request('cmd', { action: 'play', appId }),
    pause: (appId) => request('cmd', { action: 'pause', appId }),
    next: (appId) => request('cmd', { action: 'next', appId }),
    prev: (appId) => request('cmd', { action: 'prev', appId }),

    /** CTL-05 — 절대 위치로 이동. 초 단위다. */
    seek: (appId, sec) => request('cmd', { action: 'seek', appId, sec }),

    /** CTL-07 — 이 세션이 무엇을 받아 주는가. */
    capabilities: (appId) => request('cmd', { action: 'capabilities', appId }),

    /** 한 세션의 최신 스냅샷. 낡은 기준점을 새로 잡을 때 쓴다. */
    session: (appId) => request('cmd', { action: 'session', appId }),

    stop() {
      if (!worker) return
      worker.postMessage({ type: 'stop' })
      const w = worker
      worker = null
      setTimeout(() => w.terminate().catch(() => {}), 500)
    },
  }
}
