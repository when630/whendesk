/* WHENDESK renderer. 데이터와 OS 동작은 격리된 preload API로만 접근한다. */
(() => {
  'use strict';
  const root = document.getElementById('whendesk-command-first');
  const app = root.querySelector('.td-app');
  const body = root.querySelector('.td-body');
  const commandInput = root.querySelector('.td-command input');
  const commandBox = root.querySelector('.td-command-results');
  const commandActions = root.querySelector('.command-actions');
  const modalLayer = root.querySelector('.td-modal-layer');
  const helpLayer = root.querySelector('.minimal-help-layer');
  const api = window.desk;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const icon = name => `<i data-lucide="${/^[a-z0-9-]+$/.test(name || '') ? name : 'circle'}" aria-hidden="true"></i>`;
  const icons = () => window.lucide?.createIcons({ attrs: { width:17, height:17 } });
  const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const today = dateKey();
  const tomorrow = dateKey(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()+1));
  const state = { shell:'command', view:'dashboard', tab:'todo', selected:null, project:null, dueOnly:false, year:new Date().getFullYear(), month:new Date().getMonth(), date:today, skin:'base', mode:'system', tasks:[], projects:[], events:[], calendars:[], info:{}, prefs:{}, media:{ sessions:[] } };
  const command = { seq:0, items:[], selected:0, pending:false, query:'', renderedQuery:null, request:null, running:false, activating:false, activation:0, composing:false, actions:null, more:null, waiters:new Set(), notice:'', start:0, end:0, timer:null };
  const pending = new Map();
  const workRules = window.VIEW;
  const workUndo = [];
  const projectMoves = new Map();
  const workCursors = new Map();
  Object.assign(state,{ allTasks:[], archivedProjects:[], workQuery:'', workSort:'project', workRange:null, workTrash:false });
  let projectCursor = null;
  let workComposing = false;
  let workUndoTail = Promise.resolve();
  const K = window.WhendeskKeys;
  let writeQueue = Promise.resolve(), saveTimer, resizeTimer, feedbackTimer, undoAction, dashboardFocus, returnFocus, editingEvent, lastEventKey, refreshTimer, loading = false;
  let helpOpen = false, helpReturn = null;
  let dashboardReturn = null, taskCursor = null, modalReturnKey = null, modalReturnEditor = null;
  let modalDirty = false, discardArmedAt = 0, commandNoticeTimer = null;
  let notes;

  if (!api?.call) {
    commandBox.innerHTML = '<p class="td-empty" role="alert">WHENDESK 연결을 시작하지 못했습니다. 데스크톱 앱으로 실행해 주세요.</p>';
    return;
  }
  // Error의 사용자 속성은 contextBridge를 건널 때 유실되므로 응답을 받은 컨텍스트에서 오류를 만든다.
  const call = async (method, payload) => {
    if (!api.request) return api.call(method,payload);
    const result = await api.request(method,payload);
    if (!result?.ok) { const error = new Error(result?.error || '요청에 실패했습니다.'); if (result?.fields) error.fields = result.fields; throw error; }
    return result.value;
  };
  const safe = fn => Promise.resolve().then(fn).catch(showError);
  notes = window.WhendeskNotes?.create({ container:body, call, feedback, onError:showError, onChanged:() => safe(() => loadState({renderMain:false})) });
  function showError(error) { feedback(error?.message || String(error), null, true); console.error(error); }
  function feedback(message, action = null, error = false) {
    const element = root.querySelector('.td-feedback');
    undoAction = action; element.classList.toggle('is-error', error);
    element.innerHTML = `<span>${esc(message)}</span>${action ? '<button data-action="undo">되돌리기</button>' : ''}<button data-action="dismiss" aria-label="알림 닫기">${icon('x')}</button>`;
    element.hidden = false; clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { element.hidden = true; undoAction = null; }, error ? 15000 : 7000); icons();
  }
  function look() {
    app.dataset.skin = state.skin; app.style.colorScheme = state.mode === 'system' ? 'light dark' : state.mode;
    root.querySelectorAll('[data-look=skin]').forEach(element => { element.value = state.skin; });
    root.querySelectorAll('[data-look=mode]').forEach(element => { element.value = state.mode; });
    resizeCommand();
  }
  function resizeCommand() {
    clearTimeout(resizeTimer);
    if (state.shell !== 'command' || helpOpen) return;
    resizeTimer = setTimeout(() => {
      if (state.shell !== 'command' || helpOpen) return;
      const panel = root.querySelector('#cf-command-panel');
      const intrinsic=[...panel.children].filter(element=>!element.hidden).reduce((sum,element)=>{const style=getComputedStyle(element);return sum+element.offsetHeight+(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0);},0);
      const height = Math.ceil(intrinsic + root.querySelector('.td-footer').offsetHeight);
      call('shell', { mode:'command', height:Math.max(54, Math.min(390, height)) }).catch(showError);
    }, 25);
  }
  function captureFocus() {
    const element = document.activeElement;
    const workControl=['data-work-search','data-work-project-filter','data-work-sort','data-work-range'].find(attribute=>element?.hasAttribute?.(attribute));
    if(body.contains(element)&&workControl)return {workControl,start:element.selectionStart,end:element.selectionEnd,scroll:element.scrollTop};
    if (!body.contains(element) || !element.matches('[data-field]')) return null;
    return { id:element.closest('[data-editor]')?.dataset.editor, field:element.dataset.field, start:element.selectionStart, end:element.selectionEnd, scroll:element.scrollTop };
  }
  function restoreFocus(saved) {
    if (!saved) return;
    const element = saved.workControl ? body.querySelector(`[${saved.workControl}]`) : body.querySelector(`[data-editor="${CSS.escape(saved.id)}"] [data-field="${CSS.escape(saved.field)}"]`);
    if (!element) return;
    element.focus({ preventScroll:true });
    if (saved.start != null) { try { element.setSelectionRange(saved.start, saved.end); } catch {} }
    element.scrollTop = saved.scroll;
  }
  async function shell(next, focus = true) {
    if (next !== 'command') { cancelCommandActivation(); closeCommandActions(false); }
    if (state.shell === 'dashboard' && next === 'command') { dashboardFocus = captureFocus() || dashboardFocus; const element=document.activeElement; dashboardReturn={element,start:element?.selectionStart,end:element?.selectionEnd,scroll:element?.scrollTop}; }
    if (state.shell === 'command') { command.query = commandInput.value; command.start = commandInput.selectionStart || 0; command.end = commandInput.selectionEnd || 0; }
    state.shell = next; root.classList.toggle('is-command', next === 'command');
    notes?.setActive(next === 'dashboard' && state.view === 'notes');
    root.querySelector('#cf-command-panel').hidden = next !== 'command';
    root.querySelector('#cf-dashboard-panel').hidden = next !== 'dashboard';
    root.querySelector('.cf-entry-name').textContent = next === 'command' ? 'WHENCOMMAND' : '대시보드';
    status(); icons();
    await call('shell', { mode:next });
    if (next === 'command') {
      commandInput.value = command.query; renderCommand(); resizeCommand();
      if (focus) { commandInput.focus({ preventScroll:true }); commandInput.setSelectionRange(command.start, command.end); }
    } else if (focus) {
      const saved=dashboardReturn;
      if(saved?.element?.isConnected&&saved.element.getClientRects().length){saved.element.focus({preventScroll:true});if(saved.start!=null){try{saved.element.setSelectionRange(saved.start,saved.end);}catch{}}saved.element.scrollTop=saved.scroll;}
      else restoreFocus(dashboardFocus);
      if (!root.contains(document.activeElement) || root.querySelector('#cf-command-panel').contains(document.activeElement)) focusView();
    }
  }
  function status() {
    const footer = root.querySelector('.td-footer'), label = footer.querySelector('span');
    label.textContent = pending.size ? '저장 중…' : ''; label.hidden = !pending.size;
    footer.hidden = !pending.size;
    resizeCommand();
  }
  async function openHelp() {
    if (helpOpen) return;
    const element = document.activeElement;
    helpReturn = { element, start:element?.selectionStart, end:element?.selectionEnd, scroll:element?.scrollTop, height:window.outerHeight };
    helpOpen = true; clearTimeout(resizeTimer);
    cancelCommandActivation();
    const row = (label, keys) => `<div><dt>${esc(label)}</dt><dd>${keys.map(key => `<kbd>${esc(key)}</kbd>`).join('')}</dd></div>`;
    const hotkey = key => String(key || '').replace(/CommandOrControl|Control/g, 'Ctrl');
    const groups = K.HELP.map(group => {
      const rows = group.rows.filter(([, , when]) => !when?.media || state.media.sessions?.length).map(([label, ids]) => row(label || K.find(ids[0]).label, ids.map(K.format))).join('');
      return `${group.title ? `<h3>${esc(group.title)}</h3>` : ''}<dl>${rows}</dl>`;
    }).join('');
    helpLayer.innerHTML = `<section class="minimal-help" role="dialog" aria-modal="true" aria-label="단축키 안내"><div class="minimal-help-head"><h2>단축키</h2><button data-action="close-help" aria-label="단축키 안내 닫기">${icon('x')}</button></div>${groups}<h3>어디서나</h3><dl>${state.prefs.hotkey ? row('WHENDESK 열기 · 숨기기', [hotkey(state.prefs.hotkey)]) : ''}${state.prefs.captureHotkey ? row('할 일 빠르게 담기', [hotkey(state.prefs.captureHotkey)]) : ''}</dl><p class="minimal-help-note">마감일은 오늘·내일·모레·상대일 또는 날짜로 입력하며, 비우면 해제합니다. Work 검색에는 초성·본문·프로젝트와 마감순·마감지남·이번주 같은 원본 필터를 사용할 수 있습니다. 할 일을 캘린더 날짜로 끌어놓아도 마감을 바꿀 수 있습니다. 동작 목록과 열린 대화상자는 Esc로 먼저 닫습니다. 단축키 설정 필드에서는 조합을 눌러 기록하고, Delete로 해제하거나 Esc로 저장된 값을 불러옵니다.</p></section>`;
    helpLayer.hidden = false;
    [...app.children].filter(child => child !== helpLayer).forEach(child => { child.inert = true; });
    icons(); helpLayer.querySelector('button').focus({ preventScroll:true });
    if (state.shell === 'command') await call('shell', { mode:'command', height:560 });
  }
  async function closeHelp() {
    if (!helpOpen) return;
    const saved = helpReturn; helpOpen = false; helpReturn = null;
    helpLayer.hidden = true; helpLayer.innerHTML = '';
    [...app.children].forEach(child => { child.inert = false; });
    if (saved?.element?.isConnected && saved.element.getClientRects().length) {
      saved.element.focus({ preventScroll:true });
      if (saved.start != null) { try { saved.element.setSelectionRange(saved.start, saved.end); } catch {} }
      saved.element.scrollTop = saved.scroll;
    } else if(state.shell==='command')commandInput.focus({preventScroll:true});else focusView();
    if (state.shell === 'command') { await call('shell', { mode:'command', height:saved?.height }); resizeCommand(); }
  }
  async function loadState({ renderMain = true } = {}) {
    const data = await call('state', { year:state.year, month:state.month, includeDeleted:true });
    state.allTasks = data.tasks || [];
    state.tasks = state.allTasks.filter(t => !t.deleted);
    state.projects = data.projects || []; state.archivedProjects=data.deletedProjects||data.archivedProjects||[]; state.events = data.events || []; state.calendars = data.calendars || [];
    for (const [id, patch] of pending) { const task = state.tasks.find(t => t.id === id); if (task) Object.assign(task, patch); }
    renderNav(); renderCalendar(); if (renderMain) renderMainView(); else syncProjectOptions();
    if (!command.query.trim()) safe(() => queryCommand('', true));
    return data;
  }
  function queueTask(id, patch) {
    const task = state.tasks.find(t => t.id === id); if (task) Object.assign(task, patch);
    pending.set(id, { ...(pending.get(id) || {}), ...patch }); status();
    clearTimeout(saveTimer); saveTimer = setTimeout(() => safe(flushPending), 350);
  }
  async function flushPending() {
    await notes?.flush();
    clearTimeout(saveTimer);
    const entries = [...pending.entries()].map(([id, patch]) => [id, { ...patch }]);
    if (!entries.length) return writeQueue;
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      for (const [id, patch] of entries) {
        const current = pending.get(id); if (!current) continue;
        await call('mutate', { type:'task.update', payload:{ id, ...patch } });
        const rest = { ...pending.get(id) };
        for (const key of Object.keys(patch)) if (rest[key] === patch[key]) delete rest[key];
        if (Object.keys(rest).length) pending.set(id, rest); else pending.delete(id);
      }
      status(); await loadState({ renderMain:false });
    });
    return writeQueue;
  }
  async function mutate(type, payload, { renderMain = true } = {}) {
    await flushPending(); const result = await call('mutate', { type, payload });
    await loadState({ renderMain }); return result;
  }
  function dueLabel(value) { return !value ? '마감 없음' : value === today ? '오늘' : value === tomorrow ? '내일' : value.slice(5).replace('-', '.'); }
  function syncProjectOptions() {
    body.querySelectorAll('[data-field=project_id]').forEach(select=>{
      const value=select.value,previous=[...select.options].find(option=>option.value===value)?.cloneNode(true);
      const options=[new Option('미지정',''),...state.projects.map(project=>new Option(project.name,String(project.id)))];
      if(value&&!options.some(option=>option.value===value)&&previous)options.push(previous);
      select.replaceChildren(...options);select.value=value;
    });
  }
  function workItem(task) {
    return {...task,project_name:task.project||null,waiting_for:task.waitingFor,captured_at:task.capturedAt,done_at:task.doneAt,deleted_at:task.deletedAt,nudged_at:task.nudgedAt,nudge_count:task.nudgeCount};
  }
  function workMatches(task) {
    return (!state.project || (state.project==='unassigned' ? task.project_id==null : task.project_id===state.project)) && workRules.matchQuery(workItem(task),workRules.parseQuery(state.workQuery));
  }
  function workGroups() {
    const cutoff=Date.now()-12*3600_000;
    let list=state.tasks.filter(task=>(state.tab==='done' ? task.done && (state.workRange==null||Date.parse(task.doneAt)>Date.now()-state.workRange*86400_000) : task.kind===state.tab&&(!task.done||Date.parse(task.doneAt)>cutoff))&&workMatches(task)&&(!state.dueOnly||state.tab!=='todo'||task.due||task.done)).map(workItem);
    const querySort=workRules.parseQuery(state.workQuery).sort;
    list=workRules.sortItems(list,querySort||(state.workSort==='project'?'due':state.workSort));
    if(state.tab==='done')return workRules.historyDays({items:list,commits:[]}).map(group=>({key:group.key,label:workRules.dayLabel(group.key),items:group.items}));
    if(state.tab==='todo'&&!querySort&&state.workSort==='project')return workRules.todayGroups(list,state.projects);
    return [{key:'all',label:null,items:workRules.doneLast(list)}];
  }
  function workArchiveHits() {
    if(!state.workQuery.trim()||state.tab==='projects')return [];
    const live=new Set(workGroups().flatMap(group=>group.items).map(task=>task.id));
    return state.allTasks.filter(task=>(task.deleted||task.done&&Date.parse(task.doneAt)<=Date.now()-12*3600_000)&&!live.has(task.id)&&workMatches(task)).sort((a,b)=>String(b.deletedAt||b.doneAt).localeCompare(String(a.deletedAt||a.doneAt))).map(task=>({...task,archived:true}));
  }
  function visibleTasks() {
    if(state.tab==='projects')return [];
    return [...workGroups().flatMap(group=>group.items),...workArchiveHits().slice(0,30)];
  }
  function visibleProjects() {
    return (state.workTrash?state.archivedProjects:state.projects).filter(project=>workRules.matches(project,workRules.parseQuery(state.workQuery).text));
  }
  function workView() {
    const search=`<label class="work-search">${icon('search')}<input data-work-search aria-label="Work 검색" placeholder="검색" value="${esc(state.workQuery)}" autocomplete="off" spellcheck="false">${state.workQuery?`<button data-action="clear-work-search" aria-label="Work 검색 지우기">${icon('x')}</button>`:''}</label>`;
    if(state.tab==='projects') {
      const projects=visibleProjects();
      return `<div class="work-toolbar">${search}<button class="work-text-button" data-action="new-project">${icon('plus')}프로젝트</button><button class="work-text-button ${state.workTrash?'active':''}" data-action="work-project-trash" aria-pressed="${state.workTrash}">${state.workTrash?'활성 프로젝트':'보관함'}</button></div><div class="td-list-label"><span>${state.workTrash?'보관된 프로젝트':'프로젝트'} ${projects.length}개</span></div><div class="work-project-list">${projects.map((project,index)=>`<article class="work-project-row" data-work-project-row="${project.id}" tabindex="${String(project.id)===String(projectCursor)||!projectCursor&&index===0?0:-1}"><button class="work-project-name" ${state.workTrash?`data-project-label="${project.id}" tabindex="-1"`:`data-project="${project.id}"`}>${icon('folder')}<span>${esc(project.name)}<small>${state.workTrash?`${project.itemCount??project.item_count??0}개 기록 보존`:state.tasks.filter(task=>task.project_id===project.id&&!task.done).length+'개 미완료'}</small></span></button><div class="work-row-actions">${state.workTrash?`<button data-restore-project="${project.id}" aria-label="${esc(project.name)} 복원">복원</button>`:`<button data-move-project="${project.id}" data-direction="up" aria-label="${esc(project.name)} 위로" ${index===0?'disabled':''}>${icon('arrow-up')}</button><button data-move-project="${project.id}" data-direction="down" aria-label="${esc(project.name)} 아래로" ${index===projects.length-1?'disabled':''}>${icon('arrow-down')}</button><button data-edit-project="${project.id}" aria-label="${esc(project.name)} 이름 수정">${icon('pencil')}</button><button data-archive-project="${project.id}" aria-label="${esc(project.name)} 보관">${icon('archive')}</button>`}</div></article>`).join('')}</div>${projects.length?'':`<div class="td-empty">${state.workTrash?'보관된 프로젝트가 없어요.':'프로젝트를 추가해 할 일을 묶으세요.'}</div>`}`;
    }
    const projectFilter=`<select data-work-project-filter aria-label="프로젝트 필터"><option value="">모든 프로젝트</option><option value="unassigned" ${state.project==='unassigned'?'selected':''}>미지정</option>${state.projects.map(project=>`<option value="${project.id}" ${state.project===project.id?'selected':''}>${esc(project.name)}</option>`).join('')}</select>`;
    const sort=state.tab==='done'?`<select data-work-range aria-label="완료 기록 기간">${[['7','최근 7일'],['30','최근 30일'],['','전체 기록']].map(([value,label])=>`<option value="${value}" ${String(state.workRange??'')===value?'selected':''}>${label}</option>`).join('')}</select>`:`<select data-work-sort aria-label="할 일 정렬">${[['project','프로젝트순'],['due','마감순'],['new','최신순'],['old','오래된순'],['title','이름순']].map(([value,label])=>`<option value="${value}" ${state.workSort===value?'selected':''}>${label}</option>`).join('')}</select>`;
    const groups=workGroups(),archive=workArchiveHits(),count=groups.reduce((sum,group)=>sum+group.items.length,0);
    return `<div class="work-toolbar">${search}${projectFilter}${sort}</div><div class="td-list-label"><span role="status">${count}개${state.workQuery?' · 검색 결과':''}</span>${state.tab==='todo'?`<label><input type="checkbox" data-due-only ${state.dueOnly?'checked':''}>마감 있는 일</label>`:''}</div><div class="td-rows">${groups.map(group=>`${group.label?`<h2 class="work-group" data-work-group="${esc(group.key)}">${esc(group.label)}<small>${group.items.length}</small></h2>`:''}${group.items.map(taskRow).join('')}`).join('')}</div>${count?'':'<div class="td-empty">표시할 항목이 없어요.</div>'}${archive.length?`<h2 class="work-group">목록 밖 · 완료·삭제 ${archive.length}개</h2>${archive.slice(0,30).map(taskRow).join('')}${archive.length>30?'<p class="work-muted">검색어를 좁혀 나머지 항목을 찾으세요.</p>':''}`:''}`;
  }
  function renderNav() {
    const focused=root.querySelector('.td-sidebar').contains(document.activeElement)?controlSelector(document.activeElement):null;
    const workActive=state.view === 'tasks';
    const page=active=>active?'aria-current="page"':'';
    root.querySelector('.td-sidebar').innerHTML = `<nav class="td-nav" aria-label="주 메뉴">
      <button data-action="home" class="${state.view === 'dashboard' ? 'active' : ''}" ${page(state.view === 'dashboard')}>${icon('panels-top-left')}<span>Dashboard</span></button>
      <button data-action="work" class="${workActive ? 'active' : ''}" ${page(workActive)}>${icon('briefcase-business')}<span>Work</span></button>
      <button data-action="notes" class="${state.view === 'notes' ? 'active' : ''}" ${page(state.view === 'notes')}>${icon('notebook-pen')}<span>Note</span></button>
      <button class="td-nav-calendar ${state.view === 'calendar' ? 'active' : ''}" data-action="calendar" ${page(state.view === 'calendar')}>${icon('calendar-days')}<span>Calendar</span></button>
    </nav><div class="td-sidebar-bottom"><button data-action="settings">${icon('settings-2')}<span>Settings</span></button></div>`; icons();
    renderWorkTabs();
    if(focused)root.querySelector('.td-sidebar').querySelector(focused)?.focus({preventScroll:true});
  }
  const workTabs = [['inbox','InBox'],['todo','ToDo'],['waiting','Waiting'],['done','Done'],['projects','Projects']];
  function renderWorkTabs() {
    let tabs=root.querySelector('.td-main>.td-work-nav');
    if(!tabs){tabs=document.createElement('div');tabs.id='td-work-nav';tabs.className='td-work-nav';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Work 분류');root.querySelector('.td-quick').before(tabs);}
    tabs.hidden=state.view!=='tasks';
    if(tabs.hidden){body.removeAttribute('role');body.removeAttribute('aria-labelledby');return;}
    const focused=tabs.contains(document.activeElement)?document.activeElement?.closest('[data-tab]')?.dataset.tab:null;
    const count = kind => kind==='projects'?state.projects.length:state.tasks.filter(task=>!task.deleted&&(kind==='done'?task.done:!task.done&&task.kind===kind)).length;
    tabs.innerHTML=workTabs.map(([key,label])=>`<button id="work-tab-${key}" data-tab="${key}" role="tab" aria-selected="${state.tab===key}" aria-controls="work-panel" tabindex="${state.tab===key?0:-1}" class="${state.tab===key?'active':''}"><span>${label}</span><small>${count(key)}</small></button>`).join('');
    body.id='work-panel';body.setAttribute('role','tabpanel');body.setAttribute('aria-labelledby',`work-tab-${state.tab}`);
    if(focused)tabs.querySelector(`[data-tab="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  }
  async function switchWorkTab(key,{focus='list',clearProject=false}={}) {
    if(!workTabs.some(([tab])=>tab===key))return;
    if(taskCursor)workCursors.set(workCursorKey(),taskCursor);
    await flushPending();
    state.view='tasks';state.tab=key;state.selected=null;state.workTrash=false;
    if(clearProject)state.project=null;
    taskCursor=workCursors.get(workCursorKey())||null;
    renderNav();renderMainView();
    if(state.shell!=='dashboard')await shell('dashboard',false);
    if(focus==='tab')root.querySelector(`.td-work-nav [data-tab="${CSS.escape(key)}"]`)?.focus({preventScroll:true});else focusView();
  }
  async function cycleWorkTab(direction=1,options={}) {
    const index=workTabs.findIndex(([key])=>key===state.tab);
    return switchWorkTab(workTabs[(Math.max(0,index)+direction+workTabs.length)%workTabs.length][0],options);
  }
  function taskRow(task) {
    if(task.archived)return `<article class="td-task work-archived" data-task-row="${esc(task.id)}"><div class="td-row"><span class="work-muted">${icon(task.deleted?'trash-2':'check')}</span><button class="td-task-open" data-revive-task="${esc(task.id)}"><span>${esc(task.title)}</span><small>${esc(task.project||'미지정')} · ${task.deleted?'삭제됨':'지난 완료'} · ${esc((task.deletedAt||task.doneAt||'').slice(0,10))}</small></button><button class="work-text-button" data-revive-task="${esc(task.id)}">되살리기</button></div></article>`;
    const open = state.selected === task.id;
    const wait=task.kind==='waiting'?workRules.waitMeta(workItem(task)):null,badge=workRules.dueBadge(task.due);
    const meta=`${esc(task.project||'프로젝트 미지정')}${task.waitingFor?' · '+esc(task.waitingFor):''}${wait?` · <span class="${wait.hot?'work-overdue':''}">${esc(wait.label)}</span>${wait.nudges?' · 재촉 '+wait.nudges+'회':''}`:''}`;
    return `<article class="td-task ${open ? 'selected' : ''} ${task.done ? 'done' : ''}" data-task-row="${esc(task.id)}" ${open ? `data-editor="${esc(task.id)}"` : ''}><div class="td-row"><input type="checkbox" data-check="${esc(task.id)}" aria-label="${esc(task.title)} 완료" ${task.done ? 'checked' : ''}>${open ? `<div class="td-task-open"><input class="td-row-title" data-field="title" aria-label="할 일 제목" value="${esc(task.title)}"><small>${meta}</small></div>` : `<button class="td-task-open" data-task="${esc(task.id)}" draggable="true" aria-expanded="false"><span>${esc(task.title)}</span><small>${meta}</small></button>`}<button class="td-due ${badge?.cls==='today'?'today':''} ${badge?.cls==='over'?'work-overdue':''}" data-edit-due="${esc(task.id)}" title="${esc(task.due||'마감 없음')}">${badge?esc(badge.text):'마감 없음'}</button>${open ? `<button class="td-drag-handle" data-task="${esc(task.id)}" draggable="true" aria-label="할 일 끌기">${icon('grip-vertical')}</button>` : ''}</div>${open ? taskEditor(task) : ''}</article>`;
  }
  function taskEditor(task) {
    return `<div class="td-inline"><div class="td-fields"><label class="td-field">상태<select data-field="kind" aria-label="할 일 상태">${[['inbox','인박스'],['todo','할 일'],['waiting','대기']].map(([value,label]) => `<option value="${value}" ${task.kind === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="td-field">마감<input type="date" data-field="due" aria-label="할 일 마감" value="${esc(task.due)}"></label><label class="td-field">프로젝트<select data-field="project_id" aria-label="할 일 프로젝트"><option value="">미지정</option>${state.projects.map(p => `<option value="${p.id}" ${task.project_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>${task.kind === 'waiting' ? `<label class="td-field">대기 상대<input data-field="waitingFor" aria-label="대기 상대" value="${esc(task.waitingFor)}"></label>` : ''}</div><textarea class="td-note" data-field="note" aria-label="할 일 상세 내용" placeholder="상세 내용" spellcheck="false">${esc(task.note)}</textarea><div class="td-inline-foot"><span data-save-status>수정 내용 자동 저장</span><div>${task.kind === 'waiting' ? `<button data-nudge="${esc(task.id)}">재촉 기록</button>` : ''}<button data-delete-task="${esc(task.id)}">삭제</button><button data-action="collapse">${icon('chevron-up')}접기</button></div></div></div>`;
  }
  function home() {
    const tasks = state.tasks.filter(t => !t.done && t.kind === 'todo').sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999'));
    const unfinished=state.tasks.filter(t=>!t.done).length;
    return `<section class="cf-home-section"><div class="cf-home-head"><h2>ToDo <small>${tasks.length}개</small></h2><button data-tab="todo">전체 보기 →</button></div>${tasks.slice(0,5).map(t => `<div class="cf-home-task"><input type="checkbox" data-check="${esc(t.id)}" aria-label="${esc(t.title)} 완료"><button data-reveal="${esc(t.id)}">${esc(t.title)}<small>${esc(t.project || '미지정')}</small></button><small>${dueLabel(t.due)}</small></div>`).join('') || '<div class="cf-home-empty">할 일 없음</div>'}</section><button class="cf-entry" data-action="work">${icon('briefcase-business')}<span>Work</span><b>${unfinished}</b>${icon('chevron-right')}</button><button class="cf-entry" data-action="notes">${icon('notebook-pen')}<span>Note</span>${icon('chevron-right')}</button><button class="cf-entry" data-action="calendar">${icon('calendar-days')}<span>Calendar</span>${icon('chevron-right')}</button>`;
  }
  function renderMainView() {
    const focus = captureFocus();
    notes?.setActive(state.view === 'notes' && state.shell === 'dashboard');
    app.classList.toggle('is-calendar', state.view === 'calendar' || state.view === 'settings' || state.view === 'notes');
    renderWorkTabs();
    root.querySelector('.td-quick').hidden = state.view !== 'tasks' || state.tab === 'projects';
    const workTitle=state.tab==='projects'?'Projects':state.projects.find(p => p.id === state.project)?.name || ({todo:'ToDo',inbox:'InBox',waiting:'Waiting',done:'Done'})[state.tab] || 'InBox';
    const title = state.view === 'dashboard' ? 'Dashboard' : state.view === 'calendar' ? 'Calendar' : state.view === 'settings' ? 'Settings' : state.view === 'notes' ? 'Note' : `Work · ${workTitle}`;
    root.querySelector('.td-main-head').innerHTML = `<div><h1>${esc(title)}</h1><p>${state.view === 'dashboard' ? new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'long' }) : state.view === 'calendar' ? '일정과 할 일의 마감' : state.view === 'settings' ? '외관 · 단축키 · 데이터' : ({ todo:'해야 할 일을 하나씩 정리하세요.', inbox:'담아둔 일을 분류하세요.', waiting:'답변과 진행 상황을 기다리는 일.', done:'마친 일의 기록을 확인하세요.' })[state.tab]}</p></div>${state.view === 'calendar' ? `<button class="td-primary" data-action="new-event">${icon('plus')}일정 추가</button>` : state.view === 'tasks' && Number.isInteger(state.project) ? `<button class="td-secondary" data-edit-project="${state.project}">프로젝트 관리</button>` : ''}`;
    if (state.view === 'dashboard') body.innerHTML = home();
    else if (state.view === 'settings') body.innerHTML = settingsView();
    else if (state.view === 'notes') notes?.mount(body);
    else if (state.view === 'calendar') body.innerHTML = `<section class="td-full-calendar">${calendarMonth()}<div class="calendar-tools"><button class="td-secondary" data-action="subscriptions">${icon('rss')}구독 관리</button><button class="td-secondary" data-action="import-ics">ICS 가져오기</button><button class="td-secondary" data-action="export-ics">ICS 내보내기</button></div><form class="calendar-natural"><input name="line" aria-label="일정 한 줄 입력" placeholder="예: 내일 오후 3시 치과 30분" required><button class="td-secondary" type="submit">일정 확인</button></form><div class="td-main-calendar-agenda"><h2>${Number(state.date.slice(5,7))}월 ${Number(state.date.slice(8))}일</h2>${eventRows(state.date)}</div></section>`;
    else body.innerHTML = workView();
    restoreFocus(focus); icons();
    if(state.view==='tasks'){syncTaskCursor();syncProjectCursor();}
  }
  function eventKey(event) { return encodeURIComponent(String(event.id) + '|' + (event.recurrenceId || event.startsAt || event.date)); }
  function findEvent(key) { return state.events.find(e => eventKey(e) === key || String(e.id) === String(key)); }
  function calendarMonth() {
    const first = new Date(state.year, state.month, 1), offset = (first.getDay()+6)%7, count = Math.ceil((offset + new Date(state.year,state.month+1,0).getDate())/7)*7;
    return `<div class="td-cal-head"><h2>${state.year}년 ${state.month+1}월</h2><div><button data-month="-1" aria-label="이전 달">${icon('chevron-left')}</button><button data-action="today">오늘</button><button data-month="1" aria-label="다음 달">${icon('chevron-right')}</button></div></div><div class="td-month">${['월','화','수','목','금','토','일'].map(day => `<span class="td-weekday">${day}</span>`).join('')}${Array.from({ length:count }, (_,index) => { const date = new Date(state.year,state.month,1-offset+index), key = dateKey(date); const events = state.events.filter(e => e.date === key); const tasks = state.tasks.filter(t => !t.done && t.due === key); return `<button class="td-day ${key === today ? 'today' : ''} ${key === state.date ? 'selected' : ''} ${date.getMonth() !== state.month ? 'other' : ''}" data-date="${key}" tabindex="${key === state.date ? 0 : -1}" aria-pressed="${key === state.date}" aria-label="${key} 일정 ${events.length}개, 마감 ${tasks.length}개"><span>${date.getDate()}</span><span class="td-day-marks">${events.length ? '<i class="td-event-mark"></i>' : ''}${tasks.length ? '<i class="td-task-mark"></i>' : ''}</span></button>`; }).join('')}</div>`;
  }
  function eventRows(date) {
    const events = state.events.filter(e => e.date === date).sort((a,b) => String(a.time).localeCompare(String(b.time)));
    return events.map(e => `<button class="td-cal-event" data-event="${eventKey(e)}"><time>${e.allDay ? '종일' : esc(e.time)}</time><span>${esc(e.title)}<small>${e.allDay ? '종일 일정' : esc(e.time) + ' – ' + esc(e.end || '')}${e.location ? ' · ' + esc(e.location) : ''}${e.rrule ? ' · 반복' : ''}${e.readonly ? ' · 구독' : ''}</small></span></button>`).join('') || '<div class="td-empty" style="padding:15px 0">일정 없음</div>';
  }
  function renderCalendar() {
    const focused=root.querySelector('.td-calendar-side').contains(document.activeElement)?controlSelector(document.activeElement):null;
    root.querySelector('.td-calendar-side').innerHTML = `${calendarMonth()}<div class="td-cal-legend"><i class="td-event-mark"></i>일정 <i class="td-task-mark"></i>할 일 마감</div><section class="td-day-detail"><div class="td-cal-head"><h2>${Number(state.date.slice(5,7))}월 ${Number(state.date.slice(8))}일 일정</h2><button data-action="new-event" aria-label="선택한 날짜에 일정 추가">${icon('plus')}</button></div>${eventRows(state.date)}<div class="td-deadlines"><small>이날 마감인 할 일</small>${state.tasks.filter(t => !t.done && t.due === state.date).map(t => `<button class="td-deadline" data-reveal="${esc(t.id)}">${icon('circle')}<span>${esc(t.title)}</span></button>`).join('') || '<small>마감 없음</small>'}</div></section><p class="td-calendar-hint">할 일을 날짜로 끌어놓으면 마감이 바뀝니다.</p>`; icons();
    if(focused)root.querySelector('.td-calendar-side').querySelector(focused)?.focus({preventScroll:true});
  }
  async function reveal(id) {
    await flushPending(); const task = state.tasks.find(t => String(t.id) === String(id)); if (!task) return;
    state.view = 'tasks'; state.tab = task.done ? 'done' : task.kind; state.selected = task.id; state.project = null; state.dueOnly = false; state.workQuery='';state.workRange=null;
    renderNav(); renderMainView(); await shell('dashboard', false); body.querySelector('[data-field=title]')?.focus({ preventScroll:true });
  }
  async function navigate(route = {}) {
    if (route.shell === 'command') { await flushPending(); return shell('command'); }
    if (route.view === 'work' || route.view === 'tasks' && route.tab && !route.id) state.project=null;
    if (route.view === 'notes') { await flushPending(); state.view='notes'; state.project=null; renderNav(); renderMainView(); await shell('dashboard',false); await notes?.refresh(); if(route.id) await notes?.open(route.id); else notes?.focus(); return; }
    if (route.id && route.view !== 'calendar') await reveal(route.id);
    else { await flushPending(); state.view = route.settings ? 'settings' : route.view === 'work' ? 'tasks' : route.view || 'dashboard'; if(route.settings){state.prefs=await call('preferences.get');state.info=await call('app.info');} if (route.tab) state.tab = route.tab; if (route.date) { state.date = route.date; state.year = Number(route.date.slice(0,4)); state.month = Number(route.date.slice(5,7))-1; } await loadState(); await shell('dashboard'); }
    if (route.focusCapture) root.querySelector('.td-quick input')?.focus();
  }
  async function addTask(title) {
    const origin={view:state.view,tab:state.tab,project:state.project,query:state.workQuery};
    const result = await mutate('task.create', { title }, { renderMain:false });
    const followed=state.view===origin.view&&state.tab===origin.tab&&state.project===origin.project&&state.workQuery===origin.query;
    if(followed){state.view='tasks';state.tab='inbox';state.project=null;state.workQuery='';state.dueOnly=false;state.selected=null;taskCursor=result.id;renderNav();renderMainView();}
    feedback('InBox에 담았어요.'); return {...result,followed};
  }
  async function changeDue(id, date) {
    const task = state.tasks.find(t => t.id === id); if (!task) return;
    const previous = task.due; await mutate('task.update', { id, due:date }); state.date = date;
    state.year = Number(date.slice(0,4)); state.month = Number(date.slice(5,7))-1; renderCalendar();
    rememberWorkUndo('마감일',()=>mutate('task.update',{id,due:previous}),'마감을 변경했어요.');
  }
  function openModal(html) { modalDirty = false; discardArmedAt = 0; returnFocus = document.activeElement; modalReturnKey=controlSelector(returnFocus); modalReturnEditor=captureFocus(); modalLayer.hidden = false; modalLayer.innerHTML = html; (modalLayer.querySelector('input:not([type=checkbox]):not([readonly]),textarea:not([readonly]),select:not([disabled])')||modalLayer.querySelector('button'))?.focus(); icons(); }
  /* 입력한 내용이 있는 대화상자는 Esc 한 번에 버리지 않는다. 3초 안에 한 번 더 누르면 닫는다. */
  function closeModalSafely() {
    if (modalDirty && modalLayer.querySelector('form') && Date.now() - discardArmedAt > 3000) { discardArmedAt = Date.now(); feedback('저장하지 않은 내용이 있어요. Esc를 한 번 더 누르면 버립니다.'); return; }
    closeModal();
  }
  function closeModal() { modalDirty = false; discardArmedAt = 0; modalLayer.hidden = true; modalLayer.innerHTML = ''; editingEvent = null; if (returnFocus?.isConnected && root.contains(returnFocus)) returnFocus.focus({ preventScroll:true }); else if(modalReturnEditor&&body.querySelector(`[data-editor="${CSS.escape(modalReturnEditor.id)}"] [data-field="${modalReturnEditor.field}"]`))restoreFocus(modalReturnEditor);else if(modalReturnKey&&root.querySelector(modalReturnKey)?.getClientRects().length)root.querySelector(modalReturnKey).focus({preventScroll:true});else focusView(); }
  function eventModal(key = null, parsed = null) {
    if (state.shell !== 'dashboard') safe(() => shell('dashboard', false));
    const event = key ? findEvent(key) : null; editingEvent = event; lastEventKey = key;
    let values = event || { title:'', date:state.date, time:'09:00', end:'10:00', allDay:false, location:'', note:'', rrule:'' };
    if (parsed) { const start = new Date(parsed.startsAt), end = parsed.endsAt ? new Date(parsed.endsAt) : null; values = { ...values, ...parsed, date:dateKey(start), time:`${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}`, end:end ? `${String(end.getHours()).padStart(2,'0')}:${String(end.getMinutes()).padStart(2,'0')}` : '10:00' }; }
    const readonly = !!event?.readonly;
    openModal(`<form class="td-modal event-form" role="dialog" aria-modal="true" aria-label="일정 편집"><div class="td-modal-header"><h2>${readonly ? '구독 일정' : event ? '일정 수정' : '일정 추가'}</h2><button type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div><label class="td-field">제목<input name="title" aria-label="일정 제목" value="${esc(values.title)}" required ${readonly ? 'readonly' : ''}></label><label class="td-field">날짜<input type="date" name="date" aria-label="일정 날짜" value="${esc(values.date)}" required ${readonly ? 'readonly' : ''}></label><label class="all-day-label"><input type="checkbox" name="allDay" ${values.allDay ? 'checked' : ''} ${readonly ? 'disabled' : ''}>종일</label><div class="td-fields"><label class="td-field">시작<input type="time" name="time" aria-label="일정 시작" value="${esc(values.time || '09:00')}" ${readonly ? 'readonly' : ''}></label><label class="td-field">종료<input type="time" name="end" aria-label="일정 종료" value="${esc(values.end || '10:00')}" ${readonly ? 'readonly' : ''}></label></div><label class="td-field">장소<input name="location" aria-label="일정 장소" value="${esc(values.location)}" ${readonly ? 'readonly' : ''}></label><label class="td-field">반복<select name="rrule" aria-label="일정 반복" ${readonly ? 'disabled' : ''}>${[['','반복 안 함'],['FREQ=DAILY','매일'],['FREQ=WEEKLY','매주'],['FREQ=MONTHLY','매월']].concat(values.rrule && !['FREQ=DAILY','FREQ=WEEKLY','FREQ=MONTHLY'].includes(values.rrule) ? [[values.rrule,'기존 반복 규칙 유지']] : []).map(([value,label]) => `<option value="${esc(value)}" ${values.rrule === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${event?.rrule && !readonly ? '<label class="td-field">적용 범위<select name="scope" aria-label="반복 일정 적용 범위"><option value="all">전체 반복 일정</option><option value="one">이 회차만</option><option value="future">이 회차부터</option></select></label>' : ''}<label class="td-field">상세 내용<textarea name="note" class="td-note" aria-label="일정 상세 내용" ${readonly ? 'readonly' : ''}>${esc(values.note)}</textarea></label><div class="td-modal-actions">${event && !readonly ? '<button type="button" class="td-modal-delete" data-action="delete-event">일정 삭제</button>' : '<span></span>'}<div><button type="button" class="td-secondary" data-action="close-modal">${readonly ? '닫기' : '취소'}</button>${readonly ? '' : '<button type="submit" class="td-primary">저장</button>'}</div></div></form>`);
    editingEvent = event;
  }
  function projectModal(id = null) {
    const project = state.projects.find(p => p.id === id);
    openModal(`<form class="td-modal project-form" role="dialog" aria-modal="true" aria-label="프로젝트 편집" data-project-id="${id || ''}"><div class="td-modal-header"><h2>${project ? '프로젝트 관리' : '프로젝트 추가'}</h2><button type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div><label class="td-field">이름<input name="name" aria-label="프로젝트 이름" value="${esc(project?.name)}" required></label><div class="td-modal-actions">${project ? `<button type="button" class="td-modal-delete" data-archive-project="${id}">프로젝트 보관</button>` : '<span></span>'}<div><button type="button" class="td-secondary" data-action="close-modal">취소</button><button class="td-primary" type="submit">저장</button></div></div></form>`);
  }
  function dueModal(id) {
    const task=state.tasks.find(item=>item.id===id);if(!task)return;
    openModal(`<form class="td-modal work-due-form" data-task-id="${esc(id)}" role="dialog" aria-modal="true" aria-label="마감일 지정"><div class="td-modal-header"><h2>마감일</h2><button type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div><p class="work-modal-caption">${esc(task.title)}</p><label class="td-field">날짜<input name="text" aria-label="마감일 입력" value="${esc(task.due)}" placeholder="오늘 / 내일 / +3 / 8-12" autocomplete="off"></label><p class="work-muted">비우고 저장하면 마감을 해제합니다.</p><div class="td-modal-actions"><span></span><div><button type="button" class="td-secondary" data-action="close-modal">취소</button><button type="submit" class="td-primary">저장</button></div></div></form>`);
    modalLayer.querySelector('[name=text]').select();
  }
  function waitingModal(id) {
    const task=state.tasks.find(item=>item.id===id);if(!task)return;
    openModal(`<form class="td-modal work-waiting-form" data-task-id="${esc(id)}" role="dialog" aria-modal="true" aria-label="대기로 이동"><div class="td-modal-header"><h2>누구를 기다리나요?</h2><button type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div><p class="work-modal-caption">${esc(task.title)}</p><label class="td-field">대기 상대<input name="waitingFor" aria-label="기다리는 상대" value="${esc(task.waitingFor)}" placeholder="비워도 됩니다" autocomplete="off"></label><div class="td-modal-actions"><span></span><div><button type="button" class="td-secondary" data-action="close-modal">취소</button><button type="submit" class="td-primary">대기로 이동</button></div></div></form>`);
  }
  function archiveProjectModal(id) {
    const project=state.projects.find(item=>item.id===id);if(!project)return;
    const live=state.tasks.filter(task=>task.project_id===id&&!task.done).length;
    openModal(`<form class="td-modal work-archive-form" data-project-id="${id}" role="dialog" aria-modal="true" aria-label="프로젝트 보관"><div class="td-modal-header"><h2>프로젝트 보관</h2><button type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div><p class="work-modal-caption">${esc(project.name)}</p><p>${live?`미완료 ${live}개는 InBox로 옮깁니다. `:''}완료 기록은 유지되며, 보관함에서 복원할 수 있습니다.</p><div class="td-modal-actions"><span></span><div><button type="button" class="td-secondary" data-action="close-modal">취소</button><button type="submit" class="td-primary">보관</button></div></div></form>`);
    modalLayer.querySelector('[type=submit]').focus();
  }
  function rememberWorkUndo(label,run,message) {
    workUndo.push({label,run});if(workUndo.length>50)workUndo.shift();
    feedback(message,undoWorkAction);
  }
  function undoWorkAction() {
    workUndoTail=workUndoTail.catch(()=>{}).then(async()=>{
      const entry=workUndo.at(-1);if(!entry)return;
      await entry.run();const index=workUndo.lastIndexOf(entry);if(index>=0)workUndo.splice(index,1);
      feedback(`되돌림 · ${entry.label}`);focusView();
    });
    return workUndoTail;
  }
  async function nudgeTask(id) {
    const task=state.tasks.find(item=>item.id===id);if(!task||task.kind!=='waiting')return;
    const result=await mutate('task.nudge',{id});
    rememberWorkUndo(task.title,()=>mutate('task.nudgeUndo',{id,at:result.prev.at,count:result.prev.count}),`${result.repeated?'방금 재촉함':'재촉 기록'} · ${result.count}회`);
    if(!state.selected)focusTask(id);
  }
  async function deleteTask(id) {
    const task=state.tasks.find(item=>item.id===id);if(!task)return;
    const list=visibleTasks(),index=list.findIndex(item=>item.id===id);
    if(state.selected===id)state.selected=null;
    await mutate('task.delete',{id});
    rememberWorkUndo(task.title,()=>mutate('task.restore',{id}),'할 일을 삭제했어요.');
    const remaining=visibleTasks();focusTask(remaining[Math.min(index,remaining.length-1)]?.id||null);if(!remaining.length)focusView();
  }
  async function reviveTask(id) {
    const task=state.allTasks.find(item=>item.id===id);if(!task)return;
    if(task.deleted)await mutate('task.restore',{id},{renderMain:false});
    if(task.done)await mutate('task.complete',{id,done:false},{renderMain:false});
    state.tab=task.kind;state.selected=null;renderNav();renderMainView();focusTask(id);feedback('할 일을 되살렸어요.');
  }
  async function restoreProject(id) {
    await mutate('project.restore',{id,movedItemIds:projectMoves.get(id)||[]});projectMoves.delete(id);
    for(let index=workUndo.length-1;index>=0;index--)if(workUndo[index].projectId===id)workUndo.splice(index,1);
    projectCursor=String(id);state.workTrash=false;renderMainView();focusWorkProject(id);feedback('프로젝트를 복원했어요.');
  }
  async function moveWorkProject(id,direction) {
    await mutate('project.move',{id,direction});focusWorkProject(id);
  }
  function clearWorkSearch(focus=true) {
    state.workQuery='';renderMainView();if(focus)focusView();
  }
  async function subscriptions() {
    const calendars = await call('mutate', { type:'subscription.list', payload:{} });
    const list = Array.isArray(calendars) ? calendars : calendars.calendars || [];
    openModal(`<section class="td-modal" role="dialog" aria-modal="true" aria-label="캘린더 구독"><div class="td-modal-header"><h2>캘린더 구독</h2><button data-action="close-modal" aria-label="닫기">${icon('x')}</button></div><form class="subscription-form"><label class="td-field">ICS 주소<input type="url" name="url" aria-label="캘린더 구독 주소" placeholder="https://…/calendar.ics" required></label><button class="td-primary" type="submit">구독 추가</button></form><div class="subscription-list">${list.filter(c => c.kind === 'subscription').map(c => `<div class="subscription-item"><strong>${esc(c.name)}</strong><small>${esc(c.last_error || c.lastError || c.url)}</small><div><button class="td-secondary" data-sub-toggle="${c.id}">${c.enabled ? '숨기기' : '표시'}</button><button class="td-secondary" data-sub-sync="${c.id}">새로고침</button><button class="td-secondary" data-sub-delete="${c.id}">삭제</button></div></div>`).join('') || '<p class="td-empty">등록된 구독이 없어요.</p>'}</div></section>`);
  }
  function settingsView() {
    const shortcutFields = [['hotkey','WHENCOMMAND 열기','Command 단축키','Alt+Space'],['captureHotkey','할 일 빠르게 담기','빠른 수집 단축키','Control+Alt+Space']];
    return `<section class="settings-section"><h2>모양</h2><div class="minimal-appearance"><label class="td-field">스킨<select data-look="skin" aria-label="스킨">${[['base','기본'],['ink','잉크'],['paper','페이퍼']].map(([value,label]) => `<option value="${value}" ${state.skin === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="td-field">모드<select data-look="mode" aria-label="화면 모드">${[['system','시스템'],['light','라이트'],['dark','다크']].map(([value,label]) => `<option value="${value}" ${state.mode === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div></section>
    <form class="preferences-form"><section class="settings-section"><h2>단축키</h2>${shortcutFields.map(([field,label,aria,fallback]) => `<label class="td-field">${label}<input name="${field}" data-shortcut="${field}" aria-label="${aria}" aria-describedby="shortcut-error-${field}" aria-invalid="${!!state.info.shortcutErrors?.[field]}" value="${esc(state.prefs[field] ?? fallback)}" placeholder="사용 안 함" autocomplete="off" spellcheck="false"><span id="shortcut-error-${field}" class="settings-warning" data-shortcut-error="${field}" ${state.info.shortcutErrors?.[field] ? '' : 'hidden'}>${esc(state.info.shortcutErrors?.[field])}</span></label>`).join('')}<div class="settings-actions"><button class="td-primary" type="submit">단축키 저장</button><button class="td-secondary" type="button" data-action="help">단축키 안내</button></div></section></form>
    <section class="settings-section"><h2>데이터</h2><div class="settings-actions"><button class="td-secondary" data-data="importLegacy">기존 데이터 복사해 가져오기</button><button class="td-secondary" data-data="export">백업 내보내기</button><button class="td-secondary" data-data="restore">백업 복원</button><button class="td-secondary" data-data="openFolder">저장 폴더 열기</button></div><small class="settings-path">${esc(state.info.dataDir)}</small></section><section class="settings-section"><h2>WHENCOMMAND</h2><button class="td-secondary" data-action="refresh-command">검색 목록 새로고침</button></section><section class="settings-section"><h2>WHENDESK ${esc(state.info.version || '')}</h2><button class="td-secondary" data-action="quit">앱 종료</button></section>`;
  }
  function shortcutErrors(fields = {}) {
    root.querySelectorAll('[data-shortcut]').forEach(input => {
      const message = fields[input.dataset.shortcut] || '';
      input.setAttribute('aria-invalid', String(!!message));
      const label = root.querySelector(`[data-shortcut-error="${input.dataset.shortcut}"]`);
      label.textContent = message; label.hidden = !message;
    });
  }
  function recordShortcut(event) {
    const input = event.target;
    if (event.key === 'Tab') return;
    if (event.key === 'Escape') { event.preventDefault(); input.value = state.prefs[input.dataset.shortcut] ?? ''; shortcutErrors(); return; }
    if (['Control','Alt','Shift','Meta'].includes(event.key)) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ['KeyA','KeyV','KeyC','KeyX'].includes(event.code)) return;
    event.preventDefault(); if (event.repeat) return;
    if (!event.ctrlKey && !event.altKey && !event.metaKey && ['Backspace','Delete'].includes(event.key)) { input.value = ''; shortcutErrors(); return; }
    const keyMap = { Space:'Space', Enter:'Enter', Escape:'Escape', Backspace:'Backspace', Delete:'Delete', Insert:'Insert', Home:'Home', End:'End', PageUp:'PageUp', PageDown:'PageDown', ArrowUp:'Up', ArrowDown:'Down', ArrowLeft:'Left', ArrowRight:'Right', Slash:'/', Backslash:'\\', Minus:'-', Equal:'=', Semicolon:';', Quote:"'", Comma:',', Period:'.', BracketLeft:'[', BracketRight:']', Backquote:'`' };
    const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : /^F\d{1,2}$/.test(event.code) ? event.code : keyMap[event.code];
    if (!key || !event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d+$/.test(key)) return;
    input.value = [event.ctrlKey && 'Control',event.altKey && 'Alt',event.shiftKey && 'Shift',event.metaKey && 'Super',key].filter(Boolean).join('+');
    shortcutErrors();
  }
  function commandIcon(item) {
    const names = { apps:'app-window', files:'file', calc:'calculator', tasks:'circle-check', work:'circle-check', events:'calendar-days', calendar:'calendar-days', notes:'notebook-pen', scripts:'file-code', system:'settings-2', builtin:'command', siblings:'command' };
    return names[item.source] || (/^[a-z-]+$/.test(item.icon || '') ? item.icon : 'command');
  }
  function renderCommand() {
    command.selected = Math.max(0, Math.min(command.selected, Math.max(0, command.items.length-1)));
    const scrollTop = root.querySelector('#cf-command-panel').scrollTop;
    commandBox.innerHTML = `${command.items.map((item,index) => `<button id="command-option-${index}" class="td-command-result ${index === command.selected ? 'selected' : ''}" data-result="${index}" data-result-key="${esc(item.key)}" role="option" aria-selected="${index === command.selected}" tabindex="-1" ${command.running ? 'disabled' : ''}>${icon(commandIcon(item))}<span class="command-result-text"><span class="command-result-title">${esc(item.title)}</span>${item.subtitle ? `<small class="command-subtitle">${esc(item.subtitle)}</small>` : ''}</span><small>${esc(({apps:'앱',files:'파일',calc:'계산',tasks:'할 일',work:'할 일',events:'일정',calendar:'일정',notes:'메모',scripts:'명령',system:'시스템',builtin:'명령'})[item.source] || '')}</small></button>`).join('')}${command.items.length || !command.query.trim() && !command.pending ? '' : `<div class="command-empty" role="status">${command.pending ? '검색 중…' : '결과 없음'}</div>`}`;
    if(command.notice&&command.query.trim())commandBox.insertAdjacentHTML('beforeend','<div class="command-notice" role="status">'+esc(command.notice)+'</div>');
    commandBox.hidden = !!command.actions || !command.items.length && !command.query.trim() && !command.pending;
    if (command.actions) renderCommandActions();
    syncCommandSelection();
    root.querySelector('#cf-command-panel').scrollTop = scrollTop;
    icons(); resizeCommand();
  }
  function syncCommandSelection(visible = false) {
    const actions = command.actions;
    const rows = (actions ? commandActions : commandBox).querySelectorAll('[role=option]');
    const selected = actions ? actions.selected : command.selected;
    rows.forEach((element,index) => { element.classList.toggle('selected', index === selected); element.setAttribute('aria-selected', String(index === selected)); });
    commandInput.setAttribute('aria-controls', actions ? 'command-action-list' : 'command-results');
    commandInput.setAttribute('aria-expanded', String(!!rows.length));
    if (rows[selected]) commandInput.setAttribute('aria-activedescendant', rows[selected].id);
    else commandInput.removeAttribute('aria-activedescendant');
    if (visible && rows[selected]) rows[selected].scrollIntoView({ block:'nearest' });
  }
  function moveCommandSelection(delta) {
    const menu = command.actions, length = menu ? menu.item.actions.length : command.items.length;
    if (!length || command.running) return;
    if (menu) menu.selected = (menu.selected + delta + length) % length;
    else command.selected = (command.selected + delta + length) % length;
    syncCommandSelection(true);
  }
  function clearCommandOutput() {
    const output = root.querySelector('.command-output'); output.hidden = true; output.replaceChildren();
  }
  function closeCommandActions(focus = true) {
    if (!command.actions) return;
    command.actions = null; commandActions.hidden = true; commandActions.replaceChildren(); renderCommand();
    if (focus && state.shell === 'command') commandInput.focus({ preventScroll:true });
  }
  function renderCommandActions() {
    const menu = command.actions; if (!menu) return;
    commandBox.hidden = true; commandActions.hidden = false;
    commandActions.innerHTML = `<div class="command-actions-head"><span>${esc(menu.item.title)}</span><button data-action="close-actions" aria-label="동작 목록 닫기">${icon('x')}</button></div><div id="command-action-list" role="listbox" aria-label="선택한 검색 결과의 동작">${menu.item.actions.map((action,index) => `<button id="command-action-${index}" class="td-command-result ${index === menu.selected ? 'selected' : ''}" data-command-action="${esc(action.id)}" role="option" aria-selected="${index === menu.selected}" tabindex="-1" ${command.running ? 'disabled' : ''}>${icon(index ? 'corner-down-right' : 'arrow-up-right')}<span>${esc(action.title)}</span></button>`).join('')}</div>`;
  }
  function notifyCommandWaiters() { [...command.waiters].forEach(check => check()); }
  function cancelCommandActivation() { if (!command.running) { ++command.activation; notifyCommandWaiters(); } }
  function waitForCommandResults(query, seq, activation) {
    return new Promise(resolve => {
      let timer;
      const finish = value => { clearTimeout(timer); command.waiters.delete(check); resolve(value); };
      const check = () => {
        if (commandInput.value !== query || command.seq !== seq || command.activation !== activation || state.shell !== 'command' || helpOpen) finish(false);
        else if (command.items.length || !command.pending) finish(!!command.items.length);
      };
      timer = setTimeout(() => finish(false),1850); command.waiters.add(check); check();
    });
  }
  async function settleCommandQuery(waitForFiles = false, activation = command.activation) {
    clearTimeout(command.timer); command.timer = null;
    const query = commandInput.value;
    if (command.request?.query === query && command.request.seq === command.seq) await command.request.promise;
    else if (command.renderedQuery !== query) await queryCommand(query, true);
    if (waitForFiles && !command.items.length && command.pending) {
      if (!await waitForCommandResults(query,command.seq,activation) || command.items[command.selected]?.key === 'capture:fallback') return false;
    }
    return query === commandInput.value && command.renderedQuery === query && state.shell === 'command' && !helpOpen && !command.composing;
  }
  async function openCommandActions() {
    if (command.running || command.activating || !await settleCommandQuery()) return;
    if (command.actions) { closeCommandActions(); return; }
    const item = command.items[command.selected]; if (!item?.actions?.length) return;
    clearCommandOutput(); command.actions = { item, query:command.renderedQuery, selected:0 };
    renderCommand(); commandInput.focus({ preventScroll:true }); syncCommandSelection(true);
  }
  function commandNotice(message) {
    clearTimeout(commandNoticeTimer); commandInput.placeholder = message; commandInput.classList.add('has-notice');
    commandNoticeTimer = setTimeout(clearCommandNotice, 4000);
  }
  function clearCommandNotice() { clearTimeout(commandNoticeTimer); commandNoticeTimer = null; commandInput.placeholder = '검색 또는 실행'; commandInput.classList.remove('has-notice'); }
  function queueCommandQuery(query, delay = 85, force = false) {
    if (command.running || !force && query === command.query) return;
    clearTimeout(command.timer); command.timer = null;
    ++command.seq; command.request = null; command.more = null;
    notifyCommandWaiters();
    command.query = query; command.renderedQuery = null; command.items = []; command.selected = 0; command.pending = !!query.trim(); command.notice = '';
    closeCommandActions(false); clearCommandOutput(); renderCommand();
    if (!command.composing) command.timer = setTimeout(() => { command.timer = null; safe(() => queryCommand(commandInput.value)); }, query.trim() ? delay : 0);
  }
  function applyCommandMore(message) {
    if (message.seq !== command.seq || message.query != null && message.query !== command.query.trim().slice(0,8192)) return;
    if (command.request || command.running) { command.more = message; return; }
    const selectedKey = command.items[command.selected]?.key;
    if (message.replace) command.items = (message.items || []).slice(0,12);
    else { const existing = new Set(command.items.map(item => item.key)); command.items = [...command.items, ...(message.items || []).filter(item => !existing.has(item.key))].slice(0,12); }
    command.selected = Math.max(0, command.items.findIndex(item => item.key === selectedKey));
    command.pending = !!message.pending; if ('notice' in message) command.notice = message.notice || '';
    renderCommand();
    if (state.shell === 'command' && !command.actions && !helpOpen && document.activeElement === commandInput) syncCommandSelection(true);
    notifyCommandWaiters();
  }
  function queryCommand(query, preserve = false) {
    if (command.running || command.composing) return Promise.resolve(false);
    const seq = ++command.seq; command.query = query;
    const selectedKey = preserve ? command.items[command.selected]?.key : null;
    const request = { seq, query, promise:null }; command.request = request; command.more = null;
    request.promise = call('command.query', { q:query, seq }).then(result => {
      if (seq !== command.seq) return false;
      command.renderedQuery = query; command.items = (result.items || []).slice(0,12); command.pending = !!result.pending; command.notice = result.notice || '';
      command.selected = selectedKey ? Math.max(0, command.items.findIndex(item => item.key === selectedKey)) : 0;
      command.request = null; renderCommand();
      if (command.more) { const more = command.more; command.more = null; applyCommandMore(more); }
      notifyCommandWaiters();
      return true;
    }).catch(error => { if (seq !== command.seq) return false; command.request = null; command.renderedQuery = null; command.pending = false; renderCommand(); notifyCommandWaiters(); throw error; });
    return request.promise;
  }
  async function executeCommand({ index, key, alternate = false, actionId, item:pinned, query:pinnedQuery } = {}) {
    if (command.running || command.activating || command.composing) return;
    command.activating = true; const activation = ++command.activation; let cleared = false;
    try {
      if (!pinned && !await settleCommandQuery(true,activation)) return;
      const item = pinned || (key ? command.items.find(item => item.key === key) : command.items[index ?? command.selected]);
      if (!item || helpOpen || command.composing || state.shell !== 'command' || activation !== command.activation) return;
      const query = pinnedQuery ?? command.renderedQuery;
      command.running = true; commandInput.readOnly = true; root.querySelector('#cf-command-panel').setAttribute('aria-busy','true');
      closeCommandActions(false); clearCommandOutput(); renderCommand();
      await flushPending();
      const result = await call('command.run', { key:item.key, actionId:alternate ? item.altId || undefined : actionId, query });
      if (result?.cancelled) return;
      if (result?.ok === false) throw new Error(result.error || '실행하지 못했습니다.');
      if (result?.route) { await loadState({ renderMain:false }); await navigate(result.route); }
      // 머무르는 동작은 입력을 비워 같은 항목을 다시 실행하지 않게 하고, 알림은 입력줄에 띄운다.
      if (result?.clear) { commandInput.value = ''; cleared = true; }
      if (result?.message) { if (cleared && state.shell === 'command') commandNotice(result.message); else feedback(result.message); }
      if (result?.output) { const output = root.querySelector('.command-output'); output.hidden = false; output.textContent = typeof result.output === 'string' ? result.output : [result.title,result.output.stdout,result.output.stderr,result.output.code ? `종료 코드: ${result.output.code}` : ''].filter(Boolean).join('\n'); }
      if (result?.hide) await call('window.close');
    } finally {
      command.running = false; command.activating = false; commandInput.readOnly = false; root.querySelector('#cf-command-panel').removeAttribute('aria-busy');
      if (command.more) { const more = command.more; command.more = null; applyCommandMore(more); }
      if (cleared) queueCommandQuery('', 0, true);
      renderCommand(); if (state.shell === 'command' && !helpOpen) commandInput.focus({ preventScroll:true });
    }
  }
  function renderMedia(value = state.media) {
    state.media = value || { sessions:[] };
    const sessions = (state.media.sessions || []).filter(session => session.sourceAppId || session.appId);
    const playing = sessions.find(session => (session.playback?.playbackStatus ?? session.playbackInfo?.playbackStatus) === 4);
    const session = sessions.find(session => (session.sourceAppId || session.appId) === state.media.currentId) || playing || sessions[0];
    const element = root.querySelector('.td-media');
    const hadFocus = element.contains(document.activeElement);
    element.hidden = !session;
    if (!session) { if(hadFocus)commandInput.focus({preventScroll:true});element.removeAttribute('title'); }
    else {
      const id=session.sourceAppId||session.appId,media=session.media||session.mediaProps||{},playback=session.playback?.playbackStatus??session.playbackInfo?.playbackStatus,action=playback===4?'pause':'play';
      if(!element.children.length)element.innerHTML=`<button data-media-slot="prev" data-media="prev" aria-label="이전 곡">${icon('skip-back')}</button><button data-media-slot="toggle" aria-label="재생"></button><button data-media-slot="next" data-media="next" aria-label="다음 곡">${icon('skip-forward')}</button>`;
      for(const button of element.querySelectorAll('button'))button.dataset.appId=id;
      const toggle=element.querySelector('[data-media-slot=toggle]');
      if(toggle.dataset.media!==action){toggle.dataset.media=action;toggle.setAttribute('aria-label',action==='pause'?'일시정지':'재생');toggle.innerHTML=icon(action);}
      const title=media.title||session.title||'미디어';element.title=title;element.setAttribute('aria-label',`${title} 미디어 제어`);
    }
    icons(); status();
  }
  async function selectDate(value) { state.date = value; const year = +value.slice(0,4), month = +value.slice(5,7)-1; if (year !== state.year || month !== state.month) { state.year = year; state.month = month; await loadState({ renderMain:false }); } renderCalendar(); if (state.view === 'calendar') renderMainView(); }

  function controlSelector(element) {
    const target=element?.closest?.('button,[data-task-row]');if(!target)return null;
    for(const [key,attribute]of [['action','data-action'],['tab','data-tab'],['project','data-project'],['task','data-task'],['date','data-date'],['event','data-event'],['taskRow','data-task-row']])if(target.dataset[key]!=null)return `[${attribute}="${CSS.escape(target.dataset[key])}"]`;
    return null;
  }
  function editingTarget(element) {return element?.matches?.('input:not([type=checkbox]),textarea,select,[contenteditable=true]');}
  function syncTaskCursor() {
    const rows=[...body.querySelectorAll('[data-task-row]')];if(!rows.some(row=>row.dataset.taskRow===taskCursor))taskCursor=rows[0]?.dataset.taskRow||null;
    rows.forEach(row=>{const selected=row.dataset.taskRow===taskCursor;row.tabIndex=selected?0:-1;row.classList.toggle('keyboard-current',selected);row.querySelector('[data-task]')?.setAttribute('tabindex','-1');});
  }
  function syncProjectCursor() {
    const rows=[...body.querySelectorAll('[data-work-project-row]')];
    if(!rows.some(row=>row.dataset.workProjectRow===String(projectCursor)))projectCursor=rows[0]?.dataset.workProjectRow||null;
    rows.forEach(row=>{row.tabIndex=row.dataset.workProjectRow===String(projectCursor)?0:-1;});
  }
  function focusWorkProject(id=projectCursor) {
    projectCursor=id==null?null:String(id);syncProjectCursor();
    const row=body.querySelector(`[data-work-project-row="${CSS.escape(projectCursor||'')}"]`);
    row?.focus({preventScroll:true});row?.scrollIntoView({block:'nearest'});
    if(!row)root.querySelector('.td-work-nav [aria-selected=true]')?.focus({preventScroll:true});
  }
  function focusTask(id=taskCursor) {
    taskCursor=id;syncTaskCursor();if(taskCursor)workCursors.set(workCursorKey(),taskCursor);const row=body.querySelector(`[data-task-row="${CSS.escape(taskCursor||'')}"]`);row?.focus({preventScroll:true});row?.scrollIntoView({block:'nearest'});
  }
  function workCursorKey(){return `${state.tab}|${state.project??''}`;}
  function focusView() {
    if(state.view==='notes'){notes?.focus();return;}
    if(state.view==='tasks'){if(state.tab==='projects'){focusWorkProject();return;}syncTaskCursor();if(taskCursor)focusTask();else root.querySelector('.td-work-nav [aria-selected=true]')?.focus({preventScroll:true});return;}
    if(state.view==='calendar'){body.querySelector(`[data-date="${state.date}"]`)?.focus({preventScroll:true});return;}
    if(state.view==='settings'){body.querySelector('[data-look]')?.focus({preventScroll:true});return;}
    body.querySelector('[data-reveal],.cf-entry,button')?.focus({preventScroll:true});
  }
  /* 화면 안의 필터·하위 화면을 하나 푼다. 푼 것이 있으면 true. */
  function clearViewFilter() {
    if(state.view!=='tasks')return false;
    if(state.workQuery){clearWorkSearch();return true;}
    if(state.workTrash){state.workTrash=false;projectCursor=null;renderMainView();focusView();return true;}
    if(state.project&&state.tab!=='projects'){state.project=null;renderMainView();focusView();return true;}
    if(state.dueOnly){state.dueOnly=false;renderMainView();focusView();return true;}
    return false;
  }
  /* Esc는 맨 위 하나만 끝낸다: 실행 대기 → 동작 목록 → 대화상자 → 편집 → 필터·하위 화면 → 화면 기본 자리 → Command → 입력 지우기 → 숨기기. */
  async function escapeStep() {
    if(command.activating&&!command.running)return cancelCommandActivation();
    if(command.actions)return closeCommandActions();
    if(!modalLayer.hidden)return closeModalSafely();
    if(state.shell==='dashboard'){
      if(state.view==='tasks'&&state.selected)return collapseTaskEditor();
      if(clearViewFilter())return;
      const before=document.activeElement;focusView();
      if(document.activeElement!==before&&document.activeElement!==document.body)return;
      await flushPending();return shell('command');
    }
    if(!root.querySelector('.command-output').hidden){clearCommandOutput();resizeCommand();return;}
    if(commandInput.value){commandInput.value='';clearCommandNotice();queueCommandQuery('',0,true);return;}
    return call('window.close');
  }
  async function goSection(section) {
    const route={settings:{settings:true,view:'settings'},dashboard:{view:'dashboard'},todo:{view:'tasks',tab:'todo'},inbox:{view:'tasks',tab:'inbox'},waiting:{view:'tasks',tab:'waiting'},done:{view:'tasks',tab:'done'},notes:{view:'notes'},calendar:{view:'calendar'}}[section];
    if(!route)return;await flushPending();state.project=null;state.selected=null;dashboardReturn=null;dashboardFocus=null;await navigate(route);focusView();
  }
  async function newInContext() {
    if(state.shell==='command'||state.view==='dashboard'||state.view==='settings')await goSection('inbox');
    if(state.view==='notes'){await notes?.create();return;}
    if(state.view==='calendar'){eventModal();return;}
    if(state.view==='tasks'&&state.tab==='projects'){projectModal();return;}
    root.querySelector('.td-quick input')?.focus();
  }
  async function openTaskField(id,field='title') {await flushPending();if(!state.tasks.some(task=>task.id===id))return;state.selected=id;renderMainView();body.querySelector(`[data-editor="${CSS.escape(id)}"] [data-field="${field}"]`)?.focus({preventScroll:true});}
  async function collapseTaskEditor() {const id=state.selected;await flushPending();state.selected=null;renderMainView();focusTask(id);}
  async function taskKeyboardAction(id,action) {
    const task=visibleTasks().find(item=>item.id===id);if(!task)return;
    if(task.archived){if(['open','complete'].includes(action))return reviveTask(id);return;}
    const before=visibleTasks(),index=before.findIndex(item=>item.id===id);
    if(action==='open')return openTaskField(id);
    if(action==='due')return dueModal(id);
    if(['title','note','project_id','kind'].includes(action))return openTaskField(id,action);
    if(action==='nudge')return nudgeTask(id);
    if(action==='waiting')return waitingModal(id);
    if(action==='complete'){await mutate('task.complete',{id,done:!task.done});feedback(task.done?'완료를 해제했어요.':'완료했어요.');}
    if(action==='delete')return deleteTask(id);
    const after=visibleTasks();if(!after.some(item=>item.id===state.selected))state.selected=null;focusTask(after[Math.min(Math.max(index,0),after.length-1)]?.id||null);
  }
  async function undoLastAction() {if(state.view==='tasks'&&workUndo.length)return undoWorkAction();const action=undoAction;if(!action)return;await action();undoAction=null;root.querySelector('.td-feedback').hidden=true;focusView();}
  function listStep(event) {
    if(K.is(event,'list.up'))return -1;if(K.is(event,'list.down'))return 1;if(K.is(event,'list.pageUp'))return -10;if(K.is(event,'list.pageDown'))return 10;
    if(K.is(event,'list.first'))return 'first';if(K.is(event,'list.last'))return 'last';return 0;
  }
  const TASK_ACTIONS=[['task.open','open'],['task.complete','complete'],['task.delete','delete'],['task.title','title'],['task.due','due'],['task.note','note'],['task.project','project_id'],['task.waiting','waiting'],['task.nudge','nudge'],['work.undo','undo']];
  const TAB_MOVES=['work.tab.prev','work.tab.next','work.tab.first','work.tab.last'];
  const PROJECT_ACTIONS=['project.add','project.trash','project.open','project.rename','project.archive'];
  const DAY_MOVES={'date.prev':[-1,0],'date.next':[1,0],'date.prevWeek':[-7,0],'date.nextWeek':[7,0],'date.prevMonth':[0,-1],'date.nextMonth':[0,1],'date.today':[0,0]};
  function workKeys(event) {
    if(state.view!=='tasks')return false;
    const target=event.target,mod=event.ctrlKey||event.metaKey,main=root.querySelector('.td-main');
    if(!main.contains(target))return false;
    const tab=target.closest('.td-work-nav [data-tab]'),row=target.closest('[data-task-row]'),projectRow=target.closest('[data-work-project-row]');
    if(target.matches('[data-work-search]')) {
      if(K.is(event,'work.search.leave')){event.preventDefault();focusView();return true;}
      if(K.is(event,'back')){event.preventDefault();if(state.workQuery)clearWorkSearch();else focusView();return true;}
    }
    if(target.closest('.td-quick')&&K.is(event,'back')){event.preventDefault();focusView();return true;}
    if(target.matches('.td-quick input')&&K.is(event,'work.quick.leave')){event.preventDefault();focusView();return true;}
    if(K.is(event,'work.search')&&(mod||!editingTarget(target))) {
      event.preventDefault();const input=body.querySelector('[data-work-search]');input?.focus();input?.select();return true;
    }
    if(editingTarget(target))return false;
    if(row&&state.selected===row.dataset.taskRow&&K.is(event,'focus.cycle'))return false;
    if(K.is(event,'work.tab.cycle')&&(tab||row||projectRow)){event.preventDefault();if(!event.repeat)safe(()=>cycleWorkTab(event.shiftKey?-1:1));return true;}
    if(tab&&K.is(event,'work.tab.enter')){event.preventDefault();focusView();return true;}
    const tabMove=tab&&TAB_MOVES.find(id=>K.is(event,id));
    if(tabMove) {
      event.preventDefault();safe(()=>tabMove==='work.tab.first'||tabMove==='work.tab.last'?switchWorkTab(tabMove==='work.tab.first'?'inbox':'projects',{focus:'tab'}):cycleWorkTab(tabMove==='work.tab.prev'?-1:1,{focus:'tab'}));return true;
    }
    if(K.is(event,'back')&&state.workQuery){event.preventDefault();clearWorkSearch();return true;}
    if(state.tab==='projects'&&!mod&&!event.altKey) {
      const rows=[...body.querySelectorAll('[data-work-project-row]')];if(projectRow)projectCursor=projectRow.dataset.workProjectRow;
      const id=Number(projectCursor),move=K.is(event,'project.moveUp')?'up':K.is(event,'project.moveDown')?'down':null;
      if(move&&!state.workTrash){event.preventDefault();if(id)safe(()=>moveWorkProject(id,move));return true;}
      const step=listStep(event);
      if(step){event.preventDefault();let index=Math.max(0,rows.findIndex(item=>item.dataset.workProjectRow===String(projectCursor)));index=step==='first'?0:step==='last'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+step));focusWorkProject(rows[index]?.dataset.workProjectRow);return true;}
      const action=PROJECT_ACTIONS.find(item=>K.is(event,item));
      if(action) {
        event.preventDefault();if(event.repeat)return true;
        if(action==='project.add')projectModal();
        else if(action==='project.trash'){state.workTrash=!state.workTrash;projectCursor=null;renderMainView();focusWorkProject();}
        else if(state.workTrash&&action==='project.open'&&id)safe(()=>restoreProject(id));
        else if(!state.workTrash&&action==='project.rename'&&id)projectModal(id);
        else if(!state.workTrash&&action==='project.archive'&&id)archiveProjectModal(id);
        else if(!state.workTrash&&action==='project.open'&&id)safe(async()=>{state.project=id;await switchWorkTab('todo');});
        return true;
      }
    }
    if((row||tab)&&state.tab==='todo'&&K.is(event,'work.dueFilter')){event.preventDefault();state.dueOnly=!state.dueOnly;renderMainView();focusView();return true;}
    if((row||tab)&&K.is(event,'work.doneHistory')){event.preventDefault();safe(()=>switchWorkTab('done'));return true;}
    if(K.is(event,'work.undo')){event.preventDefault();safe(undoLastAction);return true;}
    return false;
  }
  async function moveCalendarDate(days,months=0,side=false,todayOnly=false) {
    const current=new Date(state.date+'T12:00:00');let next;
    if(todayOnly)next=new Date();
    else if(months){const day=Math.min(current.getDate(),new Date(current.getFullYear(),current.getMonth()+months+1,0).getDate());next=new Date(current.getFullYear(),current.getMonth()+months,day);}
    else{next=new Date(current);next.setDate(next.getDate()+days);}
    await selectDate(dateKey(next));const area=side?root.querySelector('.td-calendar-side'):body;area.querySelector(`[data-date="${state.date}"]`)?.focus({preventScroll:true});
  }
  function workspaceKeys(event) {
    const target=event.target;
    if(state.shell!=='dashboard'){
      if(K.is(event,'app.new')){event.preventDefault();if(!event.repeat)safe(newInContext);return true;}return false;
    }
    if(state.view==='notes'&&notes?.handleKeydown(event))return true;
    if(K.is(event,'project.new')&&['tasks','dashboard'].includes(state.view)){event.preventDefault();if(!event.repeat)projectModal();return true;}
    if(K.is(event,'app.new')){event.preventDefault();if(!event.repeat)safe(newInContext);return true;}
    if(K.is(event,'app.save')){event.preventDefault();if(state.view==='settings')body.querySelector('.preferences-form')?.requestSubmit();else safe(flushPending);return true;}
    if(K.is(event,'app.undo')&&!editingTarget(target)){event.preventDefault();safe(undoLastAction);return true;}
    if(workKeys(event))return true;
    const day=target.closest('[data-date]');
    if(day){
      const dayMove=Object.keys(DAY_MOVES).find(id=>K.is(event,id)),side=!!day.closest('.td-calendar-side');
      if(dayMove){event.preventDefault();const [days,months]=DAY_MOVES[dayMove];safe(()=>moveCalendarDate(days,months,side,dayMove==='date.today'));return true;}
      if(K.is(event,'date.open')){event.preventDefault();const area=side?root.querySelector('.td-calendar-side'):body;const first=area.querySelector('[data-event]');if(first)first.focus();else eventModal();return true;}
      if(K.is(event,'event.new')){event.preventDefault();eventModal();return true;}
    }
    const eventButton=target.closest('[data-event]');
    if(eventButton&&!editingTarget(target)){
      const step=K.is(event,'agenda.up')?-1:K.is(event,'agenda.down')?1:K.is(event,'agenda.first')?'first':K.is(event,'agenda.last')?'last':0;
      if(step){event.preventDefault();const area=eventButton.closest('.td-main-calendar-agenda,.td-day-detail')||body;const rows=[...area.querySelectorAll('[data-event]')],index=rows.indexOf(eventButton);const next=step==='first'?0:step==='last'?rows.length-1:(index+(step===1?1:rows.length-1))%rows.length;rows[next]?.focus();return true;}
      if(K.is(event,'event.edit')){event.preventDefault();eventModal(eventButton.dataset.event);return true;}
      if(K.is(event,'event.delete')){event.preventDefault();const item=findEvent(eventButton.dataset.event);if(item&&!item.readonly){eventModal(eventButton.dataset.event);const scope=modalLayer.querySelector('[name=scope]');if(scope)scope.value='one';modalLayer.querySelector('[data-action=delete-event]')?.focus();}return true;}
    }
    if(state.view==='tasks'){
      const row=target.closest('[data-task-row]'),rows=[...body.querySelectorAll('[data-task-row]')];
      if(row)taskCursor=row.dataset.taskRow;
      if(row&&state.selected===row.dataset.taskRow&&K.is(event,'task.collapse')){event.preventDefault();safe(collapseTaskEditor);return true;}
      if(row&&editingTarget(target)){
        if(K.is(event,'task.collapse')){event.preventDefault();safe(collapseTaskEditor);return true;}return false;
      }
      if((row||target.closest('.td-work-nav'))&&!editingTarget(target)&&rows.length){
        let index=rows.findIndex(item=>item.dataset.taskRow===taskCursor);if(index<0)index=0;
        const step=listStep(event);
        if(step){event.preventDefault();index=step==='first'?0:step==='last'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+step));focusTask(rows[index].dataset.taskRow);return true;}
        if(row){
          const action=TASK_ACTIONS.find(([id])=>K.is(event,id))?.[1];
          if(action){event.preventDefault();if(!event.repeat)safe(()=>action==='undo'?undoLastAction():taskKeyboardAction(taskCursor,action));return true;}
        }
      }
    }
    return false;
  }

  root.addEventListener('click', event => safe(async () => {
    const button = event.target.closest('button'); if (!button) { if (event.target === modalLayer) closeModal(); return; }
    const data = button.dataset;
    if (data.action === 'close-help') return closeHelp();
    if (data.tab) return switchWorkTab(data.tab,{focus:button.closest('.td-work-nav')?'tab':'list',clearProject:state.view!=='tasks'});
    if (button.classList.contains('td-drag-handle')) return;
    if (data.task) { taskCursor=data.task; if(state.selected===data.task)await collapseTaskEditor();else await openTaskField(data.task);return; }
    if (data.reveal) return reveal(data.reveal);
    if (data.editDue) return dueModal(data.editDue);
    if (data.reviveTask) return reviveTask(data.reviveTask);
    if (data.date) {const side=!!button.closest('.td-calendar-side');await selectDate(data.date);(side?root.querySelector('.td-calendar-side'):body).querySelector(`[data-date="${state.date}"]`)?.focus({preventScroll:true});return;}
    if (data.month) {const side=!!button.closest('.td-calendar-side');await moveCalendarDate(0,Number(data.month),side);(side?root.querySelector('.td-calendar-side'):body).querySelector(`[data-month="${data.month}"]`)?.focus({preventScroll:true});return;}
    if (data.project) { await flushPending(); state.project=Number(data.project); state.view='tasks'; state.tab='todo'; state.selected=null; renderNav(); renderMainView(); focusView();return; }
    if (data.editProject) return projectModal(Number(data.editProject));
    if (data.archiveProject) return archiveProjectModal(Number(data.archiveProject));
    if (data.restoreProject) return restoreProject(Number(data.restoreProject));
    if (data.projectLabel) return restoreProject(Number(data.projectLabel));
    if (data.moveProject) return moveWorkProject(Number(data.moveProject),data.direction);
    if (data.event) return eventModal(data.event);
    if (data.result !== undefined) return executeCommand({ key:data.resultKey });
    if (data.commandAction && command.actions) return executeCommand({ item:command.actions.item, query:command.actions.query, actionId:data.commandAction });
    if (data.deleteTask) return deleteTask(data.deleteTask);
    if (data.nudge) return nudgeTask(data.nudge);
    if (data.subToggle || data.subSync || data.subDelete) { const id=Number(data.subToggle||data.subSync||data.subDelete); await mutate(data.subToggle?'subscription.toggle':data.subSync?'subscription.sync':'subscription.delete',{id}); return subscriptions(); }
    if (data.media) { await call('media.control',{action:data.media,appId:data.appId}); return; }
    if (data.data) { await flushPending(); const result=await call('data.'+data.data); if(result?.ok===false)throw new Error(result.error||'데이터 작업을 완료하지 못했습니다.'); if (!result?.cancelled) { if(result?.preferences){state.prefs=result.preferences;state.skin=result.preferences.skin;state.mode=result.preferences.mode;look();state.info=await call('app.info');} await loadState(); if(['restore','importLegacy'].includes(data.data)){workUndo.length=0;projectMoves.clear();state.workQuery='';state.workTrash=false;state.selected=null;taskCursor=null;projectCursor=null;await notes?.refresh({reset:true});renderMainView();} if (result?.message) feedback(result.message); } return; }
    switch(data.action) {
      case 'switch-shell': await flushPending(); return shell(state.shell==='command'?'dashboard':'command');
      case 'home': await flushPending(); state.view='dashboard'; renderNav(); renderMainView(); await shell('dashboard',false);focusView();break;
      case 'work': await flushPending(); state.view='tasks'; state.project=null; state.selected=null; renderNav(); renderMainView(); await shell('dashboard',false); focusView();break;
      case 'calendar': await flushPending(); state.view='calendar'; renderNav(); renderMainView(); await shell('dashboard',false);focusView();break;
      case 'notes': return navigate({view:'notes'});
      case 'command': return shell('command');
      case 'collapse': await collapseTaskEditor(); break;
      case 'new-project': projectModal(); break;
      case 'work-project-trash': state.workTrash=!state.workTrash;projectCursor=null;renderMainView();focusWorkProject();break;
      case 'clear-work-search': clearWorkSearch();break;
      case 'today': {const side=!!button.closest('.td-calendar-side');await moveCalendarDate(0,0,side,true);break;}
      case 'new-event': eventModal(); break;
      case 'close-modal': closeModal(); break;
      case 'delete-event': { const selected=editingEvent; if (!selected || selected.readonly) return; const scope=modalLayer.querySelector('[name=scope]')?.value || 'all'; await mutate('event.delete',{id:selected.id,scope,recurrenceId:selected.recurrenceId||selected.startsAt}); closeModal(); feedback('일정을 삭제했어요.',()=>mutate('event.restore',{id:selected.id})); break; }
      case 'undo': { const action=undoAction; if(action){ await action(); root.querySelector('.td-feedback').hidden=true; undoAction=null; } break; }
      case 'dismiss': root.querySelector('.td-feedback').hidden=true; break;
      case 'settings': await flushPending(); state.prefs=await call('preferences.get'); state.info=await call('app.info'); state.view='settings'; renderNav(); renderMainView(); await shell('dashboard',false); focusView();break;
      case 'help': return openHelp();
      case 'close-actions': closeCommandActions(); break;
      case 'subscriptions': await subscriptions(); break;
      case 'import-ics': { const input=document.createElement('input');input.type='file';input.accept='.ics,text/calendar';input.addEventListener('change',()=>safe(async()=>{const file=input.files[0];if(file){await mutate('ics.import',{text:await file.text(),name:file.name});feedback('ICS 일정을 가져왔어요.');}}));input.click();break; }
      case 'export-ics': { const result=await call('data.exportIcs');if(!result?.cancelled)feedback(result?.message||'ICS 파일을 내보냈어요.');break; }
      case 'refresh-command': await call('command.refresh');await queryCommand(command.query,true);feedback('검색 목록을 새로 읽었어요.');break;
      case 'minimize': cancelCommandActivation();await flushPending();await call('window.minimize');break;
      case 'close-window': cancelCommandActivation();await flushPending();await call('window.close');break;
      case 'quit': await flushPending();await call('app.quit');break;
    }
  }));
  root.addEventListener('input', event => {
    const element=event.target;
    if (element===commandInput) { queueCommandQuery(element.value); return; }
    if (element.matches('[data-shortcut]')) { shortcutErrors(); return; }
    if (element.matches('[data-work-search]')) {state.workQuery=element.value;state.selected=null;taskCursor=null;projectCursor=null;if(!event.isComposing&&!workComposing)renderMainView();return;}
    if (element.matches('[data-field]') && ['title','note','waitingFor'].includes(element.dataset.field)) {
      const id=element.closest('[data-editor]').dataset.editor;
      queueTask(id,{[element.dataset.field]:element.value});
      if(element.dataset.field==='title')element.closest('.td-task').querySelector('[data-check]').setAttribute('aria-label',element.value+' 완료');
    }
  });
  root.addEventListener('change', event => safe(async()=>{
    const element=event.target;
    if(element.dataset.look){state[element.dataset.look]=element.value;look();await call('preferences.set',{[element.dataset.look]:element.value});return;}
    if(element.dataset.check){await mutate('task.complete',{id:element.dataset.check,done:element.checked});return;}
    if(element.matches('[data-work-project-filter]')){await flushPending();state.project=element.value==='unassigned'?'unassigned':Number(element.value)||null;state.selected=null;taskCursor=null;renderMainView();return;}
    if(element.matches('[data-work-sort]')){state.workSort=element.value;renderMainView();return;}
    if(element.matches('[data-work-range]')){state.workRange=element.value?Number(element.value):null;renderMainView();return;}
    if(element.matches('[data-due-only]')){state.dueOnly=element.checked;renderMainView();return;}
    if(element.matches('[data-field]') && ['kind','due','project_id'].includes(element.dataset.field)) {
      const id=element.closest('[data-editor]').dataset.editor;const field=element.dataset.field;const value=field==='project_id'?(element.value?Number(element.value):null):element.value;
      const activeAtRequest=document.activeElement,updated=await mutate('task.update',{id,[field]:value},{renderMain:false});
      if(field==='due') {const due=element.closest('.td-task')?.querySelector('.td-due'),badge=workRules.dueBadge(value);if(due){due.textContent=badge?.text||'마감 없음';due.title=value||'마감 없음';due.classList.toggle('today',badge?.cls==='today');due.classList.toggle('work-overdue',badge?.cls==='over');}return;}
      if(state.view!=='tasks'||state.selected!==id||!element.isConnected)return;
      const activeAfterSave=document.activeElement,focus=captureFocus(),sameControl=activeAfterSave===activeAtRequest;
      if(field==='kind'||field==='project_id'&&updated.kind!==state.tab&&state.tab!=='done')state.tab=updated.kind;
      if(field==='project_id'&&state.project&&state.project!==updated.project_id)state.project=null;
      renderNav();renderMainView();if(focus)restoreFocus(focus);else if(sameControl)body.querySelector(`[data-editor="${CSS.escape(id)}"] [data-field="${field}"]`)?.focus({preventScroll:true});else if(activeAfterSave?.isConnected)activeAfterSave.focus({preventScroll:true});
    }
  }));
  root.addEventListener('submit',event=>{
    if(!event.target.matches('.td-quick,.event-form,.project-form,.subscription-form,.preferences-form,.calendar-natural,.work-due-form,.work-waiting-form,.work-archive-form'))return;
    event.preventDefault();
    const submittingForm=event.target;if(submittingForm.dataset.submitting==='true')return;
    submittingForm.dataset.submitting='true';const submitButton=submittingForm.querySelector('[type=submit]');if(submitButton)submitButton.disabled=true;
    safe(async()=>{
      const form=event.target;
      if(form.matches('.td-quick')){const input=form.querySelector('input');const title=input.value.trim();if(!title)return;input.disabled=true;let result;try{result=await addTask(title);input.value='';}finally{input.disabled=false;if(result?.followed)focusTask(result.id);else if(!result)input.focus();}return;}
      const values=Object.fromEntries(new FormData(form).entries());
      if(form.matches('.work-due-form')){
        const id=form.dataset.taskId,previous=state.tasks.find(task=>task.id===id)?.due||'';
        await mutate('task.setDue',{id,text:values.text});closeModal();
        rememberWorkUndo('마감일',()=>mutate('task.update',{id,due:previous}),'마감을 변경했어요.');return;
      }
      if(form.matches('.work-waiting-form')){
        const id=form.dataset.taskId,task=state.tasks.find(task=>task.id===id),previous={kind:task.kind,waitingFor:task.waitingFor};
        await mutate('task.update',{id,kind:'waiting',waitingFor:values.waitingFor});state.tab='waiting';state.selected=null;renderNav();renderMainView();closeModal();focusTask(id);
        rememberWorkUndo(task.title,()=>mutate('task.update',{id,...previous}),'대기로 옮겼어요.');return;
      }
      if(form.matches('.work-archive-form')){
        const id=Number(form.dataset.projectId),project=state.projects.find(item=>item.id===id),result=await mutate('project.archive',{id});
        projectMoves.set(id,result.movedItemIds||[]);
        if(state.project===id)state.project=null;state.selected=null;closeModal();renderMainView();focusView();
        rememberWorkUndo(project.name,()=>mutate('project.restore',{id,movedItemIds:result.movedItemIds}),'프로젝트를 보관했어요.');workUndo.at(-1).projectId=id;return;
      }
      if(form.matches('.event-form')){
        const payload={...values,allDay:form.querySelector('[name=allDay]').checked};
        if(!payload.allDay && payload.end<=payload.time){const end=form.querySelector('[name=end]');end.setCustomValidity('종료 시간을 시작 시간 이후로 정해주세요.');end.reportValidity();end.addEventListener('input',()=>end.setCustomValidity(''),{once:true});return;}
        if(editingEvent){payload.id=editingEvent.id;payload.recurrenceId=editingEvent.recurrenceId||editingEvent.startsAt;}
        const result=await mutate(editingEvent?'event.update':'event.create',payload);await selectDate(payload.date);closeModal();feedback('일정을 저장했어요.');return result;
      }
      if(form.matches('.project-form')){const id=Number(form.dataset.projectId)||null,result=await mutate(id?'project.update':'project.create',{...(id?{id}:{}),name:values.name.trim()});if(state.tab==='projects')projectCursor=String(result.id);closeModal();if(state.view==='tasks'&&state.tab==='projects')focusWorkProject();return;}
      if(form.matches('.subscription-form')){const result=await mutate('subscription.add',{url:values.url});await subscriptions();if(result?.error)feedback(result.error,null,true);return;}
      if(form.matches('.preferences-form')){const submit=form.querySelector('[type=submit]'),field=document.activeElement?.name;submit.disabled=true;try{state.prefs=await call('preferences.set',values);state.info=await call('app.info');renderMainView();(field?body.querySelector(`.preferences-form [name="${CSS.escape(field)}"]`):body.querySelector('.preferences-form [type=submit]'))?.focus();feedback('단축키를 저장했어요.');}catch(error){shortcutErrors(error.fields||{});form.querySelector('[aria-invalid=true]')?.focus();feedback(error.message,null,true);}finally{if(submit.isConnected)submit.disabled=false;}return;}
      if(form.matches('.calendar-natural')){const result=await call('mutate',{type:'calendar.parse',payload:{text:values.line,line:values.line}});const parsed=result.parsed||result;if(parsed.ok===false||!parsed.startsAt)throw new Error(parsed.error||'일정을 해석하지 못했습니다. 날짜와 시간을 확인해 주세요.');eventModal(null,parsed);}
    }).finally(()=>{delete submittingForm.dataset.submitting;if(submitButton?.isConnected)submitButton.disabled=false;});
  });
  commandInput.addEventListener('focus',()=>{if(command.renderedQuery!==commandInput.value&&!command.request&&!command.timer&&!command.composing)safe(()=>queryCommand(commandInput.value,true));});
  root.addEventListener('compositionstart',event=>{if(event.target.matches('[data-work-search]'))workComposing=true;});
  modalLayer.addEventListener('input',()=>{modalDirty=true;});modalLayer.addEventListener('change',()=>{modalDirty=true;});
  commandInput.addEventListener('input',()=>{if(commandInput.classList.contains('has-notice'))clearCommandNotice();});
  root.addEventListener('compositionend',event=>{if(event.target.matches('[data-work-search]')){workComposing=false;state.workQuery=event.target.value;renderMainView();}});
  commandInput.addEventListener('compositionstart',()=>{command.composing=true;cancelCommandActivation();clearTimeout(command.timer);command.timer=null;++command.seq;command.request=null;});
  commandInput.addEventListener('compositionend',()=>{command.composing=false;queueCommandQuery(commandInput.value,0,true);});
  commandBox.addEventListener('pointermove',event=>{const row=event.target.closest('[data-result]');if(row&&!command.running&&!command.actions&&command.selected!==Number(row.dataset.result)){command.selected=Number(row.dataset.result);syncCommandSelection();}});
  commandActions.addEventListener('pointermove',event=>{const row=event.target.closest('[data-command-action]');if(row&&command.actions&&!command.running){const index=command.actions.item.actions.findIndex(action=>action.id===row.dataset.commandAction);if(index>=0&&index!==command.actions.selected){command.actions.selected=index;syncCommandSelection();}}});
  root.addEventListener('focusout',event=>{if(event.target.matches('[data-field]')){const element=event.target;dashboardFocus={id:element.closest('[data-editor]')?.dataset.editor,field:element.dataset.field,start:element.selectionStart,end:element.selectionEnd,scroll:element.scrollTop};}});
  document.addEventListener('keydown',event=>{
    if(event.isComposing||event.keyCode===229||command.composing)return;
    const section=K.section(event);
    const reservedFieldKey=K.is(event,'app.save')||K.is(event,'help.toggle')||!!section;
    if(event.target.matches('[data-shortcut]')&&!helpOpen&&!reservedFieldKey){recordShortcut(event);return;}
    if(K.is(event,'help.toggle')){event.preventDefault();if(!event.repeat)safe(()=>helpOpen?closeHelp():openHelp());return;}
    if(helpOpen){if(K.is(event,'back')){event.preventDefault();safe(closeHelp);}else if(K.is(event,'focus.cycle')){event.preventDefault();helpLayer.querySelector('button')?.focus();}return;}
    if(section){event.preventDefault();if(!event.repeat&&modalLayer.hidden&&!command.running)safe(()=>goSection(section));return;}
    if(K.is(event,'command.open')){event.preventDefault();if(!event.repeat&&modalLayer.hidden&&!command.running){cancelCommandActivation();safe(async()=>{const same=state.shell==='command';await flushPending();await shell('command');if(same)commandInput.select();});}return;}
    if(!modalLayer.hidden&&K.is(event,'focus.cycle')){
      const focusable=[...modalLayer.querySelectorAll('button,input,select,textarea,[tabindex]')].filter(element=>!element.disabled&&element.tabIndex>=0&&element.getClientRects().length);
      const first=focusable[0],last=focusable.at(-1);
      if(!first){event.preventDefault();return;}
      if(event.shiftKey&&(event.target===first||!modalLayer.contains(event.target))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(event.target===last||!modalLayer.contains(event.target))){event.preventDefault();first.focus();}
      return;
    }
    if(!modalLayer.hidden&&K.is(event,'app.save')){event.preventDefault();const form=modalLayer.querySelector('form');if(!event.repeat&&form?.querySelector('[type=submit]')&&!form.querySelector('[type=submit]').disabled)form.requestSubmit();return;}
    if(modalLayer.hidden&&workspaceKeys(event))return;
    const inCommandInput=state.shell==='command'&&event.target===commandInput;
    if(inCommandInput&&K.is(event,'command.media')&&!root.querySelector('.td-media').hidden){event.preventDefault();root.querySelector('.td-media [data-media-slot=next]')?.focus();return;}
    if(inCommandInput&&K.is(event,'command.expand')){event.preventDefault();if(!command.running&&!command.activating)safe(()=>shell('dashboard'));return;}
    if(K.is(event,'back')){event.preventDefault();if(!event.repeat)safe(escapeStep);return;}
    if(state.shell==='command'&&(event.target===commandInput||commandBox.contains(event.target)||commandActions.contains(event.target))){
      if(K.is(event,'command.run')||K.is(event,'command.alternate')||K.is(event,'command.actions')){
        event.preventDefault();if(event.repeat||command.running||command.activating)return;
        if(K.is(event,'command.actions')){safe(openCommandActions);return;}
        const menu=command.actions;
        safe(()=>menu?executeCommand({item:menu.item,query:menu.query,actionId:menu.item.actions[menu.selected]?.id}):executeCommand({alternate:K.is(event,'command.alternate')}));return;
      }
      const step=K.is(event,'command.next')?1:K.is(event,'command.prev')?-1:0;
      if(step){event.preventDefault();moveCommandSelection(step);return;}
    }
  });
  root.addEventListener('dragstart',event=>{const item=event.target.closest('[data-task][draggable]');if(item){event.dataTransfer.setData('text/plain',item.dataset.task);event.dataTransfer.effectAllowed='move';}});
  root.addEventListener('dragover',event=>{const target=event.target.closest('[data-date]');if(target){event.preventDefault();target.classList.add('drag-over');event.dataTransfer.dropEffect='move';}});
  root.addEventListener('dragleave',event=>event.target.closest('[data-date]')?.classList.remove('drag-over'));
  root.addEventListener('drop',event=>{const target=event.target.closest('[data-date]');if(target){event.preventDefault();safe(()=>changeDue(event.dataTransfer.getData('text/plain'),target.dataset.date));}});
  api.on('command.more',message=>{if(message.ready){if(!command.running&&!command.activating&&!command.actions&&!command.composing)safe(()=>queryCommand(commandInput.value,true));return;}if(message.error){command.notice=message.error;renderCommand();return;}applyCommandMore(message);});
  api.on('navigate',route=>safe(()=>navigate(route)));
  api.on('media.changed',media=>renderMedia(media));
  api.on('state.changed',()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>safe(()=>loadState({renderMain:!helpOpen&&pending.size===0&&!body.contains(document.activeElement)})),70);});
  window.addEventListener('beforeunload',()=>{if(pending.size||notes?.hasPending())safe(flushPending);});
  new ResizeObserver(()=>resizeCommand()).observe(root.querySelector('#cf-command-panel'));
  async function init(){
    try{
      const results=await Promise.allSettled([call('preferences.get'),call('app.info'),call('media.state')]);
      if(results[0].status==='fulfilled'){state.prefs=results[0].value||{};state.skin=state.prefs.skin||'base';state.mode=state.prefs.mode||'system';}
      if(results[1].status==='fulfilled')state.info=results[1].value||{};
      document.title = state.info.isPackaged === false ? 'WHENDESK 개발본' : 'WHENDESK';
      look();await loadState();if(results[2].status==='fulfilled')renderMedia(results[2].value);else renderMedia({sessions:[],failure:true});
      await shell('command',false);await queryCommand('');commandInput.focus({preventScroll:true});
      window.dispatchEvent(new CustomEvent('whendesk:ready'));
    }catch(error){commandBox.innerHTML=`<div class="command-empty" role="alert">시작하지 못했습니다.<br>${esc(error.message)}</div>`;showError(error);resizeCommand();}
  }
  Object.defineProperty(window,'__whendeskFlush',{value:flushPending});
  Object.defineProperty(window,'__whendeskRecordShortcut',{value:accelerator=>{
    const input=document.activeElement;
    if(helpOpen||state.shell!=='dashboard'||!input?.matches('[data-shortcut]')||typeof accelerator!=='string')return false;
    input.value=accelerator;input.dispatchEvent(new Event('input',{bubbles:true}));return true;
  }});
  init();
})();
