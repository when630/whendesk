// main/scripts.mjs — 스크립트 명령의 순수 부분(EXT). Electron·fs에 기대지 않아 node --test로 검증한다.
// 실제 폴더 스캔·실행은 sources/scripts.mjs가, OS별 실행기는 platform/이 맡는다.
//
//   parseHeader  상단 주석 → 이름·설명·아이콘(EXT-02)·폴백 여부(D-32). 선언이 없으면 파일명이 이름이다
//   route        출력 길이와 종료 코드 → 'toast' | 'panel'(D-17)
//   locate       stderr에서 스크립트의 줄 번호를 찾는다 — 실패 화면 마지막 줄 `경로:줄`(EXT-05)

const HEADER_KEYS = { name: 'name', 이름: 'name', description: 'description', desc: 'description', 설명: 'description', icon: 'icon', 아이콘: 'icon', fallback: 'fallback', 폴백: 'fallback' };
const YES = /^(yes|true|1|y|on|예|네|켬)$/i;
const COMMENT = /^\s*(?:#|\/\/|::|rem\b)\s?(.*)$/i;
export const TOAST_MAX_LINES = 3; // D-17 — 이 이하면 토스트, 넘으면 패널이 자란다

// 파일명 → 사람 이름. `내-ip.sh` → `내 ip`. 확장자를 떼고 -·_를 공백으로.
export function nameFromFile(filename) {
  return String(filename).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
}

// 맨 위 주석 덩어리만 읽는다 — 셔뱅은 건너뛰고, 주석이 아닌 첫 줄에서 멈춘다.
// `# name: 내 IP` 꼴. 키는 영·한 둘 다 받고, `:`·`=` 어느 쪽이든 된다.
export function parseHeader(text, filename = '') {
  const out = { name: nameFromFile(filename) || '스크립트', description: '', icon: '$', fallback: false };
  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length && i < 40; i++) {
    const line = lines[i];
    if (i === 0 && line.startsWith('#!')) continue;
    if (!line.trim()) continue;
    const m = line.match(COMMENT);
    if (!m) break;
    const kv = m[1].match(/^\s*([a-z가-힣]+)\s*[:=]\s*(.+?)\s*$/i);
    if (!kv) continue;
    const key = HEADER_KEYS[kv[1].toLowerCase()];
    if (!key) continue;
    if (key === 'icon') out.icon = [...kv[2]][0] ?? '$'; // 첫 글자 하나 — 이모지도 한 글자로 센다
    else if (key === 'fallback') out.fallback = YES.test(kv[2].trim()); // `# fallback: yes` — 결과가 없을 때 입력 전체를 첫 인자로 받는다(D-32)
    else out[key] = kv[2];
  }
  return out;
}

export function lineCount(s) {
  const t = String(s ?? '').trim();
  return t ? t.split(/\r?\n/).length : 0;
}

// D-17: stdout 3줄 이하 + exit 0 → 토스트. 그 밖(긴 출력·실패)은 같은 패널이 아래로 자란다.
export function route({ code, stdout }) {
  return code === 0 && lineCount(stdout) <= TOAST_MAX_LINES ? 'toast' : 'panel';
}

// stderr에서 줄 번호. sh는 `deploy.sh: line 14:`, PowerShell은 `deploy.ps1:14 char:3` 또는 `At ...ps1:14`. 못 찾으면 null.
export function locate(stderr, scriptPath = '') {
  const s = String(stderr ?? '');
  const base = scriptPath.split(/[\\/]/).pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = base
    ? [new RegExp(`${base}:\\s*line\\s+(\\d+)`, 'i'), new RegExp(`${base}:(\\d+)(?:\\s+char|\\s*$|\\s*\\n)`, 'im')]
    : [];
  patterns.push(/:\s*line\s+(\d+):/i, /\.(?:sh|ps1|cmd|bat):(\d+)\b/i);
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}
