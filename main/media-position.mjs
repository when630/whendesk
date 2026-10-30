/* 재생 위치 추정. 원본 WHENMUSIC(main/session.mjs)의 기준점 보간을 옮겼다.
 * SMTC의 timeline.position은 재생 중에 갱신되지 않는다(실측 8분까지 낡음). 그래서 위치는 "언제 읽은 값인가"와
 * 함께 들고 다니며, 재생 중이면 그 뒤로 흐른 시간을 더한다. 기준점은 timeline·playback 이벤트로 다시 잡는다.
 * 몇 초마다 다시 읽는 세션 목록의 위치는 낡았을 수 있으므로 처음 보는 세션에만 쓴다. */
export const PLAYING = 4;

export function createPositionTracker({ clock = Date.now } = {}) {
  const anchors = new Map(), durations = new Map();
  function positionOf(id) {
    const anchor = anchors.get(id); if (!anchor) return 0;
    const elapsed = anchor.status === PLAYING ? Math.max(0, clock() - anchor.atMs) / 1000 : 0;
    const position = anchor.posSec + elapsed, duration = durations.get(id);
    return duration > 0 ? Math.min(position, duration) : Math.max(0, position);
  }
  function reanchor(id, { posSec, status }) {
    const previous = anchors.get(id);
    anchors.set(id, { posSec:posSec ?? positionOf(id), status:status ?? previous?.status ?? 0, atMs:clock() });
  }
  return {
    /** 세션 목록을 반영한다. 새 세션만 그 위치로 기준을 잡고, 상태가 바뀐 세션은 추정 위치에서 다시 잡는다. */
    observe(sessions = []) {
      const seen = new Set();
      for (const info of sessions) {
        const id = info?.sourceAppId; if (!id) continue;
        seen.add(id);
        if (info.timeline?.duration > 0) durations.set(id, info.timeline.duration);
        const status = info.playback?.playbackStatus;
        if (!anchors.has(id)) anchors.set(id, { posSec:info.timeline?.position ?? 0, status:status ?? 0, atMs:clock() });
        else if (status != null && status !== anchors.get(id).status) reanchor(id, { status });
      }
      for (const id of [...anchors.keys()]) if (!seen.has(id)) { anchors.delete(id); durations.delete(id); }
    },
    /** 워커 이벤트: timeline-changed는 위치를, playback-changed는 재생 상태를 확정한다. */
    event({ name, payload } = {}) {
      const id = payload?.appId; if (!id) return;
      if (name === 'timeline-changed') {
        if (payload.timelineProps?.duration > 0) durations.set(id, payload.timelineProps.duration);
        reanchor(id, { posSec:payload.timelineProps?.position });
      } else if (name === 'playback-changed') reanchor(id, { status:payload.playbackInfo?.playbackStatus });
    },
    positionOf,
    /** delta초 옮길 절대 위치. SMTC는 상대 이동이 없다. 곡 끝을 넘기면 다음 곡으로 넘어가므로 1초 앞에 세운다. */
    target(id, delta) {
      const duration = durations.get(id);
      let target = Math.max(0, positionOf(id) + delta);
      if (duration > 0) target = Math.min(target, duration - 1);
      return target;
    },
    /** 시크 명령 직후, 이벤트가 오기 전에 위치를 먼저 맞춘다. */
    assumeSeek(id, posSec) { reanchor(id, { posSec }); },
  };
}
