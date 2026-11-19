/* WHENDESK 스킨·테마·앱 아이콘 목록 — 설정 화면(app.js)과 설정 저장(main/preferences.mjs)의 단일 출처.
 * 스킨은 ZEN 하나다(0.3.34에서 POSTER·SOFT·TUI·GLASS·IDE·SKETCH를 걷어냈다). 테마는 색(renderer/themes.css)이고 첫 테마가 기본값.
 * colors는 [바탕, 글자, 신호색] (카드 견본) */
(() => {
  const SKINS = Object.freeze([
    { id: 'zen', name: 'ZEN', note: '선도 패널도 없이 여백과 글만' },
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
