// 원본 WHENCOMMAND main/clip.mjs 그대로.
// main/clip.mjs — 클립보드 즉시 동작(PANEL-13, D-37)의 순수 부분. 입력줄이 뜨는 순간 클립보드를 **한 번** 읽어 무엇인지 가른다.
// 감시도 저장도 없다 — 히스토리(01 제외 항목)가 아니다. Electron·fs에 기대지 않아 node --test로 검증한다(경로 존재 확인은 넘겨받는다).
//
//   classifyClipboard(text, exists)  { kind: 'url' | 'path' | 'text', value } | null — 비었거나 너무 길면 null
//   brief(text, n)                   부제에 넣을 한 줄 요약

export const MAX_TEXT = 500; // 이보다 길면 문서다 — 입력줄이 다룰 글이 아니다

export function classifyClipboard(raw, exists = () => false) {
  const t = String(raw ?? '').replace(/\r/g, '').trim();
  if (!t || t.length > MAX_TEXT) return null;
  const oneLine = !t.includes('\n');
  if (oneLine && /^https?:\/\/\S+$/i.test(t)) return { kind: 'url', value: t };
  if (oneLine && /^([A-Za-z]:[\\/]|\\\\|\/|~\/)/.test(t) && safe(exists, t)) return { kind: 'path', value: t };
  return { kind: 'text', value: t.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ') };
}

function safe(fn, p) {
  try { return !!fn(p); } catch { return false; }
}

export function brief(text, n = 60) {
  const s = String(text ?? '').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
