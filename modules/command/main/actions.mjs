// main/actions.mjs — 항목마다 할 수 있는 동작 목록(PANEL-12, D-34). Electron에 기대지 않는 순수 모듈이라 node --test로 검증한다.
//
//   actionsFor(item)  [{ id, title, action }] — 첫째가 Enter의 본 동작. Ctrl·⌘+K가 전부를 보인다
//   altAction(item)   ⌘·Ctrl+Enter의 보조 동작 — 파일·앱은 '폴더에서 보기', 스크립트는 '스크립트 열기'. 없으면 null(본 동작과 같다)
//
// 동작은 항목의 action과 같은 모양({ type, ... })이라 ipc.mjs runAction이 그대로 실행한다. 새 동작은 여기 한 줄이다.

const ALT = { files: 'reveal', apps: 'reveal', scripts: 'edit' };

export function actionsFor(item) {
  const a = item?.action ?? {};
  const list = [];
  const push = (id, title, action) => list.push({ id, title, action });
  if (a.type === 'capture-task' || a.type === 'capture-event') {
    push('add', a.type === 'capture-task' ? '인박스에 담기' : '일정 추가', a);
    push('add-open', a.type === 'capture-task' ? '담고 열기' : '추가하고 캘린더에서 보기', { ...a, open: true });
    return list;
  }
  // WHENDESK 안의 할 일·메모·일정 결과는 화면을 열지 않고 바로 다룰 수 있다.
  if (a.type === 'route' && a.route?.id != null && ['tasks', 'notes', 'calendar'].includes(a.route.view)) {
    const id = a.route.id;
    push('open', '열기', a);
    if (a.route.view === 'tasks') {
      push('complete', item.done ? '완료 해제' : '완료', { type: 'task-complete', id, done: !item.done });
      if (!item.done) {
        push('due-today', '오늘 마감', { type: 'task-due', id, days: 0 });
        push('due-tomorrow', '내일 마감', { type: 'task-due', id, days: 1 });
      }
      push('delete', '삭제', { type: 'task-delete', id });
    } else if (a.route.view === 'notes') push('edit', '편집으로 열기', { type: 'route', route: { ...a.route, edit: true } });
    else if (!item.recurring) push('delete', '삭제', { type: 'event-delete', id });
    return list;
  }
  switch (item?.source) {
    case 'apps':
      push('open', '열기', a);
      // UWP(shell:AppsFolder)는 파일이 아니다 — 위치도 경로도 없다
      if (a.path && !/^shell:/i.test(a.path)) {
        push('reveal', '파일 위치 열기', { type: 'reveal', path: a.path });
        push('copy-path', '경로 복사', { type: 'copy', text: a.path });
      }
      break;
    case 'files':
      push('open', item.kind === 'dir' ? '폴더 열기' : '열기', a);
      push('reveal', '폴더에서 보기', { type: 'reveal', path: a.path });
      push('copy-path', '경로 복사', { type: 'copy', text: a.path });
      break;
    case 'scripts':
      push('run', '실행', a);
      push('edit', '스크립트 열기', { type: 'open-path', path: a.path });
      push('reveal', '폴더에서 보기', { type: 'reveal', path: a.path });
      break;
    case 'siblings':
      push('run', '실행', a);
      if (a.url) push('copy-url', '딥링크 복사', { type: 'copy', text: a.url });
      break;
    case 'calc':
      push('copy', '복사', a);
      break;
    default:
      push('run', '실행', a);
  }
  return list;
}

export function altAction(item) {
  const id = ALT[item?.source];
  return id ? actionsFor(item).find((x) => x.id === id)?.action ?? null : null;
}
