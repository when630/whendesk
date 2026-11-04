/* 래피드 로깅 접두 기호 — 빠른 담기(Ctrl+Alt+Space · Ctrl+Alt+M) 입력줄 맨 앞의 기호 하나로 받을 곳을 고른다.
 * 불릿 저널의 • 할 일 · ○ 일정 · – 메모를 키보드로 칠 수 있는 글자로 옮겼다. 한글 입력 상태에서 o는 ㅐ로 들어오므로 함께 받는다.
 * 기호 뒤에 빈칸이 있어야 접두로 본다 — "-3도", ".env"처럼 기호로 시작하는 글은 그대로 담긴다.
 * 일반 Command 검색에는 쓰지 않는다: 파일명·계산식이 같은 글자로 시작한다. */
(function () {
  const PREFIXES = Object.freeze([
    Object.freeze({ kind:'task', marks:Object.freeze(['.', '*', '•']) }),
    Object.freeze({ kind:'event', marks:Object.freeze(['o', 'O', 'ㅐ', '○', '@']) }),
    Object.freeze({ kind:'note', marks:Object.freeze(['-', '–', '—']) }),
  ]);
  function parse(value) {
    const text = String(value ?? '').replace(/^\s+/, '');
    for (const { kind, marks } of PREFIXES) {
      for (const mark of marks) {
        if (!text.startsWith(mark) || !/^\s/.test(text.slice(mark.length))) continue;
        const rest = text.slice(mark.length).trim();
        return rest ? { kind, text:rest } : null;
      }
    }
    return null;
  }
  const api = Object.freeze({ PREFIXES, parse });
  if (typeof window !== 'undefined') window.WhendeskRapid = api;
  else globalThis.WhendeskRapid = api;
})();
