// main/platform/darwin.mjs — macOS. whennote에서 복사해 이 앱의 실측(03 §11, 2026-09-19)으로 고쳤다.
//
// 형제 앱이 "실기기에서 검증되지 않았다"고 남긴 셋 중 둘은 이 앱에서 검증됐다:
//   ① globalShortcut.register()가 true면 실제로 눌린다 (⌘Space 16회·⌃⌥W 6회)           → 해소
//   ③ app.dock.hide()로 Dock 아이콘이 빠진다 (isVisible=false)                          → 해소
//   ② 미서명 앱의 setLoginItemSettings가 실제로 로그인 항목에 들어가는지 — 패키징본에서만 잴 수 있어
//      **아직 실기기에서 검증되지 않았다**. 검증되면 이 줄과 platform.test의 해당 항목을 함께 지운다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { app, nativeImage, shell } from 'electron';

// Info.plist는 대개 바이너리라 plutil로 JSON을 받는다. 실패하면 null — 이름은 파일명으로 폴백한다.
function readPlist(file) {
  return new Promise((resolve) => {
    execFile('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8', timeout: 3000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

export default {
  name: 'darwin',

  // 형제 앱은 두 OS에 같은 조합(Ctrl+Alt+글자)을 썼지만 이 앱만 OS 관례를 따른다(D-05) —
  // 시리즈에서 가장 자주 누르는 키라 손이 이미 가 있는 자리가 이익이 크다. 대가는 Spotlight 충돌 안내(PLAT-03).
  defaultHotkey: 'Command+Space',

  // macOS 자동 업데이트는 **코드 서명이 필수**다(electron-builder 공식 문서 명시).
  // Squirrel.Mac이 서명을 확인하고 거부하므로, 미서명 배포에서는 내려받아 설치하는
  // 경로 자체가 없다. 새 버전을 알려 주고 받는 곳으로 보내는 것까지가 할 수 있는 전부다.
  canAutoUpdate: false,

  hotkeyLabel: (accel) =>
    String(accel)
      .replace(/\bControl\b/g, '⌃')
      .replace(/\bAlt\b/g, '⌥')
      .replace(/\bCommand\b|\bCmd\b/g, '⌘')
      .replace(/\bShift\b/g, '⇧')
      .replace(/\+/g, ''),

  firstRunHint: (hotkeyLabel) => ({
    title: 'WHENCOMMAND가 메뉴바에 있습니다',
    body: `화면 위쪽 메뉴바 오른쪽에서 ⌘ 아이콘을 찾으세요. Dock에는 뜨지 않습니다. ${hotkeyLabel} 로 어디서든 부르세요.`,
  }),

  // ⌘Space를 Spotlight가 쥐고 있으면 **둘이 동시에 뜬다**(실측 #4) — 앱이 막을 수 없다.
  // 시스템 설정의 심볼릭 핫키 64번(Spotlight 검색)을 읽어 켜져 있을 때만 안내한다(PLAT-03).
  // 항목이 없으면 기본값(켜짐)이다. 읽기에 실패하면 모른다고 답한다 — 거짓으로 안심시키지 않는다.
  hotkeyConflict(accel) {
    if (accel !== 'Command+Space') return null;
    try {
      const out = execFileSync('defaults', ['read', 'com.apple.symbolichotkeys', 'AppleSymbolicHotKeys'], {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const m = out.match(/\b64\s*=\s*\{\s*enabled\s*=\s*(\d)/);
      const enabled = m ? m[1] === '1' : true;
      return enabled ? { app: 'Spotlight', howTo: '시스템 설정 › 키보드 › 키보드 단축키 › Spotlight 에서 "Spotlight 검색 보기"를 끄세요' } : null;
    } catch {
      return { app: '알 수 없음', howTo: '눌렀을 때 다른 것이 함께 뜨면 그쪽 단축키를 끄세요' };
    }
  },

  // 메뉴바 상주 — Dock 아이콘을 뺀다(PLAT-06). app.dock은 macOS에만 있고,
  // 패키징 여부와 무관하게 whenReady 전에 불러도 된다. 패키징본은 LSUIElement로도 막는다(package.json).
  prepareApp(app) {
    app.dock?.hide();
  },

  // 실측 #7: Dock을 숨긴 액세서리 앱은 win.focus()만으로 앞으로 나오지 않는다.
  // 사용자가 단축키로 부른 직후라면 app.focus({steal:true})가 활성화를 만든다(협력적 활성화 —
  // 프로그램이 스스로 띄우면 안 된다). 숨길 때 app.hide()를 함께 불러야 직전 앱으로 돌아간다.
  // `place`는 win32와 짝을 맞춘 자리 잡기 콜백(D-41) — macOS는 최소화를 거치지 않으므로 순서가 무관하다
  activate(win, place) {
    place?.();
    if (!win.isVisible()) win.show();
    app.focus({ steal: true });
    win.focus();
  },
  deactivate(win) {
    win.hide();
    app.hide();
  },

  // macOS 메뉴바는 다크/라이트에 따라 아이콘 색이 뒤집혀야 한다. Template 이미지로
  // 넘기면 OS가 알아서 칠한다 — 컬러 아이콘을 그대로 주면 다크 모드에서 뭉개진다.
  // tray-Template.png가 있으면 그것을, 없으면 tray.png를 Template으로 표시한다.
  trayImage(root) {
    const tpl = path.join(root, 'build', 'tray-Template.png');
    const p = fs.existsSync(tpl) ? tpl : path.join(root, 'build', 'tray.png');
    if (!fs.existsSync(p)) return nativeImage.createEmpty();
    const img = nativeImage.createFromBuffer(fs.readFileSync(p));
    img.setTemplateImage(true);
    return img;
  },

  // 설치된 앱 목록(LNCH-02). 실측 #10: 폴더 스캔은 1ms, 이름 읽기가 앱당 plutil 한 번(~4ms)이라 122개에 ~500ms —
  // 그래서 시작 시 한 번만 부르고 캐시한다(LNCH-05). 8개씩 병렬로 돌려 ~100ms로 줄인다.
  // 이름은 CFBundleDisplayName → CFBundleName → 파일명 순. 한국어 현지화 이름(ko.lproj/InfoPlist.strings)은 v1에서 읽지 않는다.
  async listApps() {
    const dirs = ['/Applications', '/System/Applications', '/System/Applications/Utilities', path.join(os.homedir(), 'Applications')];
    const bundles = [];
    for (const dir of dirs) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.name.endsWith('.app')) bundles.push(path.join(dir, e.name));
        else if (e.isDirectory() && dir === '/Applications') {
          // 한 단계 아래(예: /Applications/Utilities)까지만 — 더 내려가면 헬퍼 앱이 섞인다
          try { for (const f of fs.readdirSync(path.join(dir, e.name))) if (f.endsWith('.app')) bundles.push(path.join(dir, e.name, f)); } catch {}
        }
      }
    }
    const out = [];
    let i = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (i < bundles.length) {
        const p = bundles[i++];
        const info = await readPlist(path.join(p, 'Contents', 'Info.plist'));
        if (info?.LSUIElement === true || info?.LSUIElement === '1' || info?.LSBackgroundOnly) continue; // 에이전트·백그라운드 앱은 목록에서 뺀다
        out.push({ name: info?.CFBundleDisplayName || info?.CFBundleName || path.basename(p, '.app'), path: p, id: info?.CFBundleIdentifier ?? null });
      }
    }));
    return out;
  },

  // 앱 실행(LNCH-01). LaunchServices가 이미 떠 있는 앱은 새로 띄우지 않고 앞으로 가져온다.
  async openApp(p) {
    const err = await shell.openPath(p);
    return !err;
  },

  // 스크립트 실행기(EXT-03) — 확장자로 정한다. macOS는 .sh(sh)·.zsh(zsh)·.bash(bash), 확장자가 없으면 그 파일을 그대로 실행한다
  // (실행 권한이 없으면 spawn이 EACCES로 실패하고 그 사실이 stderr로 보인다). 모르는 확장자는 null.
  // args는 폴백(D-32)이 넘기는 입력 전체 — 스크립트의 $1로 간다
  scriptRunner(file, args = []) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.sh') return { cmd: '/bin/sh', args: [file, ...args] };
    if (ext === '.zsh') return { cmd: '/bin/zsh', args: [file, ...args] };
    if (ext === '.bash') return { cmd: '/bin/bash', args: [file, ...args] };
    if (ext === '') return { cmd: file, args: [...args] };
    return null;
  },

  // 시스템 명령(EXT-07, D-33) — osascript·pmset. win32와 같은 id 다섯. 종료·재시작은 넣지 않는다
  systemCommands() {
    const osa = (script) => ({ cmd: 'osascript', args: ['-e', script] });
    return [
      { id: 'lock', title: '화면 잠금', description: '지금 잠급니다 — ⌃⌘Q', icon: '⌁', exec: osa('tell application "System Events" to keystroke "q" using {command down, control down}') },
      { id: 'sleep', title: '절전', description: '잠자기', icon: '☾', exec: { cmd: 'pmset', args: ['sleepnow'] } },
      { id: 'empty-trash', title: '휴지통 비우기', description: '되돌릴 수 없습니다', icon: '♺', exec: osa('tell application "Finder" to empty trash') },
      { id: 'mute', title: '음소거 전환', description: '소리를 끄거나 켭니다', icon: '◌', exec: osa('set volume output muted not (output muted of (get volume settings))') },
      { id: 'dark-mode', title: '다크 모드 전환', description: '모양을 뒤집습니다', icon: '◐', exec: osa('tell application "System Events" to tell appearance preferences to set dark mode to not dark mode') },
    ];
  },

  // 파일 검색(FILE-01, D-09) — Spotlight 색인을 mdfind로 읽는다. 실측 #8: 한글 2글자 첫 결과 150~200ms, 결과 1만 개짜리는
  // -limit이 없어 첫 N줄만 읽고 죽인다. mdutil -s / 로 색인이 켜져 있는지 먼저 본다(FILE-05).
  // ⚠ 2026-09-21 기준 Windows에서만 실기기 확인 — mdfind 쪽은 poc/bench-mdfind.js의 실측만 있고 이 구현은 미검증이다.
  //   실측에서 `노트`가 0개였다 — 한글 NFC/NFD 정규화 문제일 수 있다(오픈이슈 #8).
  createFileSearch() {
    let status = { ok: false, reason: '파일 검색을 아직 시작하지 않았습니다' };
    return {
      async ready() {
        try {
          const out = execFileSync('mdutil', ['-s', '/'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
          status = /Indexing enabled/i.test(out)
            ? { ok: true }
            : { ok: false, reason: 'Spotlight 색인이 꺼져 있습니다 — 시스템 설정 › Siri 및 Spotlight에서 켜거나 `sudo mdutil -i on /`' };
        } catch {
          status = { ok: true }; // 상태를 못 읽으면 일단 시도한다 — 거짓으로 막지 않는다
        }
        return status;
      },
      status: () => status,
      query(q, limit = 30) {
        return new Promise((resolve) => {
          const out = [];
          let buf = '';
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            try { p.kill(); } catch {}
            resolve(out.map((f) => ({ name: path.basename(f), path: f, isDir: null })));
          };
          const p = spawn('mdfind', ['-name', String(q)], { stdio: ['ignore', 'pipe', 'ignore'] });
          p.stdout.setEncoding('utf8');
          p.stdout.on('data', (d) => {
            buf += d;
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const l of lines) if (l && out.length < limit) out.push(l);
            if (out.length >= limit) finish();
          });
          p.on('close', () => { if (buf && out.length < limit) out.push(buf); finish(); });
          p.on('error', finish);
        });
      },
      dispose() {},
    };
  },

  // 첫 실행 때 폴더와 함께 만드는 예제(EXT-06).
  exampleScript() {
    return {
      name: '내-ip.sh',
      content: [
        '#!/bin/sh',
        '# name: 내 IP',
        '# description: 이 Mac의 로컬 IP — 한 줄이라 자동으로 복사됩니다',
        '# icon: @',
        'ipconfig getifaddr en0 || ipconfig getifaddr en1',
        '',
      ].join('\n'),
    };
  },

  // 아이콘을 뽑을 경로(LNCH-04) — macOS는 .app 번들 경로 그대로 getFileIcon이 받는다
  resolveIconPath(p) {
    return p;
  },

  // 아이콘 출처(D-39) — macOS에는 바로가기의 IconLocation 같은 간접이 없다. 경로 그대로, 인덱스 0
  iconSource(p) {
    return { file: p, index: 0 };
  },

  // macOS는 getFileIcon이 .app 번들의 아이콘을 직접 읽어 기본 그림으로 떨어지지 않는다 — 폴백이 없다(win32의 exe·dll 리소스 추출에 대응)
  extractIcons() {
    return Promise.resolve({});
  },

  // 매니페스트의 verify 경로에 든 ~와 $VAR를 푼다(LINK-04)
  expandPath(p) {
    return String(p)
      .replace(/^~(?=\/|$)/, os.homedir())
      .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (whole, name) => process.env[name] ?? whole);
  },

  // 미서명 앱에서도 로그인 항목이 실제로 켜졌는지 **돌려받은 값으로 확인한다** —
  // setLoginItemSettings는 실패해도 던지지 않는다. 호출부는 이 false를 보고
  // 사용자에게 알린다(조용히 안 켜진 채로 두지 않는다).
  setLoginItem(app, openAtLogin) {
    app.setLoginItemSettings({ openAtLogin, args: [] });
    return app.getLoginItemSettings().openAtLogin === openAtLogin;
  },

  getLoginItem(app) {
    return app.getLoginItemSettings().openAtLogin;
  },
};
