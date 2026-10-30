import test from 'node:test';
import assert from 'node:assert/strict';
import { createPositionTracker, PLAYING } from '../main/media-position.mjs';

const PAUSED = 5;
function fixture() {
  let now = 1_000_000;
  const tracker = createPositionTracker({ clock:() => now });
  return { tracker, advance:seconds => { now += seconds * 1000; } };
}
const session = (id, position, status, duration = 200) => ({ sourceAppId:id, timeline:{ position, duration }, playback:{ playbackStatus:status } });

test('재생 중에는 읽은 위치에 흐른 시간을 더하고, 멈추면 시간이 흐르지 않는다', () => {
  const { tracker, advance } = fixture();
  tracker.observe([session('app', 30, PLAYING)]);
  advance(12);
  assert.equal(tracker.positionOf('app'), 42);
  tracker.event({ name:'playback-changed', payload:{ appId:'app', playbackInfo:{ playbackStatus:PAUSED } } });
  advance(50);
  assert.equal(tracker.positionOf('app'), 42, '일시정지 뒤에는 위치가 그대로');
});

test('다시 읽은 세션 목록의 낡은 위치는 기준을 덮지 않고, timeline 이벤트만 위치를 확정한다', () => {
  const { tracker, advance } = fixture();
  tracker.observe([session('app', 10, PLAYING)]);
  advance(20);
  tracker.observe([session('app', 10, PLAYING)]);
  assert.equal(tracker.positionOf('app'), 30, '낡은 position=10으로 되돌아가면 안 된다');
  tracker.event({ name:'timeline-changed', payload:{ appId:'app', timelineProps:{ position:95, duration:200 } } });
  assert.equal(tracker.positionOf('app'), 95);
});

test('되감기·앞으로 목표는 0 아래로 내려가지 않고 곡 끝 1초 앞에서 멈춘다', () => {
  const { tracker } = fixture();
  tracker.observe([session('app', 4, PAUSED, 120)]);
  assert.equal(tracker.target('app', -10), 0);
  tracker.assumeSeek('app', 115);
  assert.equal(tracker.positionOf('app'), 115, '시크 직후 위치를 먼저 맞춘다');
  assert.equal(tracker.target('app', 10), 119);
  tracker.observe([]);
  assert.equal(tracker.positionOf('app'), 0, '사라진 세션은 잊는다');
});
