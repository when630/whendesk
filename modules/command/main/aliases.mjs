// main/aliases.mjs — 영문 앱의 한글 별칭(오픈이슈 #7, D-24). 순수 모듈 — node --test로 검증한다.
//
// 초성 검색은 한글 이름에만 걸린다. macOS·Windows 앱 이름은 거의 영문이라 `ㅋㄹ`로 Chrome을 못 찾았다.
// 그래서 **사람이 부르는 이름**을 표로 둔다 — 별칭 → 영문 이름 조각들. 앱 이름에 그 조각이 들어 있으면 그 별칭으로도 걸린다.
// 사용자가 `~/.whencommand/aliases.json`에 { "별칭": "이름 조각" | ["조각", …] }을 두면 표에 얹힌다(같은 별칭이면 사용자 것이 이긴다).
// 저장소에는 아무것도 더하지 않는다(D-02) — 표는 코드와 파일이고, 랭킹은 여전히 picks뿐이다.
import { match } from './search.mjs';

export const DEFAULT_ALIASES = {
  // 브라우저
  크롬: 'Google Chrome', 엣지: 'Microsoft Edge', 파이어폭스: 'Firefox', 사파리: 'Safari', 아크: 'Arc', 브레이브: 'Brave',
  // 개발
  브이에스코드: 'Visual Studio Code', 비주얼스튜디오코드: 'Visual Studio Code', 브스코드: 'Visual Studio Code',
  커서: 'Cursor', 터미널: ['Terminal', 'Windows Terminal', 'iTerm'], 파워쉘: 'PowerShell', 파워셸: 'PowerShell', 깃허브: 'GitHub Desktop',
  도커: 'Docker', 포스트맨: 'Postman', 인텔리제이: 'IntelliJ', 안드로이드스튜디오: 'Android Studio', 엑스코드: 'Xcode', 클로드: 'Claude',
  // 소통
  슬랙: 'Slack', 디스코드: 'Discord', 카톡: 'KakaoTalk', 카카오톡: 'KakaoTalk', 텔레그램: 'Telegram', 왓츠앱: 'WhatsApp',
  줌: 'Zoom', 팀즈: ['Microsoft Teams', 'Teams'], 아웃룩: 'Outlook', 지메일: 'Gmail',
  // 문서·생산성
  노션: 'Notion', 옵시디언: 'Obsidian', 피그마: 'Figma', 워드: ['Microsoft Word', 'Word'], 엑셀: ['Microsoft Excel', 'Excel'],
  파워포인트: ['Microsoft PowerPoint', 'PowerPoint'], 피피티: ['Microsoft PowerPoint', 'PowerPoint'], 원노트: 'OneNote',
  챗지피티: 'ChatGPT', 지피티: 'ChatGPT', 스포티파이: 'Spotify',
  // OS 기본
  메모장: 'Notepad', 계산기: 'Calculator', 탐색기: ['File Explorer', 'Explorer'], 파인더: 'Finder', 설정: ['Settings', 'System Settings'],
  그림판: 'Paint', 캡처: 'Snipping Tool', 작업관리자: 'Task Manager', 미리보기: 'Preview', 사진: 'Photos', 음악: 'Music', 메일: 'Mail',
  캘린더: 'Calendar', 시계: 'Clock', 지도: 'Maps', 앱스토어: 'App Store', 스토어: 'Microsoft Store',
};

// 사용자 파일을 읽어 표에 얹는다. 없거나 깨졌으면 기본 표만 — 별칭 파일이 검색을 막으면 안 된다.
export function loadUserAliases(text) {
  if (!text) return {};
  let raw;
  try { raw = JSON.parse(String(text).replace(/^﻿/, '')); } catch { return {}; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [alias, target] of Object.entries(raw)) {
    const a = String(alias).trim();
    const list = (Array.isArray(target) ? target : [target]).map((t) => String(t ?? '').trim()).filter(Boolean);
    if (a && list.length) out[a] = list;
  }
  return out;
}

export function mergeAliases(base = DEFAULT_ALIASES, user = {}) {
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = Array.isArray(v) ? v : [v];
  for (const [k, v] of Object.entries(user)) out[k] = Array.isArray(v) ? v : [v];
  return out;
}

// 이 앱 이름에 붙는 별칭들. 조각은 대소문자 무시 부분 일치 — "Google Chrome"에 'Chrome'이 들어 있으면 '크롬'이 붙는다.
export function aliasesFor(name, table) {
  const n = String(name ?? '').toLowerCase();
  if (!n) return [];
  const out = [];
  for (const [alias, targets] of Object.entries(table)) {
    if (targets.some((t) => n.includes(String(t).toLowerCase()))) out.push(alias);
  }
  return out;
}

// 이름과 별칭 중 최고 점수. 별칭으로 맞으면 via='alias'이고 어느 별칭인지(alias)를 함께 돌려준다 — 강조할 위치는 없다(제목에 없는 글자다).
// 별칭 매칭은 직접 매칭을 이기지 못하게 조금 깎는다.
export function matchWithAliases(query, name, aliases = []) {
  let best = match(query, name);
  for (const alias of aliases) {
    const r = match(query, alias);
    const score = r.score * 0.95;
    if (score > best.score) best = { score, positions: [], via: 'alias', alias };
  }
  return best;
}
