// main/search.mjs — 매칭 점수. Electron에 기대지 않는 순수 모듈이라 node --test로 검증한다.
// toChoseong은 whennote/main/search.mjs에서 복사했다(D-14). 나머지는 이 앱의 것이다 — whennote는
// SQLite FTS에 보낼 조각을 만들지만 이 앱은 메모리 안의 항목 수백 개에 점수를 매긴다(03 §5).
//
// 세 경로를 전부 보고 가장 높은 점수를 쓴다(SRCH-01·02·03):
//   직접   "vsc"    → Visual Studio Code       (퍼지 서브시퀀스)
//   초성   "ㅋㄹ"   → 크롬                      (대상을 초성으로 바꿔 같은 퍼지)
//   자판   "초개ㅡㄷ" → chrome                  (한글 자판으로 친 영문을 되돌려 같은 퍼지)
// 점수는 0~1. 연속으로 맞은 구간과 단어 첫 글자에서 맞은 것에 가산점 — "sc"가 Sublime Code보다 VSCode에서 높아야 한다.

// 초성 19개 — 유니코드 완성형 한글의 초성 순서와 같다
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

// 완성형 한글 한 글자를 초성 한 글자로 바꾼다. 한글이 아닌 글자는 그대로 둔다.
// **UTF-16 단위로 1:1**이라 결과 문자열의 인덱스가 원문 인덱스와 같다 — 렌더러가 초성 검색
// 결과를 원문 위에 강조할 때 이 성질에 기댄다.
export function toChoseong(str) {
  const s = String(str ?? '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xac00 && code <= 0xd7a3) out += CHO[Math.floor((code - 0xac00) / 588)];
    else out += s[i];
  }
  return out;
}

export const isChoseongQuery = (q) => /^[ㄱ-ㅎ]+$/.test(q);
const hasHangul = (s) => /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(s);

// 두벌식 자판 — 자모 → QWERTY. 겹자모는 두 키로 풀고, 된소리는 Shift 키(대문자)다.
const KEY = {
  ㅂ: 'q', ㅈ: 'w', ㄷ: 'e', ㄱ: 'r', ㅅ: 't', ㅛ: 'y', ㅕ: 'u', ㅑ: 'i', ㅐ: 'o', ㅔ: 'p',
  ㅁ: 'a', ㄴ: 's', ㅇ: 'd', ㄹ: 'f', ㅎ: 'g', ㅗ: 'h', ㅓ: 'j', ㅏ: 'k', ㅣ: 'l',
  ㅋ: 'z', ㅌ: 'x', ㅊ: 'c', ㅍ: 'v', ㅠ: 'b', ㅜ: 'n', ㅡ: 'm',
  ㅃ: 'Q', ㅉ: 'W', ㄸ: 'E', ㄲ: 'R', ㅆ: 'T', ㅒ: 'O', ㅖ: 'P',
  ㅘ: 'hk', ㅙ: 'ho', ㅚ: 'hl', ㅝ: 'nj', ㅞ: 'np', ㅟ: 'nl', ㅢ: 'ml',
  ㄳ: 'rt', ㄵ: 'sw', ㄶ: 'sg', ㄺ: 'fr', ㄻ: 'fa', ㄼ: 'fq', ㄽ: 'ft', ㄾ: 'fx', ㄿ: 'fv', ㅀ: 'fg', ㅄ: 'qt',
};

// 한글 자판으로 친 영문을 되돌린다 — "초개ㅡㄷ" → "chrome". 자판 전환을 잊는 일이 잦기 때문이다(SRCH-03).
// 완성형은 초·중·종성으로 풀어 각각 키로 바꾼다. 한글이 아닌 글자는 그대로 둔다.
export function keyboardToLatin(str) {
  let out = '';
  for (const ch of String(str ?? '')) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const n = code - 0xac00;
      out += KEY[CHO[Math.floor(n / 588)]] + KEY[JUNG[Math.floor((n % 588) / 28)]] + (KEY[JONG[n % 28]] ?? '');
    } else out += KEY[ch] ?? ch;
  }
  return out;
}

// 단어 첫 글자인가 — 앞이 없거나, 구분자 뒤이거나, 소문자→대문자 경계(camelCase).
function isWordStart(t, i) {
  if (i === 0) return true;
  const p = t[i - 1];
  if (/[\s\-_./\\()[\]]/.test(p)) return true;
  return /[a-z]/.test(p) && /[A-Z]/.test(t[i]);
}

