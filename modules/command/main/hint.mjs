// 원본 WHENCOMMAND main/hint.mjs 그대로.
// main/hint.mjs — 지름길 힌트(SRCH-11, D-36)의 순수 부분. 고른 항목을 **더 짧게** 부를 입력 후보를 만든다.
// 후보가 실제로 첫 줄에 오는지는 메인이 검색으로 확인한다(ipc.mjs hintShortcut) — 여기는 Electron·검색에 기대지 않아 node --test로 검증한다.
//
//   candidates(title, aliases)  짧은 것부터: 첫 글자 · 초성 · 앞 두 글자 · 초성 둘 · 낱말 첫 글자들 · 세 글자 …
//   saves(typed, c)             그 후보가 친 것보다 두 글자 이상 짧은가 — 한 글자 아끼는 힌트는 소음이다
import { toChoseong } from './search.mjs';

const MAX_LEN = 3; // 목표는 "두 글자로 첫 줄"이다 — 셋을 넘는 지름길은 지름길이 아니다

export function candidates(title, aliases = []) {
  const seen = new Set();
  const out = [];
  const add = (c) => {
    const v = String(c ?? '').trim().toLowerCase();
    if (!v || v.length > MAX_LEN || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  for (const raw of [title, ...(aliases ?? [])]) {
    const t = String(raw ?? '').trim();
    if (!t) continue;
    const compact = t.replace(/\s+/g, '');
    const cho = /[가-힣]/.test(compact) ? toChoseong(compact) : '';
    const initials = t.split(/\s+/).map((w) => w[0]).join('');
    for (let n = 1; n <= MAX_LEN; n++) {
      add(compact.slice(0, n));
      if (cho) add(cho.slice(0, n));
      if (initials.length >= n && initials.length > 1) add(initials.slice(0, n));
    }
  }
  return out.sort((a, b) => a.length - b.length);
}

export function saves(typed, c) {
  const t = String(typed ?? '').trim();
  return t.length - String(c ?? '').length >= 2;
}
