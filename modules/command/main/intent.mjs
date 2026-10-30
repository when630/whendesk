// main/intent.mjs — 의도 라우팅(SRCH-10, D-35). 명령 이름 없이 문장만 쳐도 어느 형제 앱 명령이 받을 글인지 짚는다.
// "담주 화 3시 김부장 미팅" → 일정 추가. Electron·네트워크·저장 없는 순수 규칙이라 node --test로 검증한다.
//
//   detectIntents(q)                 [{ intent, weight, hits }] — 문턱(2) 이상만, 무게순
//   routeIntents(q, manifests)       [{ manifest, command, intent, weight }] — 의도를 받을 명령. 명령의 intents 선언이 우선, 없으면 알려진 앱 표
//
// 의도 어휘는 다섯이고 규약(when-protocol)의 `commands[].intents`가 같은 낱말을 쓴다: schedule · todo · note · person · music.
// 규칙은 한국어 어투 중심이다 — 이 앱의 사용자가 그렇게 친다. 영문은 최소한만.

export const INTENTS = ['schedule', 'todo', 'note', 'person', 'music'];
export const THRESHOLD = 2;

// 각 규칙: [정규식, 무게]. 문장 하나에서 같은 규칙은 한 번만 센다 — "3시 4시"라고 두 번 적어도 무게가 두 배가 되지는 않는다
const RULES = {
  schedule: [
    [/\d{1,2}\s*시(\s*\d{1,2}\s*분|\s*반)?/u, 3], // 3시 · 3시 반 · 15시 30분
    [/\b\d{1,2}:\d{2}\b/u, 3],
    [/\d{1,2}\s*월\s*\d{1,2}\s*일/u, 3],
    [/(오늘|내일|모레|담주|다음\s*주|이번\s*주|다다음\s*주|다음\s*달|이번\s*달|주말|월말|월초)/u, 2],
    [/(월|화|수|목|금|토|일)요일|(?<![가-힣])(월|화|수|목|금|토|일)(?=\s|$|\d)/u, 2], // 화요일 · "담주 화 3시"의 화
    [/(오전|오후|아침|저녁|점심|새벽|밤)/u, 1],
    [/(미팅|회의|약속|일정|면담|출장|예약|마감일)/u, 1],
    [/\b(tomorrow|today|next\s+week|mon|tue|wed|thu|fri|sat|sun|am|pm)\b/iu, 2],
  ],
  todo: [
    [/(해야|해야지|해야함|하기|까지|마감|처리|끝내|잊지|챙기|보내기|정리하기|확인하기|고치기|만들기)/u, 3], // "금요일까지 …" — 날짜(2)보다 무겁게, 할 일이 이긴다
    [/(할\s*일|투두|todo|to-do)/iu, 2],
    [/(제출|답장|결제|신청|구매|사기|사야)/u, 2], // "우유 사기"
    [/(리뷰|검토)/u, 1],
  ],
  note: [
    [/(메모|적어|기록|받아\s*적|남겨|아이디어|생각|느낌|인용|메모해|적자)/u, 2],
    [/(note|memo|idea)/iu, 2],
  ],
  person: [
    [/[가-힣]{1,3}\s*(님|씨|부장|과장|대리|팀장|이사|대표|사장|선배|후배|교수|박사|매니저|실장|차장|주임)(?![가-힣])/u, 2], // 김부장 · 홍길동 님
    [/(연락처|연락|전화|메일|이메일|명함|번호)/u, 1],
    [/(contact|email|phone)/iu, 1],
  ],
  music: [
    [/(노래|음악|들었|들은|듣던|곡|앨범|가수|플레이리스트)/u, 2],
    [/(song|music|track|album)/iu, 2],
  ],
};

// 알려진 형제 앱의 기본 매핑 — 매니페스트에 `intents`가 없을 때. 앱 id → 의도 → 명령 id
const KNOWN = {
  whencalendar: { schedule: 'add' },
  whenwork: { todo: 'add' },
  whennote: { note: 'capture' },
  whenmail: { person: 'search' },
  whenmusic: { music: 'history' },
};

export function detectIntents(q) {
  const s = String(q ?? '').trim();
  if (s.length < 2) return [];
  const out = [];
  for (const intent of INTENTS) {
    let weight = 0;
    const hits = [];
    for (const [re, w] of RULES[intent]) {
      const m = s.match(re);
      if (m) { weight += w; hits.push(m[0].trim()); }
    }
    if (weight >= THRESHOLD) out.push({ intent, weight, hits });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

// 명령이 어떤 의도를 받는가 — 선언(commands[].intents)이 있으면 그것만. 앱이 한 명령에라도 선언했으면 그 앱은 표를 안 쓴다(선언이 표를 대체한다)
const declares = (manifest) => (manifest.commands ?? []).some((c) => Array.isArray(c.intents) && c.intents.length);
function intentsOf(manifest, command) {
  if (Array.isArray(command.intents) && command.intents.length) return command.intents;
  if (declares(manifest)) return [];
  const known = KNOWN[manifest.id];
  if (!known) return [];
  return Object.entries(known).filter(([, cid]) => cid === command.id).map(([intent]) => intent);
}

export function routeIntents(q, manifests = []) {
  const found = detectIntents(q);
  if (!found.length) return [];
  const out = [];
  for (const { intent, weight } of found) {
    for (const m of manifests) {
      for (const c of m.commands ?? []) {
        if (!c.args?.[0]) continue; // 글을 받을 인자가 없는 명령은 의도를 받을 수 없다
        if (intentsOf(m, c).includes(intent)) out.push({ manifest: m, command: c, intent, weight });
      }
    }
  }
  return out;
}

// 이 의도를 받는 명령들 — 문장 판별 없이 의도가 이미 정해졌을 때(클립보드 글 → note, D-37)
export function commandsForIntent(intent, manifests = []) {
  const out = [];
  for (const m of manifests) for (const c of m.commands ?? []) {
    if (c.args?.[0] && intentsOf(m, c).includes(intent)) out.push({ manifest: m, command: c });
  }
  return out;
}

