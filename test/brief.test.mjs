import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDomain } from '../main/domain.mjs';
import { createPreferences } from '../main/preferences.mjs';
import { briefDecision, briefingLines, dayKey, STALE_WAITING_DAYS } from '../modules/work/main/brief.mjs';

function temporary(t, prefix) {
  const root = fileURLToPath(new URL('./.tmp/', import.meta.url));
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const at = (hour, minute = 0) => { const date = new Date(); date.setHours(hour, minute, 0, 0); return date; };

test('아침 브리핑은 하루 한 번, 설정 시각 뒤 3시간 안에만 알리고 놓친 날은 넘긴다', () => {
  assert.equal(briefDecision({ now:at(8, 59), at:'09:00' }), 'wait');
  assert.equal(briefDecision({ now:at(9, 30), at:'09:00' }), 'brief');
  assert.equal(briefDecision({ now:at(13, 0), at:'09:00' }), 'skip', '저녁에 켠 날 아침 브리핑이 튀어나오면 안 된다');
  assert.equal(briefDecision({ now:at(9, 30), at:'09:00', lastBriefing:dayKey(at(9, 30)) }), 'wait', '오늘 이미 알렸다');
  assert.equal(briefDecision({ now:at(9, 30), at:'09:00', enabled:false }), 'wait');
});

test('브리핑 문구는 WHENDESK 저장소의 지연·오늘 마감·인박스와 오늘 일정을 급한 순서로 말한다', async t => {
  // 저장소를 닫은 뒤에 임시 폴더를 지운다(열린 SQLite 파일은 지울 수 없다).
  const root = fileURLToPath(new URL('./.tmp/', import.meta.url));fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'whendesk-brief-'));
  const domain = createDomain({ dataDir:dir });
  t.after(() => { domain.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const late = await domain.mutate('task.create', { title:'지난 마감' });
  await domain.mutate('task.setDue', { id:late.id, text:'2020-01-02' });
  const today = await domain.mutate('task.create', { title:'오늘 마감' });
  await domain.mutate('task.setDue', { id:today.id, text:'오늘' });
  await domain.mutate('task.create', { title:'인박스에 남은 일' });
  const parts = briefingLines(domain.work.briefing(STALE_WAITING_DAYS), { events:[{ start:at(14, 0).toISOString() }] });
  assert.deepEqual(parts, ['지연 1건', '오늘 마감 1건', '일정 1건 (첫 일정 14:00)', '인박스 3건']);
});

test('시작·브리핑 설정은 형식이 맞는 값만 저장한다', t => {
  const file = path.join(temporary(t, 'whendesk-prefs-'), 'preferences.json');
  const prefs = createPreferences(file);
  assert.equal(prefs.get().briefEnabled, true);assert.equal(prefs.get().briefAt, '09:00');assert.equal(prefs.get().launchAtLogin, false);
  prefs.set({ briefAt:'7:30', briefEnabled:false, launchAtLogin:true, lastBriefing:'2026-10-30' });
  assert.deepEqual([prefs.get().briefAt, prefs.get().briefEnabled, prefs.get().launchAtLogin, prefs.get().lastBriefing], ['07:30', false, true, '2026-10-30']);
  prefs.set({ briefAt:'25:00', briefEnabled:'yes', lastBriefing:'어제' });
  assert.deepEqual([prefs.get().briefAt, prefs.get().briefEnabled, prefs.get().lastBriefing], ['07:30', false, '2026-10-30'], '잘못된 값은 무시한다');
  assert.equal(createPreferences(file).get().briefAt, '07:30', '재시작 뒤에도 유지');
});
