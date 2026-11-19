/* WHENDESK 스킨·테마·앱 아이콘 목록 — 설정 화면(app.js)과 설정 저장(main/preferences.mjs)의 단일 출처.
 * 스킨은 ZEN 하나, 테마는 브랜드 FOG 하나다(0.3.35에서 다른 테마를 걷어냈다). 색은 renderer/themes.css, 모양은 renderer/brand.css.
 * colors는 [바탕, 글자, 신호색] (카드 견본) */
(() => {
  const SKINS = Object.freeze([
    { id: 'zen', name: 'ZEN', note: '선도 패널도 없이 여백과 글만' },
  ]);
  const THEMES = Object.freeze([
    // WHENDESK 시리즈 브랜드 "안개 + 라임"(whenwork docs/08_브랜드.md D-B01). 라임은 고른 것에만 쓴다. 기본 테마.
    // auto: Windows 밝기 설정을 따라 안개(라이트) ↔ 먹색(다크)으로 바뀐다(themes.css의 prefers-color-scheme). 저장되는 mode는 system.
    { id: 'zen-fog', skin: 'zen', name: 'FOG', note: '안개 + 라임, Windows 밝기를 따라 바뀌어요', colors: ['#e8ecf0', '#151a21', '#c6ee3a'], auto: true },
  ]);
  // 앱 아이콘: 시리즈 브랜드 아이콘 "한 줄"(먹색 틀 · 안개색 글 · 라임 커서) 하나. tools/make-icon.mjs가 assets/icon.png·assets/icons/를 굽는다.
  const APP_ICONS = Object.freeze([
    { id: 'brand', name: '한 줄', note: '먹색 틀에 안개색 글 한 줄과 라임 커서, WHENDESK 시리즈 아이콘' },
  ]);
  const themesOf = skin => THEMES.filter(theme => theme.skin === skin);
  const api = Object.freeze({ SKINS, THEMES, APP_ICONS, themesOf });
  if (typeof window !== 'undefined') window.WhendeskThemes = api;
  else globalThis.WhendeskThemes = api;
})();
