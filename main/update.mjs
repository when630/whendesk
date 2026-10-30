/* GitHub Releases(when630/whendesk)를 보고 새 버전을 받아 둔다. 원본 WHENMUSIC main/update.mjs에서 승계했다.
 * 사용자가 모르는 채로 바뀌지 않는다: 내려받은 뒤 바로 재시작하지 않고 다음에 앱을 끌 때 설치한다(autoInstallOnAppQuit).
 * 설정 화면의 "재시작해 설치"만 지금 갈아끼운다. 설치본(NSIS)에서만 동작하고, 개발 실행·테스트에서는 네트워크를 쓰지 않는다. */
import { app, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { friendlyUpdateError } from './update-text.mjs';

// electron-updater는 CommonJS다 — ESM에서는 기본 내보내기에서 꺼낸다.
const { autoUpdater } = electronUpdater;

const RELEASES_URL = 'https://github.com/when630/whendesk/releases/latest';
// 켜자마자 확인하지 않는다 — 부팅이 무거워진다.
const FIRST_CHECK_MS = 60_000;
// 하루 한 번. 트레이 앱은 몇 주씩 떠 있어 주기 확인이 곧 유일한 확인 기회다.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function setupUpdater({ state, onChange, enabled }) {
  const unsupported = { check:async () => state, install:() => ({ installing:false }), openReleases:() => shell.openExternal(RELEASES_URL), stop:() => {}, supported:false };
  if (!enabled || !app.isPackaged) { state.status = 'unsupported'; return unsupported; }
  const change = () => onChange?.(state);
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => { state.status = 'checking'; change(); });
  autoUpdater.on('update-available', info => { state.status = 'available'; state.version = info?.version ?? null; change(); });
  autoUpdater.on('update-not-available', () => { state.status = 'idle'; state.checkedAt = Date.now(); change(); });
  autoUpdater.on('download-progress', progress => { state.status = 'downloading'; state.percent = Math.round(progress?.percent ?? 0); change(); });
  autoUpdater.on('update-downloaded', info => { state.status = 'ready'; state.version = info?.version ?? state.version; state.checkedAt = Date.now(); change(); });
  autoUpdater.on('error', error => { state.status = 'error'; state.error = friendlyUpdateError(error); state.checkedAt = Date.now(); change(); });
  async function check() {
    try { await autoUpdater.checkForUpdates(); }
    catch (error) { state.status = 'error'; state.error = friendlyUpdateError(error); change(); }
    return state;
  }
  // 내려받아 둔 것이 있을 때만 재시작하며 갈아끼운다. 평소 경로(끌 때 설치)를 대신하지 않는다.
  function install(beforeQuit) {
    if (state.status !== 'ready') return { installing:false };
    setImmediate(async () => { await beforeQuit?.(); autoUpdater.quitAndInstall(); });
    return { installing:true };
  }
  const first = setTimeout(check, FIRST_CHECK_MS);
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  return { check, install, supported:true, openReleases:() => shell.openExternal(RELEASES_URL), stop() { clearTimeout(first); clearInterval(timer); } };
}
