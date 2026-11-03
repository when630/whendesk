/* WHENDESK 스킨·테마·앱 아이콘 목록 — 설정 화면(app.js)과 설정 저장(main/preferences.mjs)의 단일 출처.
 * 스킨은 모양(선·모서리·글꼴·면, renderer/skins.css), 테마는 색(renderer/themes.css). 스킨마다 제 테마 목록이 있고 첫 테마가 그 스킨의 기본값.
 * 목록과 문구는 WHENTERMINAL(src/shared/keymap.ts SKINS·THEMES)과 같다. colors는 [바탕, 글자, 신호색] (카드 견본) */
(() => {
  const SKINS = Object.freeze([
    { id: 'zen', name: 'ZEN', note: '선도 패널도 없이 여백과 글만' },
    { id: 'poster', name: 'POSTER', note: '굵은 검은 선과 큰 글자, 스위스 포스터' },
    { id: 'soft', name: 'SOFT', note: '둥근 모서리와 옅은 그림자, 얇은 선' },
    { id: 'tui', name: 'TUI', note: '고정폭 글자와 제목이 박힌 상자, 터미널처럼' },
    { id: 'glass', name: 'GLASS', note: '흐린 바탕 위 반투명 유리 패널' },
    { id: 'ide', name: 'IDE', note: '편집기처럼 탭·탐색기 트리·아래 상태 표시줄' },
    { id: 'sketch', name: 'SKETCH', note: '캔버스 위 손그림과 떠 있는 도구 판' },
  ]);
  const THEMES = Object.freeze([
    { id: 'zen-sage', skin: 'zen', name: 'SAGE', note: '옅은 초록빛 회색, 차분함', colors: ['#e8ece4', '#273029', '#b6533c'] },
    { id: 'zen-paper', skin: 'zen', name: 'PAPER', note: '미색 종이', colors: ['#f7f4ee', '#2e2a25', '#c4553a'] },
    { id: 'zen-ink', skin: 'zen', name: 'INK', note: '먹빛 어두운 바탕', colors: ['#191a1c', '#d6d3cc', '#e07a5f'], dark: true },
    { id: 'zen-stone', skin: 'zen', name: 'STONE', note: '차가운 회색, 미색이 누렇게 느껴질 때', colors: ['#eeeff0', '#1f2326', '#b8432c'] },
    { id: 'zen-snow', skin: 'zen', name: 'SNOW', note: '거의 흰 바탕, 대비가 가장 커요', colors: ['#fbfbfa', '#111111', '#d0402a'] },
    { id: 'zen-kraft', skin: 'zen', name: 'KRAFT', note: '짙은 베이지, 종이 질감', colors: ['#e9e0d0', '#2b241b', '#b1442c'] },
    { id: 'zen-night', skin: 'zen', name: 'NIGHT', note: '푸른 먹색, 밤에 오래 볼 때', colors: ['#15181c', '#cdd3da', '#e8806a'], dark: true },
    { id: 'zen-moss', skin: 'zen', name: 'MOSS', note: '짙은 초록, SAGE의 어두운 짝', colors: ['#171c18', '#d3dccf', '#e07f62'], dark: true },
    { id: 'zen-dim', skin: 'zen', name: 'DIM', note: '대비를 낮춘 따뜻한 검정, 오래 봐도 눈이 편해요', colors: ['#1f1d1a', '#c4bba9', '#d98b6c'], dark: true },
    { id: 'poster-white', skin: 'poster', name: 'POSTER', note: '흰 종이와 검정, 대비가 가장 강함', colors: ['#ffffff', '#0a0a0a', '#ff2a12'] },
    { id: 'poster-paper', skin: 'poster', name: 'PAPER', note: '누런 미색과 먹색, 눈부심이 적음', colors: ['#f4efe6', '#2e2a25', '#c4553a'] },
    { id: 'poster-sage', skin: 'poster', name: 'SAGE', note: '옅은 초록빛 회색, 차분함', colors: ['#e8ece4', '#273029', '#b6533c'] },
    { id: 'poster-sumi', skin: 'poster', name: 'SUMI', note: '따뜻한 어두운 회색, 밤에 편함', colors: ['#1f1e1c', '#d8d2c6', '#e07a5f'], dark: true },
    { id: 'poster-night', skin: 'poster', name: 'NIGHT', note: '푸른 어두운 회색, 차가운 톤', colors: ['#1a1e24', '#c5cdd6', '#e5806b'], dark: true },
    { id: 'soft-light', skin: 'soft', name: 'LIGHT', note: '흰 카드와 옅은 회색 바탕', colors: ['#f4f4f6', '#1b1b1f', '#e5484d'] },
    { id: 'soft-sand', skin: 'soft', name: 'SAND', note: '따뜻한 미색, 눈부심이 적음', colors: ['#f3efe8', '#2b2722', '#d0583a'] },
    { id: 'soft-dark', skin: 'soft', name: 'DARK', note: '부드러운 어두운 회색', colors: ['#18181b', '#e8e8ea', '#ff6369'], dark: true },
    { id: 'tui-night', skin: 'tui', name: 'NIGHT', note: '푸른 어두운 터미널', colors: ['#14171c', '#c9d1d9', '#ff7b72'], dark: true },
    { id: 'tui-phosphor', skin: 'tui', name: 'PHOSPHOR', note: '검은 바탕에 초록 형광 글자', colors: ['#07120b', '#7ee69a', '#ff6a4d'], dark: true },
    { id: 'tui-amber', skin: 'tui', name: 'AMBER', note: '검은 바탕에 호박색 글자', colors: ['#120c04', '#f5b94a', '#ff5a3c'], dark: true },
    { id: 'tui-paper', skin: 'tui', name: 'PAPER', note: '밝은 종이 터미널', colors: ['#f5f2ea', '#222222', '#c4361c'] },
    { id: 'glass-day', skin: 'glass', name: 'DAY', note: '밝은 바탕에 흰 유리', colors: ['#eef0f4', '#111318', '#ff3b30'] },
    { id: 'glass-night', skin: 'glass', name: 'NIGHT', note: '어두운 바탕에 짙은 유리', colors: ['#0f1218', '#e6eaf0', '#ff6b5e'], dark: true },
    { id: 'glass-dusk', skin: 'glass', name: 'DUSK', note: '보랏빛 저녁 바탕', colors: ['#1b1626', '#ece6f5', '#ff7a6b'], dark: true },
    { id: 'ide-dark', skin: 'ide', name: 'DARK', note: '기본 어두운 편집기', colors: ['#1f1f1f', '#cccccc', '#f14c4c'], dark: true },
    { id: 'ide-light', skin: 'ide', name: 'LIGHT', note: '밝은 편집기', colors: ['#ffffff', '#3b3b3b', '#c72e0f'] },
    { id: 'ide-midnight', skin: 'ide', name: 'MIDNIGHT', note: '푸른 검정, 밤에 오래 볼 때', colors: ['#0d1117', '#c9d1d9', '#f85149'], dark: true },
    { id: 'ide-solar', skin: 'ide', name: 'SOLAR', note: '따뜻한 미색, 눈부심이 적어요', colors: ['#fdf6e3', '#44525a', '#c4361c'] },
    { id: 'ide-hc', skin: 'ide', name: 'HIGH CONTRAST', note: '검정 바탕에 밝은 테두리, 대비가 가장 커요', colors: ['#000000', '#ffffff', '#ff5c5c'], dark: true },
    { id: 'sketch-paper', skin: 'sketch', name: 'PAPER', note: '흰 모눈 캔버스, 보라 강조', colors: ['#ffffff', '#1e1e1e', '#e03131'] },
    { id: 'sketch-board', skin: 'sketch', name: 'BOARD', note: '어두운 캔버스, 밤에 편해요', colors: ['#121214', '#e3e3e8', '#ff8787'], dark: true },
    { id: 'sketch-blueprint', skin: 'sketch', name: 'BLUEPRINT', note: '청사진 위 노란 연필', colors: ['#1d4f8f', '#eaf2ff', '#ff8a80'], dark: true },
    { id: 'sketch-kraft', skin: 'sketch', name: 'KRAFT', note: '갈색 크라프트지에 초록 펜', colors: ['#d6bf99', '#2b2117', '#c92a2a'] },
    { id: 'sketch-legal', skin: 'sketch', name: 'LEGAL', note: '줄 친 노란 패드에 파란 펜', colors: ['#fff6b8', '#1e1e1e', '#e03131'] },
  ]);
  // 앱 아이콘: assets/icons/<id>.png (원본 build/icons/<id>.svg, tools/render-icons.cjs로 렌더링). 설치 파일 아이콘(assets/icon.png)은 첫 값 brand로 고정
  const APP_ICONS = Object.freeze([
    { id: 'brand', name: 'w.', note: '앱 안 로고와 같은 모양, 작은 크기에서 가장 또렷함' },
    { id: 'wordmark', name: 'WD_', note: 'WHENTERMINAL WT_의 짝, 빨간 밑줄은 커서' },
    { id: 'command', name: 'COMMAND', note: '검색 막대와 빨간 커서' },
    { id: 'desk', name: 'DESK', note: '사이드바·본문·캘린더 3단, 오늘은 빨간 칸' },
    { id: 'check', name: 'CHECK', note: '키캡처럼 들뜬 칸에 빨간 체크' },
    { id: 'list', name: 'LIST', note: '첫 칸만 빨갛게 채운 할 일 목록' },
  ]);
  const themesOf = skin => THEMES.filter(theme => theme.skin === skin);
  const api = Object.freeze({ SKINS, THEMES, APP_ICONS, themesOf });
  if (typeof window !== 'undefined') window.WhendeskThemes = api;
  else globalThis.WhendeskThemes = api;
})();