// 퍼지 서브시퀀스. 질의의 각 글자를 대상에서 차례로 찾되, 후보가 여럿이면 **단어 첫 글자를 우선**한다 —
// "vsc"는 Visual의 v, Studio의 S, Code의 C로 붙어야 한다(가장 가까운 s를 잡으면 Vi(s)ual이 되어 점수가 낮다).
// 다만 직전 글자 바로 다음이 같은 글자면 **연속을 우선**한다 — "chr"은 c·h·r이 붙어야 한다.
//
// 점수: 글자당 기본 1, 연속이거나 단어 첫 글자면 3(둘 다여도 3). 연속과 첫 글자를 같게 두는 이유는
// 런처에서 "chr"이 Cache Handler Runner의 머리글자 셋보다 Chrome의 연속 세 글자에 붙어야 하기 때문이다 —
// 연속을 낮게 두면 흩어진 머리글자가 항상 이긴다(처음 그렇게 됐다). 합성은
//   0.8 × (points / 3n)  +  0.05 × [맨 앞에서 시작]  +  0.15 × (n / len — 대상을 얼마나 덮었나)
//   → 정확히 같으면 딱 1이다. 보너스를 밖에 더하면 좋은 매칭이 전부 1로 눌려 길이 차이가 사라진다(처음 그랬다)
//   × 밀집도 (0.7 + 0.3×n/span) — 세 글자가 15칸에 흩어지면 24% 깎인다
//   × 길이 페널티 (1 − (len−n)/200), 최대 25% — 같은 두 글자면 짧은 이름이 원하는 것일 확률이 높다
export function fuzzy(query, target) {
  const q = String(query ?? '');
  const t = String(target ?? '');
  if (!q) return { score: 0, positions: [] };
  const ql = q.toLowerCase();
  const tl = t.toLowerCase();
  const positions = [];
  let from = 0;
  let points = 0;
  for (let k = 0; k < ql.length; k++) {
    const c = ql[k];
    let at = -1;
    let i = tl.indexOf(c, from);
    if (i < 0) return { score: 0, positions: [] };
    // 단어 첫 글자 후보를 앞에서부터 찾는다 — 없으면 가장 가까운 것
    let j = i;
    while (j >= 0) {
      if (isWordStart(t, j)) { at = j; break; }
      j = tl.indexOf(c, j + 1);
    }
    if (at < 0) at = i;
    // 직전 글자 바로 다음이 같은 글자라면 연속을 우선한다(단어 첫 글자보다) — "chr"은 c·h·r이 붙어 있어야 한다
    if (k > 0 && tl[from] === c) at = from;
    const bonus = (k > 0 && at === positions[k - 1] + 1) || isWordStart(t, at);
    points += bonus ? 3 : 1;
    positions.push(at);
    from = at + 1;
  }
  const n = ql.length;
  let score = 0.8 * (points / (3 * n)) + (positions[0] === 0 ? 0.05 : 0) + 0.15 * (n / t.length);
  const span = positions[n - 1] - positions[0] + 1;
  score *= 0.7 + 0.3 * (n / span);
  score *= 1 - Math.min(0.25, Math.max(0, t.length - n) / 200);
  return { score: Math.max(0, Math.min(1, score)), positions };
}

// 세 경로 중 최고 점수. 어느 경로로 맞았는지(`via`)와 강조할 위치를 함께 돌려준다.
export function match(query, target) {
  const q = String(query ?? '').trim();
  const t = String(target ?? '');
  if (!q || !t) return { score: 0, positions: [], via: null };
  let best = { ...fuzzy(q, t), via: 'direct' };
  if (isChoseongQuery(q)) {
    const r = fuzzy(q, toChoseong(t));
    if (r.score > best.score) best = { ...r, via: 'choseong' };
  }
  if (hasHangul(q) && !hasHangul(t)) {
    const r = fuzzy(keyboardToLatin(q), t);
    // 자판 교정은 우연히 맞을 수 있어 조금 깎는다 — 직접 맞은 것을 이기면 안 된다
    if (r.score * 0.9 > best.score) best = { ...r, score: r.score * 0.9, via: 'keyboard' };
  }
  return best;
}
