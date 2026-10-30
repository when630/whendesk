// main/sources/calc.mjs — 계산·단위 변환(CALC-01~04). Electron에 기대지 않는 순수 모듈.
//
// eval을 쓰지 않는다 — 입력줄은 무엇이든 받는 자리라, 토크나이저 + 셔닝야드로 사칙·괄호·거듭제곱·함수만 푼다.
// "수식인가"의 판정(CALC-04)이 계산 자체보다 중요하다: 검색어를 수식으로 오인하면 계산 결과 줄이 앱 검색을 밀어낸다.
// 그래서 **숫자 하나만 있는 입력은 수식이 아니고**, 연산자나 단위 패턴이 있어야 계산 결과를 낸다.

const FN = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log,
};
const CONST = { pi: Math.PI, e: Math.E };
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };

function tokenize(src) {
  const s = String(src).replace(/[,_](?=\d{3}\b)/g, '').replace(/[×x]/gi, '*').replace(/[÷]/g, '/').replace(/\s+/g, '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[\d.]/.test(c)) {
      const m = s.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/i);
      if (!m) return null;
      out.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
    } else if (/[a-z]/i.test(c)) {
      const m = s.slice(i).match(/^[a-z]+/i);
      const w = m[0].toLowerCase();
      if (w in FN) out.push({ t: 'fn', v: w });
      else if (w in CONST) out.push({ t: 'num', v: CONST[w] });
      else return null; // 모르는 낱말 — 수식이 아니다
      i += m[0].length;
    } else if (c in PREC) { out.push({ t: 'op', v: c }); i++; }
    else if (c === '(' || c === ')') { out.push({ t: c }); i++; }
    else return null;
  }
  return out;
}

// 셔닝야드 → RPN → 값. 단항 마이너스는 'neg'로 바꾼다.
function evaluate(tokens) {
  const out = [];
  const ops = [];
  let prev = null;
  for (const tk of tokens) {
    if (tk.t === 'num') out.push(tk);
    else if (tk.t === 'fn') ops.push(tk);
    else if (tk.t === 'op') {
      if (tk.v === '-' && (!prev || prev.t === 'op' || prev.t === '(')) { ops.push({ t: 'neg' }); prev = tk; continue; }
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.t === 'neg' || top.t === 'fn' || (top.t === 'op' && (PREC[top.v] > PREC[tk.v] || (PREC[top.v] === PREC[tk.v] && tk.v !== '^')))) out.push(ops.pop());
        else break;
      }
      ops.push(tk);
    } else if (tk.t === '(') ops.push(tk);
    else if (tk.t === ')') {
      while (ops.length && ops[ops.length - 1].t !== '(') out.push(ops.pop());
      if (!ops.length) return null;
      ops.pop();
      if (ops.length && ops[ops.length - 1].t === 'fn') out.push(ops.pop());
    }
    prev = tk;
  }
  while (ops.length) { const o = ops.pop(); if (o.t === '(') return null; out.push(o); }

  const st = [];
  for (const tk of out) {
    if (tk.t === 'num') st.push(tk.v);
    else if (tk.t === 'neg') { if (!st.length) return null; st.push(-st.pop()); }
    else if (tk.t === 'fn') { if (!st.length) return null; st.push(FN[tk.v](st.pop())); }
    else {
      if (st.length < 2) return null;
      const b = st.pop();
      const a = st.pop();
      st.push(tk.v === '+' ? a + b : tk.v === '-' ? a - b : tk.v === '*' ? a * b : tk.v === '/' ? a / b : tk.v === '%' ? a % b : a ** b);
    }
  }
  if (st.length !== 1 || !Number.isFinite(st[0])) return null;
  return st[0];
}

// 사람이 읽을 수. 소수는 유효숫자 10자리에서 끊고 뒤의 0을 지운다 — 0.1+0.2가 0.30000000000000004로 나오면 계산기가 아니다.
export function fmt(n) {
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  const s = parseFloat(n.toPrecision(10));
  return Math.abs(s) >= 1e15 ? s.toExponential(4) : s.toLocaleString('en-US', { maximumFractionDigits: 10 });
}

// 수식 판정 + 계산. 숫자 하나만 있는 입력(예: "2026")은 수식이 아니다 — 파일·앱 이름일 수 있다.
export function calc(input) {
  const src = String(input ?? '').trim();
  if (!src || !/\d/.test(src) || !/[+\-*/%^×÷x()]|\b(sqrt|abs|round|floor|ceil|sin|cos|tan|log|ln|pi)\b/i.test(src)) return null;
  const tokens = tokenize(src);
  if (!tokens || tokens.length < 2) return null;
  const value = evaluate(tokens);
  if (value === null) return null;
  return { kind: 'calc', value, display: fmt(value), expr: src };
}

// ── 단위 변환 (CALC-03) — 길이·무게·온도·데이터. "3.5kg to lb" · "100c in f" · "2 GB → MB"
const UNITS = {
  length: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, inch: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, mile: 1609.344 },
  weight: { mg: 0.001, g: 1, kg: 1000, t: 1e6, oz: 28.349523125, lb: 453.59237, lbs: 453.59237 },
  data: { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 },
};
const TEMP = { c: 'c', '°c': 'c', celsius: 'c', f: 'f', '°f': 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' };
const toC = { c: (v) => v, f: (v) => (v - 32) * 5 / 9, k: (v) => v - 273.15 };
const fromC = { c: (v) => v, f: (v) => v * 9 / 5 + 32, k: (v) => v + 273.15 };

export function convert(input) {
  const m = String(input ?? '').trim().match(/^(-?[\d.,]+)\s*([a-z°]+)\s*(?:to|in|→|->|=)\s*([a-z°]+)$/i);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(v)) return null;
  const a = m[2].toLowerCase();
  const b = m[3].toLowerCase();
  let value = null;
  if (a in TEMP && b in TEMP) value = fromC[TEMP[b]](toC[TEMP[a]](v));
  else {
    for (const table of Object.values(UNITS)) {
      if (a in table && b in table) { value = (v * table[a]) / table[b]; break; }
    }
  }
  if (value === null || !Number.isFinite(value)) return null;
  return { kind: 'convert', value, display: `${fmt(value)} ${m[3]}`, from: `${fmt(v)} ${m[2]}`, expr: input.trim() };
}

// 공급원 모양(03 §2). 즉시 답한다 — 느릴 것이 없다.
export default {
  id: 'calc',
  async ready() {},
  async query(q) {
    const r = convert(q) ?? calc(q);
    if (!r) return [];
    return [{
      key: `calc:${r.kind}`,
      source: 'calc',
      title: r.display,
      subtitle: r.kind === 'convert' ? r.from : r.expr,
      icon: 'calc',
      base: 1, // 수식이면 항상 첫 줄 — frecency를 타지 않는다(CALC-01)
      value: r.value,
      action: { type: 'copy', text: r.display },
    }];
  },
};
