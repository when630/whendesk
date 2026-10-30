// main/rank.mjs — frecency(D-10). Electron에 기대지 않는 순수 모듈이라 node --test로 검증한다.
//
// 매칭 점수만으로 정렬하면 이름이 짧은 것이 항상 이긴다. 실제로 원하는 것은 **내가 자주 고른 것**이다.
//   final = base × (1 + log1p(hits) × recency)
// 곱셈이라 매칭 0이면 아무리 자주 골랐어도 0이고, log1p라 100번 고른 것이 10번 고른 것을 10배로 누르지 않는다 —
// 새로 설치한 앱이 영영 못 올라오는 일을 막는다.

// 최근성 계수 — 버킷으로 끊는다. 연속 함수보다 예측 가능하고 테스트하기 쉽다.
export function recency(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0.4;
  if (ageMs < 3_600_000) return 4; // 1시간 내
  if (ageMs < 86_400_000) return 2; // 하루 내
  if (ageMs < 604_800_000) return 1; // 일주일 내
  return 0.4;
}

// base: 0~1 매칭 점수. pick: { hits, lastAt } 또는 없음(한 번도 고른 적 없음).
export function score(base, pick, now = Date.now()) {
  if (!(base > 0)) return 0;
  if (!pick || !(pick.hits > 0)) return base;
  return base * (1 + Math.log1p(pick.hits) * recency(now - (pick.lastAt ?? 0)));
}

// 항목 배열에 점수를 붙여 내림차순으로. picks는 key → { hits, lastAt }. 동점이면 제목이 짧은 것, 그다음 제목 순.
export function rank(items, picks, now = Date.now()) {
  return items
    .map((it) => ({ ...it, final: score(it.base, picks.get?.(it.key) ?? picks[it.key], now) }))
    .filter((it) => it.final > 0)
    .sort((a, b) => b.final - a.final || a.title.length - b.title.length || a.title.localeCompare(b.title, 'ko'));
}
