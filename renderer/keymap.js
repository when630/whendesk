/* WHENDESK 키맵 — 앱 안 단축키의 단일 출처.
 * 키 처리(app.js·notes.js)는 키 이름 대신 동작 id로 판정하고, 단축키 안내(Ctrl+/)도 이 표에서 만든다.
 * 키 표기: 'Mod'는 Ctrl 또는 ⌘. 적은 수식키는 정확히 일치해야 하고, '?Shift'처럼 ?를 붙이면 눌려도 되고 안 눌려도 된다.
 * 키 이름은 event.code 또는 event.key와 비교하며, 'KeyX'는 같은 글자의 event.key도 받는다.
 * 예외: 단축키 설정 필드의 조합 기록(app.js recordShortcut)과 메모 본문의 목록 이어쓰기(notes.js editList)는 글자 입력 처리라 이 표를 쓰지 않는다. */
(function () {
  const A = (id, scope, label, keys, extra) => Object.freeze({ id, scope, label, keys:Object.freeze(keys), ...extra });
  const ACTIONS = Object.freeze([
    A('help.toggle','global','이 안내 열기 · 닫기',['Mod+Slash','Mod+/']),
    A('command.open','global','Command 열기',['Mod+KeyK']),
    A('nav.dashboard','global','Dashboard',['Alt+KeyH'],{section:'dashboard'}),
    A('nav.todo','global','Work · ToDo',['Alt+KeyT'],{section:'todo'}),
    A('nav.inbox','global','Work · InBox',['Alt+KeyI'],{section:'inbox'}),
    A('nav.waiting','global','Work · Waiting',['Alt+KeyW'],{section:'waiting'}),
    A('nav.done','global','Work · Done',['Alt+KeyD'],{section:'done'}),
    A('nav.notes','global','Note',['Alt+KeyN'],{section:'notes'}),
    A('nav.calendar','global','Calendar',['Alt+KeyC'],{section:'calendar'}),
    A('nav.settings','global','Settings',['Alt+KeyS'],{section:'settings'}),
    A('app.new','global','현재 화면에서 새 항목',['Mod+KeyN']),
    A('app.save','global','저장 · 대화상자 저장',['Mod+KeyS']),
    A('app.undo','global','되돌리기',['Mod+KeyZ']),
    A('back','global','닫기 · 뒤로',['?Mod+?Alt+?Shift+Escape']),
    A('focus.cycle','dialog','대화상자 안 이동',['?Mod+?Alt+?Shift+Tab']),

    A('command.expand','command','대시보드 펼치기',['Tab']),
    A('command.media','command','입력에서 미디어 버튼으로 이동',['Shift+Tab']),
    A('command.run','command','선택한 결과 실행',['?Shift+Enter']),
    A('command.alternate','command','보조 동작 실행',['Mod+Enter']),
    A('command.actions','command','동작 목록 열기 · 닫기',['Alt+Enter']),
    A('command.prev','command','이전 결과',['ArrowUp']),
    A('command.next','command','다음 결과',['ArrowDown']),

    A('capture.save','capture','담기',['Enter']),
    A('capture.saveOpen','capture','담고 열기',['Mod+Enter']),
    A('capture.open','capture','앱에서 열기',['Tab']),

    A('list.up','list','위 항목',['ArrowUp','KeyK']),
    A('list.down','list','아래 항목',['ArrowDown','KeyJ']),
    A('list.first','list','첫 항목',['Home']),
    A('list.last','list','마지막 항목',['End']),
    A('list.pageUp','list','10개 위',['PageUp']),
    A('list.pageDown','list','10개 아래',['PageDown']),

    A('work.search','work','검색',['Mod+KeyF','?Shift+/']),
    A('work.search.leave','worksearch','검색에서 목록으로',['?Shift+Enter','?Shift+ArrowDown','?Shift+ArrowUp']),
    A('work.quick.leave','workquick','입력에서 목록으로',['?Shift+ArrowDown']),
    A('work.tab.cycle','work','Work 분류 순환',['Tab','Shift+Tab']),
    A('work.tab.enter','worktab','탭에서 목록으로',['ArrowDown']),
    A('work.tab.prev','worktab','이전 분류',['ArrowLeft']),
    A('work.tab.next','worktab','다음 분류',['ArrowRight']),
    A('work.tab.first','worktab','첫 분류',['Home']),
    A('work.tab.last','worktab','마지막 분류',['End']),
    A('work.dueFilter','work','ToDo 마감 필터',['KeyF']),
    A('work.doneHistory','work','완료 기록',['KeyH']),
    A('work.undo','work','되돌리기',['KeyU']),
    A('project.new','work','프로젝트 추가',['Mod+Shift+KeyN']),

    A('task.open','task','편집',['Enter']),
    A('task.complete','task','완료',['Space']),
    A('task.collapse','task','상세 편집 접기',['Mod+Enter']),
    A('task.title','task','제목',['KeyE']),
    A('task.due','task','마감',['KeyD']),
    A('task.note','task','상세',['KeyN']),
    A('task.project','task','프로젝트',['KeyM']),
    A('task.waiting','task','대기 상대 지정',['KeyW']),
    A('task.nudge','task','재촉 기록',['KeyP','KeyR']),
    A('task.delete','task','삭제',['Delete','KeyX']),
    A('task.assign','task','프로젝트 바로 지정 (목록 순서)',['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9'],{display:'1 ~ 9'}),

    A('project.add','projects','프로젝트 추가',['KeyN']),
    A('project.rename','projects','이름 수정',['KeyE']),
    A('project.trash','projects','보관함 보기 전환',['KeyA']),
    A('project.archive','projects','프로젝트 보관',['KeyX','Delete']),
    A('project.open','projects','프로젝트 할 일 보기 · 보관함에서 복원',['Enter']),
    A('project.moveUp','projects','위로 옮기기',['Shift+ArrowUp','Shift+KeyK']),
    A('project.moveDown','projects','아래로 옮기기',['Shift+ArrowDown','Shift+KeyJ']),

    A('date.prev','calendar','하루 전',['ArrowLeft']),
    A('date.next','calendar','하루 뒤',['ArrowRight']),
    A('date.prevWeek','calendar','일주일 전',['ArrowUp']),
    A('date.nextWeek','calendar','일주일 뒤',['ArrowDown']),
    A('date.prevMonth','calendar','이전 달',['PageUp']),
    A('date.nextMonth','calendar','다음 달',['PageDown']),
    A('date.today','calendar','오늘',['KeyT']),
    A('date.open','calendar','날짜의 일정 목록',['Enter']),
    A('event.new','calendar','새 일정',['KeyN']),
    A('agenda.up','agenda','이전 일정',['ArrowUp','KeyK']),
    A('agenda.down','agenda','다음 일정',['ArrowDown','KeyJ']),
    A('agenda.prevDay','agenda','이전 날 · 이전 주',['ArrowLeft']),
    A('agenda.nextDay','agenda','다음 날 · 다음 주',['ArrowRight']),
    A('agenda.today','agenda','오늘',['KeyT']),
    A('agenda.new','agenda','새 일정',['KeyN']),
    A('calendar.view','calview','오늘 · 주 · 월 보기 순환',['Tab','Shift+Tab']),
    A('quickEvent.detail','dialog','한 줄 입력에서 자세히 편집',['Mod+Enter']),
    A('agenda.first','agenda','첫 일정',['Home']),
    A('agenda.last','agenda','마지막 일정',['End']),
    A('event.edit','agenda','일정 편집',['Enter','KeyE']),
    A('event.delete','agenda','선택 일정 삭제',['Delete','KeyX']),
    A('agenda.undo','agenda','되돌리기',['KeyU']),
    A('calendar.undo','calendar','되돌리기',['KeyU']),

    A('note.search','notes','메모 검색',['Mod+KeyF']),
    A('note.preview','notes','미리보기',['Mod+KeyE']),
    A('note.pin','notes','고정',['Mod+KeyP']),
    A('note.archive','notes','보관 · 해제',['Mod+Shift+KeyA']),
    A('note.attach','notes','이미지 첨부',['Mod+Shift+KeyI']),
    A('note.export','notes','Markdown 내보내기',['Mod+Shift+KeyE']),
    A('note.scope.active','notes','메모',['Mod+Shift+KeyM'],{scopeName:'active'}),
    A('note.scope.archived','notes','보관함',['Mod+Shift+KeyB'],{scopeName:'archived'}),
    A('note.scope.trash','notes','휴지통',['Mod+Shift+KeyT'],{scopeName:'trash'}),
    A('note.scope.cycle','notes','메모 · 보관함 · 휴지통 순환',['Tab','Shift+Tab']),
    A('note.restore','notes','복원',['Mod+Shift+KeyZ']),
    A('note.up','notes','이전 메모',['ArrowUp']),
    A('note.down','notes','다음 메모',['ArrowDown']),
    A('note.moveUp','notes','고정 메모 위로',['Shift+ArrowUp']),
    A('note.moveDown','notes','고정 메모 아래로',['Shift+ArrowDown']),
    A('note.first','notes','첫 메모',['?Shift+Home']),
    A('note.last','notes','마지막 메모',['?Shift+End']),
    A('note.open','notes','열기 (보기)',['?Mod+?Shift+Enter']),
    A('note.edit','notes','편집',['KeyE']),
    A('note.new','notes','새 메모',['KeyN']),
    A('note.find','notes','검색',['?Shift+/']),
    A('note.undo','notes','되돌리기',['KeyU']),
    A('note.cursorUp','notes','위 메모',['KeyK']),
    A('note.cursorDown','notes','아래 메모',['KeyJ']),
    A('note.delete','notes','목록에서 삭제',['?Mod+Delete','KeyX']),
    A('link.activate','link','링크 열기',['?Mod+?Alt+?Shift+Enter','?Mod+?Alt+?Shift+Space']),
  ]);

  /* 같은 묶음에서 같은 키를 쓰는 짝. 새로 생기면 여기 적고 이유를 남긴다. */
  const KNOWN_OVERLAPS = Object.freeze([]);
  /* 한 화면에서 동시에 키를 받는 범위 묶음. 묶음 안에서는 같은 키를 두 동작이 쓰면 안 된다. global은 모든 묶음과 함께 검사한다. */
  const CONCURRENT = Object.freeze([['command'],['capture'],['dialog'],['work','worksearch'],['work','workquick'],['work','worktab'],['work','list','task'],['work','list','projects'],['calendar','calview'],['agenda','calview'],['notes'],['link']]);

  const MODS = ['Mod','Alt','Shift'];
  function parse(spec) {
    const parts = spec.split('+'), key = parts.pop(), mods = {};
    // '+' 키 자체는 쓰지 않는다. 'Mod+/'처럼 마지막 조각이 키다.
    for (const name of MODS) mods[name] = false;
    for (const part of parts) {
      const optional = part.startsWith('?'), name = optional ? part.slice(1) : part;
      if (!MODS.includes(name)) throw new Error(`알 수 없는 수식키: ${spec}`);
      mods[name] = optional ? null : true;
    }
    if (!key) throw new Error(`키가 없는 조합: ${spec}`);
    return { mods, key };
  }
  const byId = new Map();
  for (const action of ACTIONS) {
    if (byId.has(action.id)) throw new Error(`중복된 동작 id: ${action.id}`);
    byId.set(action.id, { action, parsed:action.keys.map(parse) });
  }

  function keyMatches(event, key) {
    if (event.code === key || event.key === key) return true;
    const pressed = String(event.key || '').toLowerCase();
    if (/^Key[A-Z]$/.test(key)) return pressed === key.slice(3).toLowerCase();
    return key.length === 1 && pressed === key;
  }
  function specMatches(event, { mods, key }) {
    const pressed = { Mod:!!(event.ctrlKey || event.metaKey), Alt:!!event.altKey, Shift:!!event.shiftKey };
    for (const name of MODS) if (mods[name] !== null && mods[name] !== pressed[name]) return false;
    return keyMatches(event, key);
  }
  function entry(id) {
    const found = byId.get(id);
    if (!found) throw new Error(`키맵에 없는 동작: ${id}`);
    return found;
  }
  /* 이 키 입력이 동작 id의 조합 중 하나인가. */
  function is(event, id) { return entry(id).parsed.some(spec => specMatches(event, spec)); }
  /* 화면 이동(Alt+글자) 동작이면 대상 화면 이름. */
  function section(event) {
    for (const action of ACTIONS) if (action.section && is(event, action.id)) return action.section;
    return null;
  }
  function find(id) { return entry(id).action; }

  const KEY_NAMES = { ArrowUp:'↑', ArrowDown:'↓', ArrowLeft:'←', ArrowRight:'→', Escape:'Esc', Slash:'/', PageUp:'Page Up', PageDown:'Page Down' };
  function formatSpec({ mods, key }) {
    const names = MODS.filter(name => mods[name] === true).map(name => name === 'Mod' ? 'Ctrl' : name);
    const keyName = /^Key[A-Z]$/.test(key) ? key.slice(3) : /^Digit\d$/.test(key) ? key.slice(5) : KEY_NAMES[key] || (key.length === 1 ? key.toUpperCase() : key);
    return [...names, keyName].join(' + ');
  }
  /* 안내용 표기. 같은 표기로 보이는 대체 조합은 하나로 합친다. */
  function format(id) { const { action, parsed } = entry(id); return action.display || [...new Set(parsed.map(formatSpec))].join(' · '); }

  /* 단축키 안내(Ctrl+/)의 구성. 행은 [라벨, 동작 id 목록]이고 라벨을 생략하면 동작의 라벨을 쓴다. */
  const HELP = Object.freeze([
    { title:null, rows:[[null,['help.toggle']],[null,['command.open']]] },
    { title:'WHENCOMMAND', rows:[
      [null,['command.expand']],['검색 결과 선택',['command.prev','command.next']],[null,['command.run']],[null,['command.alternate']],
      [null,['command.actions']],['검색어 전체 선택',['command.open']],['입력 지우기 → 창 숨기기',['back']],['빠른 담기: 담기 · 담고 열기 · 앱에서 열기',['capture.save','capture.saveOpen','capture.open']],[null,['command.media'],{media:true}],
    ] },
    { title:'화면 이동', rows:[
      [null,['nav.dashboard']],['Work · ToDo / InBox',['nav.todo','nav.inbox']],['Work · Waiting / Done',['nav.waiting','nav.done']],
      ['Note / Calendar',['nav.notes','nav.calendar']],[null,['nav.settings']],[null,['app.new']],[null,['app.save']],
      ['화면 안 분류 순환 (Work · 메모)',['work.tab.cycle']],['한 단계 뒤로 (편집 → 필터 → 화면 → Command)',['back']],
    ] },
    { title:'할 일 목록', rows:[
      ['항목 선택',['list.up','list.down','list.first','list.last']],['검색 · 마감 필터 · 완료 기록',['work.search','work.dueFilter','work.doneHistory']],
      ['편집 · 완료',['task.open','task.complete']],[null,['task.assign']],['제목 · 마감 · 상세 · 프로젝트',['task.title','task.due','task.note','task.project']],
      ['대기 상대 지정 · 재촉 기록',['task.waiting','task.nudge']],['삭제 · 되돌리기',['task.delete','work.undo','app.undo']],
      [null,['task.collapse']],[null,['project.new']],
    ] },
    { title:'Projects', rows:[
      ['프로젝트 추가 · 이름 수정',['project.add','project.rename']],['프로젝트 순서',['project.moveUp','project.moveDown']],
      ['프로젝트 보관 · 보관함 보기',['project.archive','project.trash']],['보관된 프로젝트 복원',['project.open']],
    ] },
    { title:'메모', rows:[
      ['새 메모 · 검색 · 저장',['note.new','app.new','note.find','note.search','app.save']],['보기 · 편집 · 편집 전환',['note.open','note.edit','note.preview']],['목록 이동',['note.up','note.down','note.cursorUp','note.cursorDown']],['고정 · 보관',['note.pin','note.archive']],
      ['메모 · 보관함 · 휴지통',['note.scope.cycle','note.scope.active','note.scope.archived','note.scope.trash']],['목록에서 삭제 · 되돌리기 · 휴지통에서 복원',['note.delete','note.undo','note.restore']],
      ['이미지 첨부 · Markdown 내보내기',['note.attach','note.export']],
    ] },
    { title:'캘린더', rows:[
      ['날짜 이동 · 달 이동',['date.prev','date.prevWeek','date.nextWeek','date.next','date.prevMonth','date.nextMonth']],
      [null,['calendar.view']],['오늘 · 새 일정 (한 줄 입력)',['date.today','event.new','app.new']],[null,['quickEvent.detail']],['날짜의 일정 목록 · 편집',['date.open','event.edit']],['선택 일정 삭제 · 되돌리기',['event.delete','agenda.undo']],
    ] },
  ]);
  for (const group of HELP) for (const [, ids] of group.rows) ids.forEach(entry);

  /* 하단 상황 힌트(원본 WHENWORK): 지금 포커스 자리에서 쓰는 키 네 칸 남짓. 항목은 [동작 id, 짧은 라벨, 표기 대신 쓸 키].
   * Esc는 뜻이 달라지는 곳에서만 보인다. 전체 목록은 Ctrl+/ 안내에 있다. */
  const HINTS = Object.freeze({
    tasks:[['task.open','편집'],['task.complete','완료'],['task.assign','프로젝트'],['work.tab.cycle','분류','Tab']],
    taskEditor:[['focus.cycle','필드','Tab'],['task.collapse','접기'],['back','목록']],
    workSearch:[['work.search.leave','목록','Enter'],['back','검색 해제']],
    workQuick:[[null,'담기','Enter'],['back','목록']],
    projects:[['project.add','추가'],['project.rename','이름'],['project.moveUp','순서','Shift + ↑↓'],['project.trash','보관함']],
    notes:[['note.open','보기'],['note.edit','편집'],['note.new','새 메모'],['note.scope.cycle','분류','Tab']],
    noteSearch:[['note.open','열기','Enter'],['note.down','목록'],['back','검색 지우기']],
    noteEditor:[['note.preview','보기'],['app.save','저장'],['back','목록']],
    notePreview:[['note.edit','편집'],['back','목록']],
    calendarMonth:[['date.open','일정'],['event.new','새 일정'],['date.today','오늘'],['calendar.view','보기','Tab']],
    calendarList:[['agenda.new','새 일정'],['agenda.nextDay','이동','← →'],['agenda.today','오늘'],['calendar.view','보기','Tab']],
    event:[['event.edit','편집'],['event.delete','삭제'],['agenda.undo','되돌리기'],['calendar.view','보기','Tab']],
    dialog:[['app.save','저장'],['back','닫기']],
    quickEvent:[[null,'추가','Enter'],['quickEvent.detail','자세히'],['back','닫기']],
    home:[['command.open','Command'],['help.toggle','단축키 전체']],
  });
  for (const items of Object.values(HINTS)) for (const [id, , keys] of items) { if (id) entry(id); else if (!keys) throw new Error('힌트에 키가 없습니다.'); }
  /* 힌트 한 칸: { keys, label } */
  function hints(context) { return (HINTS[context] || []).map(([id, label, keys]) => ({ keys:keys || format(id), label })); }

  const api = Object.freeze({ ACTIONS, KNOWN_OVERLAPS, CONCURRENT, HELP, HINTS, hints, is, section, find, format, parse });
  if (typeof window !== 'undefined') window.WhendeskKeys = api;
  else globalThis.WhendeskKeys = api;
})();
