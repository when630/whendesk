import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createUpdateState, updateLine, friendlyUpdateError } from '../main/update-text.mjs';

test('업데이트 상태를 한 줄로 말한다', () => {
  const state = createUpdateState();
  assert.equal(updateLine(state, { current:'0.3.0' }), '버전 0.3.0 — 최신');
  assert.equal(updateLine({ ...state, status:'unsupported' }, { current:'0.3.0' }), '버전 0.3.0 — 업데이트 확인은 설치본에서만');
  assert.equal(updateLine({ ...state, status:'downloading', version:'0.3.1', percent:42 }), '새 버전 0.3.1 받는 중 42%');
  assert.equal(updateLine({ ...state, status:'ready', version:'0.3.1' }), '새 버전 0.3.1 — 앱을 끄면 설치됩니다');
});

test('업데이트 오류는 경로·URL 없이 사람 말로 바꾼다', () => {
  assert.equal(friendlyUpdateError(new Error('getaddrinfo ENOTFOUND github.com')), '네트워크에 연결하지 못했습니다');
  assert.equal(friendlyUpdateError(new Error('HttpError: 404 https://github.com/when630/whendesk/releases.atom')), '아직 공개된 릴리스가 없습니다');
  assert.equal(friendlyUpdateError(new Error('sha512 checksum mismatch C:\\Users\\x\\file.exe')), '내려받은 파일이 손상되어 설치하지 않았습니다');
  assert.doesNotMatch(friendlyUpdateError(new Error('C:\\secret\\path failed')), /secret/);
});

test('설치본 설정은 자동 업데이트가 읽는 GitHub 저장소와 앱 식별자를 가리킨다', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../tools/installer.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.publish, [{ provider:'github', owner:'when630', repo:'whendesk' }]);
  assert.equal(config.appId, 'com.when630.whendesk', 'main/index.mjs의 AppUserModelId와 같아야 알림·작업 표시줄이 이어진다');
  assert.equal(config.asar, false, 'SMTC 애드온·PowerShell 스크립트·Worker를 파일 경로로 읽으므로 묶지 않는다');
  assert.ok(config.files.includes('modules/**/*') && config.files.includes('vendor/**/*'));
});
