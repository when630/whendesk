// main/platform/win32-logo.mjs — UWP 앱 로고의 변형 고르기(D-42). 순수 모듈 — node --test로 검증한다(win32.mjs는 electron을 import해서 못 한다).
//
// 매니페스트의 `Square44x44Logo="Assets\CalculatorAppList.png"`는 실제 파일이 아니라 **자원 이름**이다. 디스크에는 한정자가 붙은 변형만 있다:
// `CalculatorAppList.targetsize-32_altform-unplated.png`·`.scale-200.png`·`.targetsize-16_altform-lightunplated_contrast-black.png`…
// (한정자 순서는 앱마다 다르다 — Power Automate는 `altform-lightunplated_targetsize-16`). 32px 상자에 그리니 32 이상에서 가장 작은 것을,
// 그리고 시작 메뉴처럼 판(plate) 없는 변형을 테마에 맞춰 고른다. 고대비(contrast-*)는 버린다.

const parse = (rest) => {
  const q = { size: null, altform: '', theme: '', contrast: false };
  for (const tok of rest.split('_')) {
    let m;
    if ((m = /^targetsize-(\d+)$/i.exec(tok))) q.size = Number(m[1]);
    else if ((m = /^scale-(\d+)$/i.exec(tok))) q.size ??= Math.round((44 * Number(m[1])) / 100); // 44px 논리 크기의 배율 — targetsize가 있으면 그쪽이 정확하다
    else if ((m = /^altform-(.+)$/i.exec(tok))) q.altform = m[1].toLowerCase();
    else if ((m = /^theme-(.+)$/i.exec(tok))) q.theme = m[1].toLowerCase();
    else if (/^contrast-/i.test(tok)) q.contrast = true;
  }
  return q;
};

// base: 매니페스트가 가리킨 파일 이름(예 'CalculatorAppList.png'), files: 같은 폴더의 파일 이름들. 고른 파일 이름 또는 null
export function pickLogo(base, files, { dark = true, want = 32 } = {}) {
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
  const ext = (dot > 0 ? base.slice(dot) : '').toLowerCase();
  const plate = dark ? ['unplated', '', 'lightunplated'] : ['lightunplated', '', 'unplated'];
  let best = null;
  for (const f of files) {
    const lf = f.toLowerCase();
    if (!lf.endsWith(ext)) continue;
    const mid = lf.slice(0, lf.length - ext.length);
    let q;
    if (mid === stem) q = { size: 44, altform: '', theme: '', contrast: false };
    else if (mid.startsWith(stem + '.')) q = parse(mid.slice(stem.length + 1));
    else continue;
    if (q.contrast) continue;
    if (q.theme && q.theme !== (dark ? 'dark' : 'light')) continue;
    const pr = plate.indexOf(q.altform);
    const rank = pr < 0 ? 1.5 : pr; // colorful 같은 모르는 altform은 판 있는 것과 없는 것 사이
    const size = q.size ?? 44;
    const fit = size >= want ? size - want : 1000 + (want - size); // 작은 것을 키우면 흐려진다 — 큰 것을 줄이는 쪽이 낫다
    const score = (size < want ? 1e6 : 0) + rank * 10000 + fit; // 크기 미달이 판 종류보다 먼저 — 16px unplated보다 32px 판 있는 쪽
    if (!best || score < best.score) best = { f, score };
  }
  return best?.f ?? null;
}
