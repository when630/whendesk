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
  const state = { shell:'command', view:'dashboard', tab:'todo', calView:'today',settingsTab:'general', selected:null, project:null, dueOnly:false, year:new Date().getFullYear(), month:new Date().getMonth(), date:today, theme:'zen-sage', tasks:[], projects:[], events:[], calendars:[], info:{}, prefs:{}, media:{ sessions:[] } };
  // 스킨·테마 목록은 themes.js(WHENTERMINAL과 같은 목록). 스킨은 모양, 테마는 그 스킨의 색
  const { SKINS, THEMES, APP_ICONS, themesOf } = window.WhendeskThemes;
  const themeById = id => THEMES.find(theme => theme.id === id) || THEMES[0];
  const command = { seq:0, items:[], selected:0, pending:false, query:'', renderedQuery:null, request:null, running:false, activating:false, activation:0, composing:false, actions:null, more:null, waiters:new Set(), notice:'', start:0, end:0, timer:null };
  const pending = new Map();
  const workRules = window.VIEW;
  const workUndo = [], undoTimeline = [];
  let capturePreview = '', capturePreviewSeq = 0;
  const projectMoves = new Map();
  const workCursors = new Map();
  Object.assign(state,{ allTasks:[], archivedProjects:[], workQuery:'', workSort:'project', workRange:null, workTrash:false });
  let projectCursor = null;
  let workComposing = false;
  let workUndoTail = Promise.resolve();
  const K = window.WhendeskKeys;
  let writeQueue = Promise.resolve(), saveTimer, resizeTimer, feedbackTimer, undoAction, dashboardFocus, returnFocus, editingEvent, lastEventKey, refreshTimer, loading = false;
  let helpOpen = false, helpReturn = null, pick = null;
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
    undoAction = action; if (action) { undoTimeline.push(action); if (undoTimeline.length > 50) undoTimeline.shift(); } element.classList.toggle('is-error', error);
    element.innerHTML = `<span>${esc(message)}</span>${action ? '<button data-action="undo">되돌리기</button>' : ''}<button data-action="dismiss" aria-label="알림 닫기">${icon('x')}</button>`;
    element.hidden = false; clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { element.hidden = true; undoAction = null; }, error ? 15000 : 7000); icons();
  }
  function look() {
    const theme = themeById(state.theme); app.dataset.theme = theme.id; app.dataset.skin = theme.skin;
    const appIcon = state.prefs.appIcon || APP_ICONS[0].id;
    root.querySelectorAll('[data-theme-pick],[data-skin-pick],[data-icon-pick]').forEach(card => { const on = card.dataset.iconPick ? card.dataset.iconPick === appIcon : card.dataset.themePick ? card.dataset.themePick === theme.id : card.dataset.skinPick === theme.skin; card.classList.toggle('on', on); card.setAttribute('aria-checked', String(on)); card.tabIndex = on ? 0 : -1; card.querySelector('.theme-on')?.toggleAttribute('hidden', !on); });
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
    // Command에서 펼칠 때는 창이 투명하게 커진 뒤에 대시보드를 그리고, 그린 다음 프레임에 나타낸다. 작은 창에 대시보드가 비치지 않는다.
    const expanding = state.shell === 'command' && next === 'dashboard';
    if (expanding) await call('shell', { mode:next });
    state.shell = next; root.classList.toggle('is-command', next === 'command');
    notes?.setActive(next === 'dashboard' && state.view === 'notes');
    root.querySelector('#cf-command-panel').hidden = next !== 'command';
    root.querySelector('#cf-dashboard-panel').hidden = next !== 'dashboard';
    root.querySelector('.cf-entry-name').textContent = next === 'command' ? 'WHENCOMMAND' : '대시보드';
    status(); icons(); syncHints();
    if (expanding) requestAnimationFrame(() => requestAnimationFrame(() => call('window.painted').catch(() => {})));
    else await call('shell', { mode:next });
    if (next === 'command') {
      commandInput.value = command.query; renderCommand(); resizeCommand();
      if (focus) { commandInput.focus({ preventScroll:true }); commandInput.setSelectionRange(command.start, command.end); }
    } else if (focus) {
      quietFocus();
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
        /* 묶음을 카드로 두 줄 배치한다. 지금 화면의 묶음을 맨 앞에, 그다음 화면 이동, 나머지는 정의 순서. */
    const current = state.shell === 'command' ? 'WHENCOMMAND' : ({ dashboard:'Dashboard', tasks:state.tab === 'projects' ? 'Projects' : '할 일 목록', notes:'메모', calendar:'캘린더', settings:'설정' })[state.view];
    const rowsOf = group => group.rows.filter(([, , when]) => !when?.media || state.media.sessions?.length).map(([label, ids]) => row(label || K.find(ids[0]).label, ids.map(K.format))).join('');
    const card = (title, rows) => `<section class="help-group${title === current ? ' is-current' : ''}"><h3>${esc(title)}${title === current ? '<small>지금 화면</small>' : ''}</h3><dl>${rows}</dl></section>`;
    const titled = K.HELP.filter(group => group.title), rank = group => group.title === current ? 0 : group.title === '화면 이동' ? 1 : 2;
    const ordered = titled.map((group, index) => ({ group, index })).sort((x, y) => rank(x.group) - rank(y.group) || x.index - y.index).map(({ group }) => card(group.title, rowsOf(group)));
    const everywhere = rowsOf(K.HELP.find(group => !group.title)) + SHORTCUT_UI.filter(([field]) => state.prefs[field]).map(([field,label]) => row(label + ' (전역)', [hotkey(state.prefs[field])])).join('');
    ordered.splice(current === '화면 이동' ? 1 : current ? 2 : 1, 0, card('어디서나', everywhere));
    helpLayer.innerHTML = `<section class="minimal-help" role="dialog" aria-modal="true" aria-label="단축키 안내"><div class="minimal-help-head"><div><h2>단축키</h2><p>${current ? esc(current) + ' 화면에서 연 안내입니다 · ' : ''}Esc · ?로 닫기</p></div><div class="minimal-help-actions"><button class="td-secondary" data-action="help-shortcuts">전역 단축키 바꾸기</button><button data-action="close-help" aria-label="단축키 안내 닫기">${icon('x')}</button></div></div><div class="help-grid">${ordered.join('')}</div><p class="minimal-help-note">마감일은 오늘·내일·모레·상대일 또는 날짜로 입력하며, 비우면 해제합니다. Work 검색에는 초성·본문·프로젝트와 마감순·마감지남·이번주 같은 원본 필터를 사용할 수 있습니다. 할 일을 캘린더 날짜로 끌어놓아도 마감을 바꿀 수 있습니다. 동작 목록과 열린 대화상자는 Esc로 먼저 닫습니다.</p></section>`;
    helpLayer.hidden = false;
    [...app.children].filter(child => child !== helpLayer).forEach(child => { child.inert = true; });
    icons(); quietFocus(); helpLayer.querySelector('[data-action=close-help]').focus({ preventScroll:true });
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
    renderNav(); renderCalendar(); if (renderMain) renderMainView(); syncProjectOptions();
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
    // 목록 상자의 프로젝트 목록을 새 순서·번호로 바꾼다. 보관돼 목록에서 빠진 현재 값은 그대로 남긴다.
    [...body.querySelectorAll('.td-pick[data-field=project_id]'),...modalLayer.querySelectorAll('.td-pick[data-field=project_id]')].forEach(button=>{
      let before=[];try{before=JSON.parse(button.dataset.options||'[]');}catch{}
      const value=button.value,options=projectOptions(),previous=before.find(option=>String(option.value)===String(value));
      if(value&&!options.some(option=>option.value===value)&&previous)options.push({...previous,num:null,color:null});
      button.dataset.options=JSON.stringify(options);
      const current=options.find(option=>String(option.value)===String(value))||options[0];button.querySelector('.td-pick-label').innerHTML=pickLabel(current);
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
  function workQuerySummary() {
    if(!state.workQuery.trim())return '';
    const query=workRules.parseQuery(state.workQuery),parts=[query.text?'검색 결과':'',query.sort||'',...query.filters,query.project?'#'+query.project:''].filter(Boolean);
    return ' · '+esc(parts.join(' · ')||'검색 결과');
  }
  function workView() {
    const search=`<label class="work-search">${icon('search')}<input data-work-search aria-label="Work 검색" placeholder="검색" value="${esc(state.workQuery)}" autocomplete="off" spellcheck="false">${state.workQuery?`<button data-action="clear-work-search" aria-label="Work 검색 지우기">${icon('x')}</button>`:''}</label>`;
    if(state.tab==='projects') {
      const projects=visibleProjects();
      return `<div class="work-toolbar">${search}<button class="work-text-button" data-action="new-project">${icon('plus')}프로젝트</button><button class="work-text-button ${state.workTrash?'active':''}" data-action="work-project-trash" aria-pressed="${state.workTrash}">${state.workTrash?'활성 프로젝트':'보관함'}</button></div><div class="td-list-label"><span>${state.workTrash?'보관된 프로젝트':'프로젝트'} ${projects.length}개</span></div><div class="work-project-list">${projects.map((project,index)=>`<article class="work-project-row" data-work-project-row="${project.id}" tabindex="${String(project.id)===String(projectCursor)||!projectCursor&&index===0?0:-1}"><button class="work-project-name" ${state.workTrash?`data-project-label="${project.id}" tabindex="-1"`:`data-project="${project.id}"`}>${state.workTrash?icon('folder'):`<span class="project-mark">${projectMark(project.id)}</span>`}<span>${esc(project.name)}<small>${state.workTrash?`${project.itemCount??project.item_count??0}개 기록 보존`:state.tasks.filter(task=>task.project_id===project.id&&!task.done).length+'개 미완료'}</small></span></button><div class="work-row-actions">${state.workTrash?`<button data-restore-project="${project.id}" aria-label="${esc(project.name)} 복원">복원</button>`:`<button data-move-project="${project.id}" data-direction="up" aria-label="${esc(project.name)} 위로" ${index===0?'disabled':''}>${icon('arrow-up')}</button><button data-move-project="${project.id}" data-direction="down" aria-label="${esc(project.name)} 아래로" ${index===projects.length-1?'disabled':''}>${icon('arrow-down')}</button><button data-edit-project="${project.id}" aria-label="${esc(project.name)} 이름 수정">${icon('pencil')}</button><button data-archive-project="${project.id}" aria-label="${esc(project.name)} 보관">${icon('archive')}</button>`}</div></article>`).join('')}</div>${projects.length?'':`<div class="td-empty">${state.workTrash?'보관된 프로젝트가 없어요.':'프로젝트를 추가해 할 일을 묶으세요.'}</div>`}`;
    }
    const projectFilter=pickButton('data-work-project-filter aria-label="프로젝트 필터"',state.project??'',[{value:'',label:'모든 프로젝트'},{value:'unassigned',label:'미지정'},...projectOptions().slice(1)]);
    const sort=state.tab==='done'?pickButton('data-work-range aria-label="완료 기록 기간"',String(state.workRange??''),[['7','최근 7일'],['30','최근 30일'],['','전체 기록']].map(([value,label])=>({value,label}))):pickButton('data-work-sort aria-label="할 일 정렬"',state.workSort,[['project','프로젝트순'],['due','마감순'],['new','최신순'],['old','오래된순'],['title','이름순']].map(([value,label])=>({value,label})));
    const byProject=state.tab==='todo'&&!workRules.parseQuery(state.workQuery).sort&&state.workSort==='project';
    const groups=workGroups(),archive=workArchiveHits(),count=groups.reduce((sum,group)=>sum+group.items.length,0);
    // 방금(12시간 안) 마친 일은 목록에 남아 보이지만 탭 숫자처럼 열린 일만 센다. 마친 일은 따로 적는다.
    const closed=state.tab==='done'?0:groups.reduce((sum,group)=>sum+group.items.filter(task=>task.done).length,0);
    return `<div class="work-toolbar">${search}${projectFilter}${sort}</div><div class="td-list-label"><span role="status">${count-closed}개${closed?` · 방금 마친 일 ${closed}`:''}${workQuerySummary()}</span>${state.tab==='todo'?`<label><input type="checkbox" data-due-only ${state.dueOnly?'checked':''}>마감 있는 일</label>`:''}</div><div class="td-rows">${groups.map(group=>`${group.label?`<h2 class="work-group" data-work-group="${esc(group.key)}">${projectIndex(group.pid)>=0?projectChip(group.pid,group.label):esc(group.label)}<small>${group.items.length}</small></h2>`:''}${group.items.map(task=>taskRow(task,{inProjectGroup:byProject})).join('')}`).join('')}</div>${count?'':'<div class="td-empty">표시할 항목이 없어요.</div>'}${archive.length?`<h2 class="work-group">목록 밖 · 완료·삭제 ${archive.length}개</h2>${archive.slice(0,30).map(taskRow).join('')}${archive.length>30?'<p class="work-muted">검색어를 좁혀 나머지 항목을 찾으세요.</p>':''}`:''}`;
  }
  /* 고정 번호 띠: InBox·ToDo·Waiting에서 1~9가 어느 프로젝트인지 늘 보이게 한다(원본 WHENWORK #numlegend). 스크롤 영역 밖, 힌트 줄 위. */
  function renderWorkLegend() {
    let legend=root.querySelector('.td-main>.work-legend');
    if(!legend){legend=document.createElement('div');legend.className='work-legend';legend.setAttribute('role','note');legend.setAttribute('aria-label','프로젝트 번호');root.querySelector('.td-hints').before(legend);}
    const projects=state.projects.slice(0,9);
    legend.hidden=!(state.view==='tasks'&&['inbox','todo','waiting'].includes(state.tab)&&projects.length);
    legend.innerHTML=legend.hidden?'':projects.map(project=>`<span>${projectMark(project.id)}${esc(project.name)}</span>`).join('')+'<small>숫자키로 지정</small>';
  }
  function openPick(button) {
    closePick(false);
    let options=[];try{options=JSON.parse(button.dataset.options||'[]');}catch{}
    if(!options.length)return;
    const menu=document.createElement('div');menu.className='td-pick-menu';menu.id='td-pick-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',button.getAttribute('aria-label')||'');
    menu.innerHTML=options.map((option,index)=>`<div role="option" id="td-pick-${index}" data-pick-index="${index}" data-value="${esc(String(option.value))}" aria-selected="${String(option.value)===String(button.value)}">${pickLabel(option)}</div>`).join('');
    app.append(menu);
    const rect=button.getBoundingClientRect(),height=menu.offsetHeight,below=window.innerHeight-rect.bottom-8;
    menu.style.minWidth=Math.max(rect.width,160)+'px';menu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-menu.offsetWidth-8))+'px';
    menu.style.top=(height<=below||rect.top<height?rect.bottom+4:rect.top-height-4)+'px';
    button.setAttribute('aria-expanded','true');button.setAttribute('aria-controls','td-pick-menu');
    pick={button,options,index:0,menu};syncHints();
    movePick(Math.max(0,options.findIndex(option=>String(option.value)===String(button.value))));
  }
  function movePick(index) {
    if(!pick)return;pick.index=Math.max(0,Math.min(pick.options.length-1,index));
    pick.menu.querySelectorAll('[data-pick-index]').forEach(option=>option.classList.toggle('active',Number(option.dataset.pickIndex)===pick.index));
    pick.button.setAttribute('aria-activedescendant','td-pick-'+pick.index);
    pick.menu.querySelector('.active')?.scrollIntoView({block:'nearest'});
  }
  function closePick(focus=true) {
    if(!pick)return;const {button,menu}=pick;pick=null;menu.remove();syncHints();
    button.setAttribute('aria-expanded','false');button.removeAttribute('aria-activedescendant');button.removeAttribute('aria-controls');
    if(focus&&button.isConnected)button.focus({preventScroll:true});
  }
  function setPick(button,option) {
    if(!option||String(button.value)===String(option.value))return;
    button.value=option.value;button.querySelector('.td-pick-label').innerHTML=pickLabel(option);
    button.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function choosePick(index) { if(!pick)return;const {button,options}=pick;closePick();setPick(button,options[index]); }
  /* 열린 목록 상자와 닫힌 목록 상자 버튼의 키. 다른 처리기보다 먼저(capture) 받아 목록 이동·Esc 단계와 섞이지 않게 한다. */
  function pickKeys(event) {
    const plain=!event.ctrlKey&&!event.altKey&&!event.metaKey,numbered=option=>plain&&option.num&&event.code==='Digit'+option.num;
    if(pick){
      const count=pick.options.length;let handled=true;
      if(K.is(event,'pick.down'))movePick(pick.index+1);
      else if(K.is(event,'pick.up'))movePick(pick.index-1);
      else if(K.is(event,'pick.first'))movePick(0);
      else if(K.is(event,'pick.last'))movePick(count-1);
      else if(K.is(event,'pick.choose'))choosePick(pick.index);
      else if(K.is(event,'back'))closePick();
      else if(event.key==='Tab'){closePick(false);handled=false;}
      else if(pick.options.some(numbered))choosePick(pick.options.findIndex(numbered));
      else if(event.key.length===1&&plain){
        const key=event.key.toLowerCase(),order=[...pick.options.keys()].map(offset=>(pick.index+1+offset)%count);
        const hit=order.find(index=>String(pick.options[index].label).toLowerCase().startsWith(key));if(hit!=null)movePick(hit);
      }else handled=false;
      if(handled){event.preventDefault();event.stopImmediatePropagation();}
      return;
    }
    const button=event.target.closest?.('.td-pick');if(!button||event.isComposing)return;
    if(K.is(event,'pick.open')){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)openPick(button);return;}
    let options=[];try{options=JSON.parse(button.dataset.options||'[]');}catch{}
    const direct=options.find(numbered);
    if(direct){event.preventDefault();event.stopImmediatePropagation();setPick(button,direct);}
  }
  document.addEventListener('keydown',pickKeys,true);
  document.addEventListener('pointerdown',event=>{if(pick&&!pick.menu.contains(event.target)&&event.target.closest('.td-pick')!==pick.button)closePick(false);},true);
  window.addEventListener('blur',()=>closePick(false));
  function renderNav() {
    const focused=root.querySelector('.td-sidebar').contains(document.activeElement)?controlSelector(document.activeElement):null;
    const workActive=state.view === 'tasks';
    const page=active=>active?'aria-current="page"':'';
    root.querySelector('.td-sidebar').innerHTML = `<span class="drag-grip sidebar-grip" aria-hidden="true" title="끌어서 창 옮기기">${icon('grip-horizontal')}</span><nav class="td-nav" aria-label="주 메뉴">
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
    const inProject=task=>!state.project||(state.project==='unassigned'?task.project_id==null:task.project_id===state.project);
    const count = kind => kind==='projects'?state.projects.length:state.tasks.filter(task=>!task.deleted&&inProject(task)&&(kind==='done'?task.done:!task.done&&task.kind===kind)).length;
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
  /* 프로젝트 번호는 활성 프로젝트 순서(Projects 탭 순서)의 앞 9개다. 1~9 키가 같은 순서로 지정한다(원본 WHENWORK projNum).
   * 번호와 짝이 되는 색을 함께 보여 어느 프로젝트인지 한눈에 알 수 있게 한다. */
  const PROJECT_COLORS=['#5b8def','#e0883e','#3fa874','#c4628a','#8a6fd1','#2fa3a3','#c49a2c'];
  function projectIndex(id){return id==null||id===''?-1:state.projects.findIndex(project=>String(project.id)===String(id));}
  function projectNumber(id){const index=projectIndex(id);return index>=0&&index<9?index+1:null;}
  function projectMark(id){const index=projectIndex(id);if(index<0)return '';return `<i class="project-dot" style="--project:${PROJECT_COLORS[index%PROJECT_COLORS.length]}"></i>${index<9?`<b class="project-num">${index+1}</b>`:''}`;}
  function projectChip(id,name){return projectIndex(id)<0?esc(name||'프로젝트 미지정'):`<span class="project-chip">${projectMark(id)}${esc(name||state.projects[projectIndex(id)].name)}</span>`;}
  function projectOptions(none='미지정'){return [{value:'',label:none},...state.projects.map(project=>({value:String(project.id),label:project.name,num:projectNumber(project.id),color:PROJECT_COLORS[projectIndex(project.id)%PROJECT_COLORS.length]}))];}
  /* 목록 상자: 기본 select 대신 쓰는 버튼. data-*와 value를 그대로 들고 있어 change 처리기는 select일 때와 같다.
   * Enter·Space·↓로 열고 ↑↓·J/K로 고르며 Enter로 확정, Esc로 닫는다. 번호가 있는 목록은 숫자키로 바로 고른다. */
  function pickLabel(option){return option?`${option.color?`<i class="project-dot" style="--project:${option.color}"></i>`:''}${option.num?`<b class="project-num">${option.num}</b>`:''}<span>${esc(option.label)}</span>`:'';}
  function pickButton(attrs,value,options){
    const current=options.find(option=>String(option.value)===String(value??''))||options[0];
    return `<button type="button" class="td-pick" ${attrs} value="${esc(current?.value??'')}" aria-haspopup="listbox" aria-expanded="false" data-options="${esc(JSON.stringify(options))}"><span class="td-pick-label">${pickLabel(current)}</span>${icon('chevron-down')}</button>`;
  }
  /* 불릿 저널 상태 기호. 닫힌 일(완료 ×·취소 줄 긋기)이 먼저고, 열린 일은 미룸 > · 대기 … · 미래 마감 < · 그 밖 • 순서로 하나만 보인다. */
  function taskGlyph(task) {
    if(task.cancelled)return {glyph:'•',cls:'is-cancelled',label:'취소함'};
    if(task.done)return {glyph:'×',cls:'is-done',label:'완료'};
    if(task.postponed)return {glyph:'>',cls:'is-postponed',label:`${task.postponed}번 미룸`};
    if(task.kind==='waiting')return {glyph:'…',cls:'is-waiting',label:'대기'};
    if(task.due&&task.due>today)return {glyph:'<',cls:'is-scheduled',label:'예정'};
    return {glyph:'•',cls:'is-open',label:'할 일'};
  }
  /* 설정의 '할 일 표시'에 따라 기호 버튼 또는 체크박스. 어느 쪽이든 누르면 완료·해제이고 키보드는 Space(완료)·C(취소)다. */
  function taskMark(task) {
    if(state.prefs?.taskMarker==='checkbox')return `<input type="checkbox" data-check="${esc(task.id)}" aria-label="${esc(task.title)} 완료" ${task.done ? 'checked' : ''}>`;
    const mark=taskGlyph(task);
    return `<button type="button" class="task-mark ${mark.cls}" data-mark="${esc(task.id)}" tabindex="-1" aria-pressed="${task.done}" aria-label="${esc(task.title)} 완료" title="${esc(mark.label)}">${mark.glyph}</button>`;
  }
  /* 세 번 넘게 미룬 일은 버릴지 정할 때다(이관의 뜻) — 눈에 띄게 둔다. */
  function postponedMeta(task) {
    return task.postponed?`<span class="${task.postponed>=3&&!task.done?'work-overdue':''}">미룸 ${task.postponed}회</span>`:'';
  }
  /* inProjectGroup: 프로젝트별로 묶인 ToDo에서는 묶음 제목이 프로젝트를 말하므로 행에서 반복하지 않는다. */
  function taskRow(task,{inProjectGroup=false}={}) {
    if(task.archived)return `<article class="td-task work-archived" data-task-row="${esc(task.id)}"><div class="td-row"><span class="work-muted">${icon(task.deleted?'trash-2':task.cancelled?'ban':'check')}</span><button class="td-task-open" data-revive-task="${esc(task.id)}"><span>${esc(task.title)}</span><small>${esc(task.project||'미지정')} · ${task.deleted?'삭제됨':task.cancelled?'지난 취소':'지난 완료'} · ${esc((task.deletedAt||task.doneAt||'').slice(0,10))}</small></button><button class="work-text-button" data-revive-task="${esc(task.id)}">되살리기</button></div></article>`;
    const open = state.selected === task.id;
    const wait=task.kind==='waiting'?workRules.waitMeta(workItem(task)):null,badge=workRules.dueBadge(task.due);
    const meta=[inProjectGroup||state.tab==='inbox'&&task.project_id==null?'':projectChip(task.project_id,task.project),task.waitingFor?esc(task.waitingFor):'',wait?`<span class="${wait.hot?'work-overdue':''}">${esc(wait.label)}</span>${wait.nudges?' · 재촉 '+wait.nudges+'회':''}`:'',postponedMeta(task)].filter(Boolean).join(' · ');
    return `<article class="td-task ${open ? 'selected' : ''} ${task.done ? 'done' : ''} ${task.cancelled ? 'cancelled' : ''}" data-task-row="${esc(task.id)}" ${open ? `data-editor="${esc(task.id)}"` : ''}><div class="td-row">${taskMark(task)}${open ? `<div class="td-task-open"><input class="td-row-title" data-field="title" aria-label="할 일 제목" value="${esc(task.title)}">${meta?`<small>${meta}</small>`:''}</div>` : `<button class="td-task-open" data-task="${esc(task.id)}" draggable="true" aria-expanded="false"><span>${esc(task.title)}</span>${meta?`<small>${meta}</small>`:''}</button>`}${state.tab==='done'&&task.doneAt?`<small class="td-done-at" title="${esc(task.doneAt)}">${esc(new Date(task.doneAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}))} ${task.cancelled?'취소':'완료'}</small>`:`<button class="td-due ${badge?.cls==='today'?'today':''} ${badge?.cls==='over'?'work-overdue':''}" data-edit-due="${esc(task.id)}" title="${esc(task.due||'마감 없음')}">${badge?esc(badge.text):'마감 없음'}</button>`}${open ? `<button class="td-drag-handle" data-task="${esc(task.id)}" draggable="true" aria-label="할 일 끌기">${icon('grip-vertical')}</button>` : ''}</div>${open ? taskEditor(task) : ''}</article>`;
  }
  function taskEditor(task,{modal=false}={}) {
    return `<div class="td-inline"><div class="td-fields"><label class="td-field">상태${pickButton('data-field="kind" aria-label="할 일 상태"',task.kind,[{value:'inbox',label:'InBox'},{value:'todo',label:'ToDo'},{value:'waiting',label:'Waiting'}])}</label><label class="td-field">마감<input data-field="due" aria-label="할 일 마감" value="${esc(task.due)}" placeholder="오늘 / 내일 / +3 / 8-12" autocomplete="off" spellcheck="false"></label><label class="td-field">프로젝트${pickButton('data-field="project_id" aria-label="할 일 프로젝트"',task.project_id??'',projectOptions())}</label>${task.kind === 'waiting' ? `<label class="td-field">대기 상대<input data-field="waitingFor" aria-label="대기 상대" value="${esc(task.waitingFor)}"></label>` : ''}</div><textarea class="td-note" data-field="note" aria-label="할 일 상세 내용" placeholder="상세 내용" spellcheck="false">${esc(task.note)}</textarea><div class="td-inline-foot"><span data-save-status>수정 내용 자동 저장</span><div><button type="button" class="td-modal-delete" data-delete-task="${esc(task.id)}">삭제</button>${task.kind === 'waiting' ? `<button type="button" data-nudge="${esc(task.id)}">재촉 기록</button>` : ''}<button type="button" data-cancel-task="${esc(task.id)}" title="취소 (C)">${task.cancelled ? '취소 해제' : '취소'}</button>${task.cancelled ? '' : `<button type="button" data-complete-task="${esc(task.id)}" title="완료 (Space)">${task.done ? '완료 해제' : '완료'}</button>`}${modal?'<button type="submit" class="td-primary">닫기</button>':`<button type="button" data-action="collapse">${icon('chevron-up')}접기</button>`}</div></div></div>`;
  }
  function home() {
    const tasks = state.tasks.filter(t => !t.done && t.kind === 'todo').sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999'));
    // 마감 표시는 Work 목록과 같은 배지(D-3·오늘·D+2)다. 아래 입구는 왼쪽 메뉴를 되풀이하지 않고, 쌓여 있는 것(분류할 InBox·기다리는 일·오늘 일정)을 센다.
    const due = t => { const badge = workRules.dueBadge(t.due); return `<small class="td-due ${badge?.cls === 'today' ? 'today' : ''} ${badge?.cls === 'over' ? 'work-overdue' : ''}" title="${esc(t.due || '마감 없음')}">${esc(badge?.text || '마감 없음')}</small>`; };
    const count = kind => state.tasks.filter(t => !t.done && t.kind === kind).length;
    const todays = state.events.filter(e => occursOn(e, today)).length;
    const entry = (action, iconName, label, value, note) => `<button class="cf-entry" data-action="${action}">${icon(iconName)}<span>${label}${note ? `<small>${esc(note)}</small>` : ''}</span><b>${value}</b>${icon('chevron-right')}</button>`;
    return `<section class="cf-home-section"><div class="cf-home-head"><h2>ToDo <small>${tasks.length}개</small></h2><button data-tab="todo">전체 보기 →</button></div>${tasks.slice(0,5).map(t => `<div class="cf-home-task">${taskMark(t)}<button data-reveal="${esc(t.id)}">${esc(t.title)}<small>${esc(t.project || '프로젝트 미지정')}</small></button>${due(t)}</div>`).join('') || '<div class="cf-home-empty">할 일이 없어요. Ctrl+N으로 InBox에 담으세요.</div>'}</section>${entry('inbox','inbox','InBox',count('inbox'),'분류할 일')}${entry('waiting','hourglass','Waiting',count('waiting'),'답을 기다리는 일')}${entry('calendar','calendar-days','오늘 일정',todays,'')}`;
  }
  function renderMainView() {
    if (pick && !pick.button.isConnected) closePick(false);
    const focus = captureFocus();
    notes?.setActive(state.view === 'notes' && state.shell === 'dashboard');
    app.classList.toggle('is-calendar', state.view === 'calendar' || state.view === 'settings' || state.view === 'notes');
    renderWorkTabs(); renderWorkLegend();
    root.querySelector('.td-quick').hidden = state.view !== 'tasks' || state.tab === 'projects';
    const workTitle=state.tab==='projects'?'Projects':state.projects.find(p => p.id === state.project)?.name || ({todo:'ToDo',inbox:'InBox',waiting:'Waiting',done:'Done'})[state.tab] || 'InBox';
    const title = state.view === 'dashboard' ? 'Dashboard' : state.view === 'calendar' ? 'Calendar' : state.view === 'settings' ? 'Settings' : state.view === 'notes' ? 'Note' : `Work · ${workTitle}`;
    root.querySelector('.td-main-head').innerHTML = `<div><h1>${esc(title)}</h1><p>${state.view === 'dashboard' ? new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'long' }) : state.view === 'calendar' ? '일정과 할 일의 마감' : state.view === 'settings' ? '외관 · 단축키 · 데이터' : ({ todo:'해야 할 일을 하나씩 정리하세요.', inbox:'담아둔 일을 분류하세요.', waiting:'답변과 진행 상황을 기다리는 일.', done:'마친 일의 기록을 확인하세요.' })[state.tab]}</p></div>${state.view === 'calendar' ? `<button class="td-primary" data-action="new-event">${icon('plus')}일정 추가</button>` : state.view === 'tasks' && Number.isInteger(state.project) ? `<button class="td-secondary" data-edit-project="${state.project}">프로젝트 관리</button>` : ''}`;
    if (state.view === 'dashboard') body.innerHTML = home();
    else if (state.view === 'settings') body.innerHTML = settingsView();
    else if (state.view === 'notes') notes?.mount(body);
    else if (state.view === 'calendar') {
      // 월 보기는 고른 날의 일정·마감을 격자 바로 아래에 둔다. 구독·ICS는 드물게 쓰므로 맨 아래 작은 글자 버튼이다.
      const monthAgenda = () => { const deadlines = deadlineRows(state.date); return `<div class="td-main-calendar-agenda"><h2>${esc(dayLabel(state.date))}</h2>${eventRows(state.date)}${deadlines ? `<div class="cal-deadlines"><small>마감</small>${deadlines}</div>` : ''}</div>`; };
      body.innerHTML = `<section class="td-full-calendar">${calendarViews()}${state.calView === 'month' ? calendarMonth({ full:true }) + monthAgenda() : calendarList()}<div class="calendar-tools"><button class="work-text-button" data-action="subscriptions">${icon('rss')}구독 관리</button><button class="work-text-button" data-action="import-ics">${icon('download')}ICS 가져오기</button><button class="work-text-button" data-action="export-ics">${icon('upload')}ICS 내보내기</button></div></section>`;
    }
    else body.innerHTML = workView();
    restoreFocus(focus); icons();
    if(state.view==='tasks'){syncTaskCursor();syncProjectCursor();}
  }
  /* 그날에 걸친 일정인가. 여러 날·자정을 넘는 일정은 걸친 날 모두에 보인다(원본 WHENCALENDAR daySpan). 끝은 배타적이다. */
  function occursOn(event, key) {
    if (event.date === key) return true;
    if (!event.endsAt || key < event.date) return false;
    return Date.parse(event.endsAt) > new Date(key + 'T00:00:00').getTime();
  }
  function eventKey(event) { return encodeURIComponent(String(event.id) + '|' + (event.recurrenceId || event.startsAt || event.date)); }
  function findEvent(key) { return state.events.find(e => eventKey(e) === key || String(e.id) === String(key)); }
  /* full: 캘린더 화면의 큰 월 격자. 칸이 넓으므로 점 대신 일정·마감 제목을 두 줄까지 보이고 나머지는 +n으로 줄인다. */
  function calendarMonth({ full = false } = {}) {
    const first = new Date(state.year, state.month, 1), offset = (first.getDay()+6)%7, count = Math.ceil((offset + new Date(state.year,state.month+1,0).getDate())/7)*7;
    const titles = (events, tasks) => { const lines = [...events.map(e => `<i class="td-day-line">${esc(e.title)}</i>`), ...tasks.map(t => `<i class="td-day-line is-due">${esc(t.title)}</i>`)]; return lines.slice(0, 2).join('') + (lines.length > 2 ? `<i class="td-day-more">+${lines.length - 2}</i>` : ''); };
    return `<div class="td-cal-head"><h2>${state.year}년 ${state.month+1}월</h2><div><button data-month="-1" aria-label="이전 달">${icon('chevron-left')}</button><button data-action="today">오늘</button><button data-month="1" aria-label="다음 달">${icon('chevron-right')}</button></div></div><div class="td-month">${['월','화','수','목','금','토','일'].map(day => `<span class="td-weekday">${day}</span>`).join('')}${Array.from({ length:count }, (_,index) => { const date = new Date(state.year,state.month,1-offset+index), key = dateKey(date); const events = state.events.filter(e => occursOn(e, key)); const tasks = state.tasks.filter(t => !t.done && t.due === key); return `<button class="td-day ${key === today ? 'today' : ''} ${key === state.date ? 'selected' : ''} ${date.getMonth() !== state.month ? 'other' : ''}" data-date="${key}" tabindex="${key === state.date ? 0 : -1}" aria-pressed="${key === state.date}" aria-label="${key} 일정 ${events.length}개, 마감 ${tasks.length}개"><span>${date.getDate()}</span>${full ? `<span class="td-day-lines" aria-hidden="true">${titles(events, tasks)}</span>` : `<span class="td-day-marks">${events.length ? '<i class="td-event-mark"></i>' : ''}${tasks.length ? '<i class="td-task-mark"></i>' : ''}</span>`}</button>`; }).join('')}</div>`;
  }
  /* 그날 마감인 열린 할 일. 오늘에는 마감이 지난 일도 함께 보인다(놓치지 않게). 누르면 그 할 일을 연다. */
  function deadlineTasks(date) { return state.tasks.filter(t => !t.done && t.due && (t.due === date || date === today && t.due < today)).sort((a, b) => a.due.localeCompare(b.due)); }
  function deadlineRows(date) {
    return deadlineTasks(date).map(t => { const glyph = state.prefs?.taskMarker === 'checkbox' ? { glyph:'□' } : taskGlyph(t), late = t.due < today; return `<button class="td-deadline${late ? ' is-late' : ''}" data-reveal="${esc(t.id)}"><b class="td-deadline-glyph" aria-hidden="true">${glyph.glyph}</b><span>${esc(t.title)}</span>${late ? `<small class="work-overdue">${esc(workRules.dueBadge(t.due)?.text || '지남')}</small>` : ''}</button>`; }).join('');
  }
  /* 캘린더 보기: 오늘·주는 키보드로 훑기 빠른 목록, 월은 격자(원본 WHENCALENDAR). Tab·Shift+Tab으로 순환한다. */
  const CAL_VIEWS = [['today','오늘'],['week','주'],['month','월']];
  function calendarViews() { return `<div class="cal-views" role="tablist" aria-label="캘린더 보기">${CAL_VIEWS.map(([value,label]) => `<button role="tab" data-cal-view="${value}" aria-selected="${state.calView === value}" tabindex="-1">${label}</button>`).join('')}</div>`; }
  function weekDates(date) { const start = new Date(date + 'T12:00:00'); start.setDate(start.getDate() - (start.getDay() + 6) % 7); return Array.from({ length:7 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return dateKey(day); }); }
  function dayLabel(date) { return new Date(date + 'T12:00:00').toLocaleDateString('ko-KR', { month:'long', day:'numeric', weekday:'short' }); }
  function calendarList() {
    const week = state.calView === 'week', dates = week ? weekDates(state.date) : [state.date], unit = week ? '주' : '날';
    // 오늘·주 보기도 마우스로 앞뒤를 옮긴다(키보드는 ←→·T). 머리말은 지금 보는 날·주를 말한다.
    const range = week ? `${dayLabel(dates[0])} – ${dayLabel(dates[6])}` : dayLabel(state.date);
    const relative = week ? (dates.includes(today) ? '이번 주' : '') : state.date === today ? '오늘' : state.date === tomorrow ? '내일' : '';
    const head = `<div class="td-cal-head cal-list-head"><h2>${esc(range)}${relative ? `<small>${relative}</small>` : ''}</h2><div><button data-cal-step="-1" aria-label="이전 ${unit}">${icon('chevron-left')}</button><button data-action="today">오늘</button><button data-cal-step="1" aria-label="다음 ${unit}">${icon('chevron-right')}</button></div></div>`;
    return head + `<div class="td-main-calendar-agenda cal-list" tabindex="-1" data-cal-home aria-label="${week ? '이번 주 일정' : '이날 일정'}">${dates.map(date => { const hasEvents = state.events.some(event => occursOn(event, date)), deadlines = deadlineRows(date), empty = !hasEvents && !deadlines; return `<section class="cal-list-day${date === today ? ' is-today' : ''}${date === state.date ? ' is-selected' : ''}${empty ? ' is-empty' : ''}" data-cal-day="${date}">${week ? `<h2>${esc(dayLabel(date))}${empty ? '<small>일정 없음</small>' : ''}</h2>` : empty ? '<p class="td-empty">일정도 마감도 없어요. N으로 일정을 추가하세요.</p>' : ''}${hasEvents ? eventRows(date) : ''}${deadlines ? `<div class="cal-deadlines"><small>마감</small>${deadlines}</div>` : ''}</section>`; }).join('')}</div>`;
  }
  function setCalView(value) { if (!CAL_VIEWS.some(([view]) => view === value)) return; state.calView = value; renderMainView(); focusView(); }
  function focusEvent(id, date) {
    const item = state.events.find(event => String(event.id) === String(id) && (!date || event.date === date)) || state.events.find(event => String(event.id) === String(id));
    const button = item && body.querySelector(`.td-main-calendar-agenda [data-event="${eventKey(item)}"]`);
    if (button) button.focus({ preventScroll:true });
    return !!button;
  }
  /* N: 한 줄 입력. 쓰는 동안 해석을 미리 보여 주고 Enter로 추가, Ctrl+Enter는 자세히 편집(원본 WHENCALENDAR). */
  let quickEventTimer = null, quickEventSeq = 0;
  function eventWhen(parsed) {
    const start = new Date(parsed?.startsAt); if (!Number.isFinite(start.getTime())) return '';
    const day = start.toLocaleDateString('ko-KR', { month:'long', day:'numeric', weekday:'short' });
    return parsed.allDay ? day : `${day} ${start.toLocaleTimeString('ko-KR', { hour:'numeric', minute:'2-digit' })}`;
  }
  /* 해석 미리보기(원본 WHENCALENDAR previewParse): 굵은 요약(시작–종료 · 종일 · 여러 날 · 반복) · 제목, 아래 줄마다 ＊ 짚어 둔 점.
   * 해석기는 날짜를 말하지 않으면 오늘 종일로 읽으므로 실패는 제목이 없을 때뿐이다. */
  function eventPreviewHtml(parsed) {
    if (!parsed?.startsAt) return '<span class="quick-event-hint">날짜·시각·제목을 알아서 읽습니다</span>';
    let html = [parsed.summary || eventWhen(parsed) ? `<b>${esc(parsed.summary || eventWhen(parsed))}</b>` : '', parsed.title ? esc(parsed.title) : ''].filter(Boolean).join(' · ');
    if (parsed.ok === false) html += '<br><span class="quick-event-note">＊ 제목이 없습니다</span>';
    for (const note of parsed.notes || []) html += `<br><span class="quick-event-note">＊ ${esc(note?.msg ?? note)}</span>`;
    return html;
  }
  function eventPreviewText(parsed) {
    if (!parsed?.startsAt) return '날짜·시각·제목을 알아서 읽습니다';
    const notes = (parsed.notes || []).map(note => '＊ ' + (note?.msg ?? note));
    return parsed.ok === false ? ['＊ 제목이 없습니다', ...notes].join(' · ') : [parsed.summary || eventWhen(parsed), parsed.title, ...notes].filter(Boolean).join(' · ');
  }
  function quickEventModal() {
    openModal(`<form class="td-modal quick-event-form" role="dialog" aria-modal="true" aria-label="일정 한 줄 입력"><label class="quick-event-label" for="quick-event-line">새 일정 — 한 줄로 적으세요</label><input id="quick-event-line" name="line" aria-label="일정 한 줄 입력" placeholder="담주 화 3시 김부장 미팅 1시간" autocomplete="off" spellcheck="false" maxlength="200"><p class="quick-event-preview" aria-live="polite">${eventPreviewHtml(null)}</p><p class="quick-event-foot"><span><kbd>Enter</kbd> 등록</span><span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 자세히</span><span><kbd>Esc</kbd> 취소</span></p></form>`);
  }
  async function parseQuickEvent() {
    const form = modalLayer.querySelector('.quick-event-form'); if (!form) return null;
    const line = form.elements.line.value.trim(), seq = ++quickEventSeq, out = form.querySelector('.quick-event-preview');
    if (!line) { out.innerHTML = eventPreviewHtml(null); out.classList.remove('is-error'); return null; }
    const result = await call('mutate', { type:'calendar.parse', payload:{ text:line } }), parsed = result?.parsed || result;
    if (seq !== quickEventSeq || !out.isConnected) return null;
    const ok = parsed?.ok !== false && !!parsed?.startsAt;
    out.innerHTML = eventPreviewHtml(parsed);
    out.classList.toggle('is-error', !ok);
    return ok ? parsed : null;
  }
  async function submitQuickEvent({ detail = false } = {}) {
    clearTimeout(quickEventTimer);
    const parsed = await parseQuickEvent();
    if (detail) { const line = modalLayer.querySelector('.quick-event-form [name=line]')?.value.trim() || ''; closeModal(); eventModal(null, parsed || null); if (!parsed && line) { const title = modalLayer.querySelector('.event-form [name=title]'); if (title) title.value = line; } return; }
    if (!parsed) return;
    const created = await mutate('event.create', parsed);
    closeModal(); await selectDate(dateKey(new Date(parsed.startsAt)));
    feedback('일정을 추가했어요.', () => mutate('event.delete', { id:created.id, scope:'all' }));
    if (!focusEvent(created.id)) focusView();
  }
  function eventRows(date) {
    // 이어지는 날에는 시작 시각 대신 '종일'(종일 일정) 또는 '~끝 시각'(마지막 날)을 보인다.
    const when = e => e.allDay || (e.date !== date && e.endDate !== date) ? '종일' : e.date === date ? e.time : '~' + e.end;
    const events = state.events.filter(e => occursOn(e, date)).sort((a,b) => (a.date === date ? 1 : 0) - (b.date === date ? 1 : 0) || String(a.time).localeCompare(String(b.time)));
    return events.map(e => `<button class="td-cal-event" data-event="${eventKey(e)}"><time>${esc(when(e))}</time><span>${esc(e.title)}<small>${e.allDay ? '종일 일정' : esc(e.time) + ' – ' + esc(e.end || '')}${e.location ? ' · ' + esc(e.location) : ''}${e.rrule ? ' · 반복' : ''}${e.readonly ? ' · 구독' : ''}</small></span></button>`).join('') || '<div class="td-empty" style="padding:15px 0">일정 없음</div>';
  }
  function renderCalendar() {
    const focused=root.querySelector('.td-calendar-side').contains(document.activeElement)?controlSelector(document.activeElement):null;
    root.querySelector('.td-calendar-side').innerHTML = `${calendarMonth()}<div class="td-cal-legend"><i class="td-event-mark"></i>일정 <i class="td-task-mark"></i>할 일 마감</div><section class="td-day-detail"><div class="td-cal-head"><h2>${Number(state.date.slice(5,7))}월 ${Number(state.date.slice(8))}일 일정</h2><button data-action="new-event" aria-label="선택한 날짜에 일정 추가">${icon('plus')}</button></div>${eventRows(state.date)}<div class="td-deadlines"><small>이날 마감인 할 일</small>${deadlineRows(state.date) || '<small>마감 없음</small>'}</div></section><p class="td-calendar-hint">할 일을 날짜로 끌어놓으면 마감이 바뀝니다.</p>`; icons();
    if(focused)root.querySelector('.td-calendar-side').querySelector(focused)?.focus({preventScroll:true});
  }
  async function reveal(id) {
    await flushPending(); const task = state.tasks.find(t => String(t.id) === String(id)); if (!task) return;
    state.view = 'tasks'; state.tab = task.done ? 'done' : task.kind; state.selected = null; state.project = null; state.dueOnly = false; state.workQuery='';state.workRange=null;
    renderNav(); renderMainView(); await shell('dashboard', false); focusTask(task.id); taskModal(task.id);
  }
  async function navigate(route = {}) {
    if (route.shell === 'command') {
      await flushPending(); await shell('command');
      if (route.capture) enterCapture(route.capture); else exitCapture();
      // 숨어 있다가 다시 불렸으면 빈 입력줄로 시작한다(원본 WHENCOMMAND PANEL-07). 대시보드에서 내려온 경우는 검색어를 유지한다.
      if (route.fresh && !route.capture) { commandInput.value = ''; clearCommandNotice(); closeCommandActions(false); clearCommandOutput(); queueCommandQuery('', 0, true); commandInput.focus({ preventScroll:true }); }
      if (route.fresh) requestAnimationFrame(() => requestAnimationFrame(() => call('window.painted').catch(() => {})));
      return;
    }
    if (route.view === 'work' || route.view === 'tasks' && route.tab && !route.id) state.project=null;
    if (route.view === 'notes') { await flushPending(); state.view='notes'; state.project=null; renderNav(); renderMainView(); await shell('dashboard',false); await notes?.refresh(); if(route.id) await notes?.open(route.id,{edit:!!route.edit}); else notes?.focus(); return; }
    if (route.id && route.view !== 'calendar') await reveal(route.id);
    else { await flushPending(); state.view = route.settings ? 'settings' : route.view === 'work' ? 'tasks' : route.view || 'dashboard'; if(route.settings){state.prefs=await call('preferences.get');state.info=await call('app.info');state.update=await call('update.state').catch(()=>null);} if (route.tab) state.tab = route.tab; if (route.date) { state.date = route.date; state.year = Number(route.date.slice(0,4)); state.month = Number(route.date.slice(5,7))-1; } await loadState(); await shell('dashboard'); }
    if (route.focusCapture) root.querySelector('.td-quick input')?.focus();
    // 일정 결과는 날짜만이 아니라 그 일정에 포커스를 둔다.
    if (route.view === 'calendar' && route.id != null) focusEvent(route.id, route.date);
    if (route.view === 'calendar' && route.action) body.querySelector(`[data-action="${CSS.escape(route.action)}"]`)?.click();
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
    const previous = task.due, postponed = task.postponed; await mutate('task.update', { id, due:date }); state.date = date;
    state.year = Number(date.slice(0,4)); state.month = Number(date.slice(5,7))-1; renderCalendar();
    rememberWorkUndo('마감일',()=>mutate('task.update',{id,due:previous,postponed}),'마감을 변경했어요.');
  }
  function openModal(html) { modalDirty = false; discardArmedAt = 0; returnFocus = document.activeElement; modalReturnKey=controlSelector(returnFocus); modalReturnEditor=captureFocus(); modalLayer.hidden = false; modalLayer.innerHTML = html; (modalLayer.querySelector('input:not([type=checkbox]):not([readonly]),textarea:not([readonly]),select:not([disabled])')||modalLayer.querySelector('button'))?.focus(); icons(); }
  /* 입력한 내용이 있는 대화상자는 Esc 한 번에 버리지 않는다. 3초 안에 한 번 더 누르면 닫는다. */
  function closeModalSafely() {
    // 할 일 편집은 자동 저장이고, 삭제 범위 고르기는 입력이 없어 Esc 한 번에 닫는다.
    if (modalLayer.querySelector('.task-form,.scope-form')) { closeModal(); return; }
    if (modalDirty && modalLayer.querySelector('form') && Date.now() - discardArmedAt > 3000) { discardArmedAt = Date.now(); feedback('저장하지 않은 내용이 있어요. Esc를 한 번 더 누르면 버립니다.'); return; }
    closeModal();
  }
  function closeModal() { const editedTask = modalLayer.querySelector('.task-form')?.dataset.editor; if (editedTask) { modalLayer.hidden = true; modalLayer.innerHTML = ''; modalDirty = false; safe(() => afterTaskModal(editedTask)); return; } modalDirty = false; discardArmedAt = 0; modalLayer.hidden = true; modalLayer.innerHTML = ''; editingEvent = null; if (returnFocus?.isConnected && root.contains(returnFocus)) returnFocus.focus({ preventScroll:true }); else if(modalReturnEditor&&body.querySelector(`[data-editor="${CSS.escape(modalReturnEditor.id)}"] [data-field="${modalReturnEditor.field}"]`))restoreFocus(modalReturnEditor);else if(modalReturnKey&&root.querySelector(modalReturnKey)?.getClientRects().length)root.querySelector(modalReturnKey).focus({preventScroll:true});else focusView(); }
  const pad2 = value => String(value).padStart(2, '0');
  const clockOf = date => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const shiftDateKey = (key, days) => { const date = new Date(key + 'T12:00:00'); date.setDate(date.getDate() + days); return dateKey(date); };
  /* 폼 값: 시작 날짜·시각, 종료 날짜·시각. 종일의 종료 날짜는 마지막 날(포함)로 보이고 저장할 때 다음 날 0시(배타)로 바꾼다. */
  function eventFormValues(event, parsed) {
    const source = parsed || event;
    if (!source?.startsAt) return { title:'', date:state.date, time:'09:00', endDate:state.date, end:'10:00', allDay:false, location:'', note:'', rrule:'' };
    const start = new Date(source.startsAt), endAt = source.endsAt ? new Date(source.endsAt) : null, allDay = !!source.allDay;
    const date = dateKey(start), time = allDay ? '09:00' : clockOf(start);
    let endDate, end;
    if (allDay) { endDate = endAt ? dateKey(new Date(endAt.getTime() - 1)) : date; end = '10:00'; if (endDate < date) endDate = date; }
    else { const until = endAt || new Date(start.getTime() + 3600e3); endDate = dateKey(until); end = clockOf(until); }
    return { title:source.title || '', date, time, endDate, end, allDay, location:event?.location || '', note:event?.note || '', rrule:source.rrule || '' };
  }
  function eventModal(key = null, parsed = null) {
    if (state.shell !== 'dashboard') safe(() => shell('dashboard', false));
    const event = key ? findEvent(key) : null; editingEvent = event; lastEventKey = key;
    const values = eventFormValues(event, parsed);
    const readonly = !!event?.readonly, ro = readonly ? 'readonly' : '', off = readonly || values.allDay ? 'disabled' : '';
    const repeating = !!(event?.rrule || event?.recurrenceId) && !readonly;
    openModal(`<form class="td-modal event-form" role="dialog" aria-modal="true" aria-label="일정 편집"><div class="td-modal-header"><h2>${readonly ? '구독 일정' : event ? '일정 수정' : '일정 추가'}</h2><button type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div><label class="td-field">제목<input name="title" aria-label="일정 제목" value="${esc(values.title)}" required ${ro}></label><label class="all-day-label"><input type="checkbox" name="allDay" ${values.allDay ? 'checked' : ''} ${readonly ? 'disabled' : ''}>종일</label><div class="td-fields"><label class="td-field">시작 날짜<input type="date" name="date" aria-label="일정 시작 날짜" value="${esc(values.date)}" required ${ro}></label><label class="td-field">시작 시각<input type="time" name="time" aria-label="일정 시작 시각" value="${esc(values.time)}" ${ro} ${off}></label></div><div class="td-fields"><label class="td-field">종료 날짜<input type="date" name="endDate" aria-label="일정 종료 날짜" value="${esc(values.endDate)}" required ${ro}></label><label class="td-field">종료 시각<input type="time" name="end" aria-label="일정 종료 시각" value="${esc(values.end)}" ${ro} ${off}></label></div><label class="td-field">장소<input name="location" aria-label="일정 장소" value="${esc(values.location)}" ${ro}></label><label class="td-field">반복${pickButton(`name="rrule" aria-label="일정 반복" ${readonly ? 'disabled' : ''}`,values.rrule,[['','반복 안 함'],['FREQ=DAILY','매일'],['FREQ=WEEKLY','매주'],['FREQ=MONTHLY','매월']].concat(values.rrule && !['FREQ=DAILY','FREQ=WEEKLY','FREQ=MONTHLY'].includes(values.rrule) ? [[values.rrule,'기존 반복 규칙 유지']] : []).map(([value,label]) => ({value,label})))}</label>${repeating ? `<label class="td-field">적용 범위${pickButton('name="scope" aria-label="반복 일정 적용 범위"','one',[{value:'one',label:'이 회차만'},{value:'future',label:'이 회차부터 뒤 전부'},{value:'all',label:'전체 반복 일정'}])}</label>` : ''}<label class="td-field">상세 내용<textarea name="note" class="td-note" aria-label="일정 상세 내용" ${ro}>${esc(values.note)}</textarea></label><div class="td-modal-actions">${event && !readonly ? '<button type="button" class="td-modal-delete" data-action="delete-event">일정 삭제</button>' : '<span></span>'}<div><button type="button" class="td-secondary" data-action="close-modal">${readonly ? '닫기' : '취소'}</button>${readonly ? '' : '<button type="submit" class="td-primary">저장</button>'}</div></div></form>`);
    editingEvent = event;
    if (!readonly) wireEventForm(modalLayer.querySelector('.event-form'));
  }
  /* 시작을 옮기면 길이를 지킨 채 종료도 옮긴다. 종일이면 시각 칸을 끈다. */
  function wireEventForm(form) {
    if (!form) return;
    const field = name => form.elements[name];
    const at = (dateName, timeName) => new Date(`${field(dateName).value}T${field('allDay').checked ? '00:00' : field(timeName).value || '00:00'}:00`).getTime();
    let lastStart = at('date', 'time');
    const follow = () => {
      const next = at('date', 'time'), delta = next - lastStart;
      if (Number.isFinite(delta) && delta && field('endDate').value) {
        const moved = new Date(at('endDate', 'end') + delta);
        if (Number.isFinite(moved.getTime())) { field('endDate').value = dateKey(moved); if (!field('allDay').checked) field('end').value = clockOf(moved); }
      }
      if (Number.isFinite(next)) lastStart = next;
    };
    field('date').addEventListener('change', follow);
    field('time').addEventListener('change', follow);
    field('allDay').addEventListener('change', () => { const on = field('allDay').checked; field('time').disabled = on; field('end').disabled = on; lastStart = at('date', 'time'); });
  }
  /* 반복 일정 범위(원본 WHENCALENDAR 3지선다): 1 이 회차만 · 2 이 회차부터 뒤 전부 · 3 전체. 커서는 '이 회차만'에서 시작한다.
   * 삭제·제목 고치기·옮기기가 같은 대화상자를 쓴다. 고른 범위로 run(일정, 범위)을 부른다. */
  let scopeRun = null;
  async function deleteSeries(item, scope) {
    const result=await mutate('event.delete',{id:item.id,scope,recurrenceId:item.recurrenceId||item.startsAt});
    // 전체 삭제는 소프트 삭제를 되살리고, 회차 제외·이후 자르기는 삭제 전 규칙·제외일로 되돌린다(앱의 다른 삭제와 같게).
    if(scope==='all')feedback('반복 일정을 모두 삭제했어요.',()=>mutate('event.restore',{id:item.id}));
    else feedback(scope==='one'?'이 회차를 삭제했어요.':'이 회차부터 뒤를 삭제했어요.',result?.previous?()=>mutate('event.reshape',{id:item.id,...result.previous}):null);
    focusView();
  }
  function scopeModal(item, { heading = '반복 일정 삭제', question = '', verb = '삭제', run = deleteSeries } = {}) {
    openModal(`<form class="td-modal scope-form" role="dialog" aria-modal="true" aria-label="${esc(heading)} 범위" data-event="${eventKey(item)}"><div class="td-modal-header"><h2>${esc(heading)}</h2><button type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div><p class="scope-what">${esc(question || item.title)} · ${esc(dayLabel(item.date))}${item.allDay ? '' : ' ' + esc(item.time)}</p><div class="scope-choices">${[['one','이 회차만'],['future','이 회차부터 뒤 전부'],['all','전체 반복 일정']].map(([scope,label],index) => `<button type="button" class="scope-choice" data-action="pick-scope" data-scope="${scope}"><kbd>${index+1}</kbd>${label}</button>`).join('')}</div><p class="quick-event-foot"><span><kbd>1</kbd>~<kbd>3</kbd> · <kbd>↑</kbd><kbd>↓</kbd> 고르기</span><span><kbd>Enter</kbd> ${esc(verb)}</span><span><kbd>Esc</kbd> 취소</span></p></form>`);
    scopeRun = run;
    const form = modalLayer.querySelector('.scope-form'), choices = [...form.querySelectorAll('.scope-choice')];
    choices[0].focus();
    form.addEventListener('keydown', event => {
      const digit = /^Digit([123])$/.exec(event.code)?.[1], index = choices.indexOf(document.activeElement);
      if (digit) { event.preventDefault(); event.stopPropagation(); choices[Number(digit) - 1].click(); return; }
      const step = event.key === 'ArrowDown' || event.code === 'KeyJ' ? 1 : event.key === 'ArrowUp' || event.code === 'KeyK' ? -1 : 0;
      if (step) { event.preventDefault(); event.stopPropagation(); choices[(Math.max(index, 0) + step + choices.length) % choices.length].focus(); }
    });
  }
  /* E 제목 고치기 · D 날짜·시각 옮기기 — 한 줄로(원본 WHENCALENDAR dlgMode title·when).
   * 옮기기는 적은 줄 뒤에 제목을 붙여 일정 추가와 같은 해석기를 태운다(규칙이 두 벌이 되지 않게). 제목은 그대로다. */
  const LINE_EDIT = {
    title:{ label:'제목 고치기', hint:'Enter로 저장합니다', placeholder:'' },
    when:{ label:'날짜·시각 옮기기 — 한 줄로', hint:'제목은 그대로 두고 시간만 바꿉니다', placeholder:'담주 화 3시 1시간' },
  };
  function lineEditModal(mode, key) {
    const item = findEvent(key); if (!item) return;
    if (item.readonly) { feedback(mode === 'title' ? '구독 일정은 고칠 수 없어요.' : '구독 일정은 옮길 수 없어요.'); return; }
    const cfg = LINE_EDIT[mode], preset = mode === 'title' ? item.title : '';
    openModal(`<form class="td-modal line-edit-form" data-mode="${mode}" data-event="${eventKey(item)}" role="dialog" aria-modal="true" aria-label="${esc(cfg.label)}"><label class="quick-event-label" for="line-edit-input">${esc(cfg.label)}</label><input id="line-edit-input" name="line" aria-label="${esc(cfg.label)}" value="${esc(preset)}" placeholder="${esc(cfg.placeholder)}" autocomplete="off" spellcheck="false" maxlength="200"><p class="quick-event-preview" aria-live="polite"><span class="quick-event-hint">${esc(mode === 'when' ? `${cfg.hint} · 지금 ${eventPreviewText({ ...item, ok:true, title:'', summary:null }) || ''}` : cfg.hint)}</span></p><p class="quick-event-foot"><span><kbd>Enter</kbd> 저장</span><span><kbd>Esc</kbd> 취소</span></p></form>`);
    const input = modalLayer.querySelector('.line-edit-form [name=line]'); input.setSelectionRange(preset.length, preset.length);
  }
  async function parseLineEdit(form) {
    const item = findEvent(form.dataset.event), line = form.elements.line.value.trim();
    if (!item || !line) return { item, parsed:null };
    const result = await call('mutate', { type:'calendar.parse', payload:{ text:`${line} ${item.title}` } });
    return { item, parsed:result?.parsed || result };
  }
  async function previewLineEdit() {
    const form = modalLayer.querySelector('.line-edit-form[data-mode=when]'); if (!form) return;
    const seq = ++quickEventSeq, { parsed } = await parseLineEdit(form), out = form.querySelector('.quick-event-preview');
    if (seq !== quickEventSeq || !out.isConnected) return;
    out.innerHTML = parsed ? eventPreviewHtml(parsed) : `<span class="quick-event-hint">${esc(LINE_EDIT.when.hint)}</span>`;
  }
  async function submitLineEdit(form) {
    clearTimeout(quickEventTimer);
    const mode = form.dataset.mode, item = findEvent(form.dataset.event), line = form.elements.line.value.trim();
    if (!item || !line) return;
    let patch, done;
    if (mode === 'title') {
      if (line === item.title) { closeModal(); return; }
      patch = { title:line }; done = '제목을 바꿨어요.';
    } else {
      const { parsed } = await parseLineEdit(form);
      if (!parsed?.startsAt) { form.querySelector('.quick-event-preview').innerHTML = '<span class="quick-event-note">＊ 날짜·시각을 읽지 못했습니다</span>'; return; }
      patch = { startsAt:parsed.startsAt, endsAt:parsed.endsAt ?? null, allDay:!!parsed.allDay }; done = `옮겼어요 — ${parsed.summary || eventWhen(parsed)}`;
    }
    const land = async (id, startsAt) => { await selectDate(dateKey(new Date(startsAt))); if (!focusEvent(id, dateKey(new Date(startsAt)))) focusView(); };
    if (item.rrule || item.recurrenceId) {
      closeModal();
      scopeModal(item, { heading: mode === 'title' ? '반복 일정 제목 고치기' : '반복 일정 옮기기', question: mode === 'title' ? `제목을 "${line}"(으)로` : done.replace(/^옮겼어요 — /, ''), verb: mode === 'title' ? '바꾸기' : '옮기기',
        run: async (selected, scope) => { await mutate('event.update', { id:selected.id, recurrenceId:selected.recurrenceId || selected.startsAt, scope, ...patch }); feedback(done); await land(selected.id, patch.startsAt || selected.startsAt); } });
      return;
    }
    const previous = mode === 'title' ? { title:item.title } : { startsAt:item.startsAt, endsAt:item.endsAt ?? null, allDay:!!item.allDay };
    await mutate('event.update', { id:item.id, ...patch });
    closeModal();
    feedback(done, () => mutate('event.update', { id:item.id, ...previous }));
    await land(item.id, patch.startsAt || item.startsAt);
  }
  function projectModal(id = null) {
    const project = state.projects.find(p => p.id === id);
    openModal(`<form class="td-modal project-form" role="dialog" aria-modal="true" aria-label="프로젝트 편집" data-project-id="${id || ''}"><div class="td-modal-header"><h2>${project ? '프로젝트 관리' : '프로젝트 추가'}</h2><button type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div><label class="td-field">이름<input name="name" aria-label="프로젝트 이름" value="${esc(project?.name)}" required></label><div class="td-modal-actions">${project ? `<button type="button" class="td-modal-delete" data-archive-project="${id}">프로젝트 보관</button>` : '<span></span>'}<div><button type="button" class="td-secondary" data-action="close-modal">취소</button><button class="td-primary" type="submit">저장</button></div></div></form>`);
  }
  /* 할 일 편집은 목록 안에서 펼치지 않고 대화상자로 연다(Ctrl+E·Enter·행 클릭, E·D·N·M은 그 칸으로).
   * 같은 data-editor·data-field를 써서 자동 저장과 마감 해석 처리는 목록 편집기와 같다. 닫으면 목록을 새로 그린다. */
  let taskModalKind=null;
  function taskModal(id,field='title') {
    const task=state.tasks.find(item=>item.id===id);if(!task)return;
    taskCursor=id;taskModalKind=task.kind;
    openModal(`<form class="td-modal task-form" role="dialog" aria-modal="true" aria-label="할 일 편집" data-editor="${esc(id)}"><div class="td-modal-header"><h2>할 일 편집</h2><button type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div><label class="td-field">제목<input data-field="title" aria-label="할 일 제목" value="${esc(task.title)}" autocomplete="off" spellcheck="false"></label>${taskEditor(task,{modal:true})}</form>`);
    const element=modalLayer.querySelector(`[data-field="${field}"]`)||modalLayer.querySelector('[data-field=title]');
    element?.focus({preventScroll:true});if(element?.matches('input:not([type=checkbox])'))element.select();if(element?.matches('.td-pick'))openPick(element);
  }
  async function afterTaskModal(id) {
    await flushPending();const task=state.tasks.find(item=>item.id===id);
    // 상태를 바꿨으면 그 분류로 따라간다(목록 편집기와 같다). 완료 기록·프로젝트 화면에서는 그대로.
    if(task&&state.view==='tasks'&&!['done','projects'].includes(state.tab)&&task.kind!==taskModalKind)state.tab=task.kind;
    taskModalKind=null;renderNav();renderMainView();if(state.view==='tasks')focusTask(id);
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
    const entry={label,run};workUndo.push(entry);if(workUndo.length>50)workUndo.shift();
    feedback(message,()=>undoWorkEntry(entry));
  }
  function undoWorkEntry(entry) {
    workUndoTail=workUndoTail.catch(()=>{}).then(async()=>{
      const index=workUndo.lastIndexOf(entry);if(index<0)return;
      await entry.run();workUndo.splice(workUndo.lastIndexOf(entry),1);
      feedback(`되돌림 · ${entry.label}`);focusView();
    });
    return workUndoTail;
  }
  /* 완료·취소를 바꾸기 전 상태로 되돌린다. 취소했던 일을 완료로 바꿨다가 되돌리면 다시 취소다. */
  function restoreClosure(task) {
    const id=task.id;
    return task.cancelled?()=>mutate('task.cancel',{id,cancelled:true}):()=>mutate('task.complete',{id,done:!!task.done});
  }
  async function toggleCancel(id) {
    const task=state.tasks.find(item=>item.id===id);if(!task)return;
    await mutate('task.cancel',{id,cancelled:!task.cancelled});
    rememberWorkUndo(task.title,restoreClosure(task),task.cancelled?'취소를 해제했어요.':'취소했어요.');
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
  /* 전역 단축키: [설정 필드, 라벨, 접근성 이름, 기본값]. 설정 화면과 단축키 안내의 '어디서나'가 함께 쓴다. */
  const hotkey = key => String(key || '').replace(/CommandOrControl|Control/g, 'Ctrl');
  const accelerator = key => String(key || '').replace(/\bCtrl\b/g, 'Control');
  const SHORTCUT_UI = [['hotkey','WHENCOMMAND 열기 · 숨기기','Command 단축키','Alt+Space'],['captureHotkey','할 일 빠르게 담기','빠른 수집 단축키','Control+Alt+Space'],['noteCaptureHotkey','메모 빠르게 담기','메모 수집 단축키','Control+Alt+M'],['mediaPlayHotkey','음악 재생 · 일시정지','음악 재생 단축키','Control+Alt+P'],['mediaRewindHotkey','음악 10초 되감기','음악 되감기 단축키','Control+Alt+Left'],['mediaForwardHotkey','음악 10초 앞으로','음악 앞으로 단축키','Control+Alt+Right']];
  /* 하단 상황 힌트: 포커스 자리에 맞는 키 몇 칸. 화면 낭독기는 Ctrl+/ 안내를 쓴다. */
  function hintContext() {
    if (state.shell !== 'dashboard' || helpOpen) return null;
    const active = document.activeElement;
    if (!modalLayer.hidden) return active?.closest('.line-edit-form') ? 'lineEdit' : active?.closest('.quick-event-form') ? 'quickEvent' : active?.closest('.task-form') ? 'taskEditor' : modalLayer.querySelector('.scope-form') ? 'scopeDialog' : modalLayer.querySelector('.event-form,.project-form,.work-due-form,.work-waiting-form,.work-archive-form') ? 'dialog' : 'dialogClose';
    if (pick) return pick.options.some(option => option.num) ? 'pickNumbered' : 'pick';
    if (state.view === 'tasks') {
      if (active?.closest('[data-editor]')) return 'taskEditor';
      if (active?.matches('[data-work-search]')) return 'workSearch';
      if (active?.closest('.td-quick')) return 'workQuick';
      return state.tab === 'projects' ? 'projects' : 'tasks';
    }
    if (state.view === 'notes') {
      if (active?.matches('[data-note-editor]')) return 'noteEditor';
      if (active?.closest('[data-note-preview]')) return 'notePreview';
      if (active?.matches('[data-note-search]')) return 'noteSearch';
      return 'notes';
    }
    if (state.view === 'calendar') return active?.closest('[data-event]') ? 'event' : state.calView === 'month' ? 'calendarMonth' : 'calendarList';
    if (state.view === 'settings') return state.settingsTab === 'shortcuts' ? 'settingsShortcuts' : 'settings';
    return 'home';
  }
  let hintsFrame = 0, hintsShown = '';
  function syncHints() {
    cancelAnimationFrame(hintsFrame);
    hintsFrame = requestAnimationFrame(() => {
      const context = hintContext(); if (context === hintsShown) return; hintsShown = context;
      root.querySelector('.td-hints').innerHTML = context ? K.hints(context).map(({ keys, label }) => `<span><kbd>${esc(keys)}</kbd>${esc(label)}</span>`).join('') : '';
    });
  }
  /* 업데이트 상태는 설정 화면의 한 줄과 버튼만 바꾼다(포커스를 옮기지 않는다). */
  function syncUpdate(value) {
    state.update = value; if (state.view !== 'settings') return;
    const line = body.querySelector('[data-update-line]'); if (line) line.textContent = value?.line || '';
    const check = body.querySelector('[data-action=update-check]'); if (check) check.disabled = !value?.supported;
    const install = body.querySelector('[data-action=update-install]'); if (install) install.disabled = value?.status !== 'ready';
  }
  /* 대시보드의 Tab 정지점: 글자·선택 입력과 목록 항목만. 버튼은 단축키로 다루므로 건너뛴다(사이드바·도구 버튼·편집기의 삭제/접기 등). */
  function tabStops() {
    return [...root.querySelectorAll('#cf-dashboard-panel :is(input:not([type=hidden]),select,textarea,[tabindex],button[data-reveal],button.td-pick,[role=option])')]
      .filter(element => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length && !element.closest('[hidden],.td-sidebar') && !element.matches('input[type=checkbox],input[type=radio]')
        && (element.tagName !== 'BUTTON' || element.matches('[data-reveal],[role=option],[data-task-row],[data-work-project-row],.td-pick')));
  }
  function nextTabStop(from, backwards = false) {
    // 문서 순서로 바로 다음(앞) 정지점. 지금 자리를 감싼 목록 행은 건너뛴다 — 편집기 안에서 행으로 되돌아가 갇히지 않게.
    const stops = tabStops().filter(element => element !== from && !element.contains(from)); if (!stops.length) return null;
    const after = stops.filter(element => from.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
    const before = stops.filter(element => from.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING);
    return backwards ? before.at(-1) || stops.at(-1) : after[0] || stops[0];
  }
  const SETTINGS_TABS=[['general','일반'],['shortcuts','단축키']];
  function swatch([bg,fg,signal],skin){
    return `<span class="theme-swatch sw-${skin}" style="background:${bg};color:${fg}" aria-hidden="true"><span class="sw-key">A</span><span class="sw-lines"><i style="background:${fg}"></i><i style="background:${fg};opacity:.5"></i><i style="background:${signal};width:45%"></i></span><span class="sw-band" style="background:${signal}"></span></span>`;
  }
  function lookCard(kind,id,name,note,colors,skin,on){
    return `<button type="button" role="radio" class="theme-card ${on ? 'on' : ''}" data-${kind}-pick="${id}" aria-checked="${on}" tabindex="${on ? 0 : -1}">${swatch(colors,skin)}<span class="theme-name">${esc(name)}<span class="theme-on" ${on ? '' : 'hidden'}>사용 중</span></span><span class="theme-note">${esc(note)}</span></button>`;
  }
  function themeCards(){
    const current = themeById(state.theme);
    return `<h3>스킨</h3><div class="theme-grid" role="radiogroup" aria-label="스킨">${SKINS.map(skin => lookCard('skin',skin.id,skin.name,skin.note,themesOf(skin.id)[0].colors,skin.id,skin.id === current.skin)).join('')}</div>
      <h3>테마</h3><div class="theme-grid" role="radiogroup" aria-label="색 테마" data-theme-grid>${themesOf(current.skin).map(theme => lookCard('theme',theme.id,theme.name,theme.note,theme.colors,theme.skin,theme.id === current.id)).join('')}</div>`;
  }
  // 앱 아이콘: 고르면 창·트레이 아이콘이 바로 바뀐다(메인 applyAppIcon). 설치 파일 아이콘은 첫 아이콘으로 고정
  function iconCards(){
    const current = state.prefs.appIcon || APP_ICONS[0].id;
    return `<div class="theme-grid icon-grid" role="radiogroup" aria-label="앱 아이콘">${APP_ICONS.map((item,index) => { const on = item.id === current; return `<button type="button" role="radio" class="theme-card ${on ? 'on' : ''}" data-icon-pick="${item.id}" aria-checked="${on}" tabindex="${on ? 0 : -1}"><img src="../assets/icons/${item.id}.png" alt="" width="64" height="64"><span class="theme-name">${String(index+1).padStart(2,'0')} ${esc(item.name)}<span class="theme-on" ${on ? '' : 'hidden'}>사용 중</span></span><span class="theme-note">${esc(item.note)}</span></button>`; }).join('')}</div><p class="icon-help">고르면 트레이와 창 아이콘이 바로 바뀌어요. 설치 파일의 아이콘은 01 ${esc(APP_ICONS[0].name)}예요.</p>`;
  }
  async function pickIcon(id){
    if(id===(state.prefs.appIcon||APP_ICONS[0].id)||!APP_ICONS.some(item=>item.id===id))return;
    state.prefs={...state.prefs,appIcon:id}; look(); state.prefs=await call('preferences.set',{appIcon:id});
  }
  async function pickTheme(id){
    if(id===state.theme||!THEMES.some(theme=>theme.id===id))return;
    state.theme=id; look(); state.prefs=await call('preferences.set',{theme:id});
  }
  // 스킨을 고르면 그 스킨에서 마지막으로 고른 테마(없으면 첫 테마)로 바꾸고 테마 목록을 그 스킨 것으로 다시 그린다
  async function pickSkin(skin){
    if(skin===themeById(state.theme).skin||!SKINS.some(value=>value.id===skin))return;
    const remembered=state.prefs.skinThemes?.[skin];
    state.theme=themesOf(skin).some(theme=>theme.id===remembered)?remembered:themesOf(skin)[0].id;
    const grid=body.querySelector('[data-theme-grid]');
    if(grid)grid.innerHTML=themesOf(skin).map(theme=>lookCard('theme',theme.id,theme.name,theme.note,theme.colors,theme.skin,theme.id===state.theme)).join('');
    look(); state.prefs=await call('preferences.set',{skin});
  }

  function setSettingsTab(value) { if (!SETTINGS_TABS.some(([tab]) => tab === value)) return; state.settingsTab = value; renderMainView(); body.querySelector(`[data-settings-tab="${value}"]`)?.focus({preventScroll:true}); syncHints(); }
  /* 설정은 두 분류다: 일반(모양·시작과 알림·Command·업데이트·데이터)과 단축키(전역 단축키). ←→로 분류를 바꾼다. */
  function settingsView() {
    const shortcutFields = SHORTCUT_UI, tab = state.settingsTab;
    const tabs = `<div class="cal-views settings-tabs" role="tablist" aria-label="설정 분류">${SETTINGS_TABS.map(([value,label]) => `<button role="tab" data-settings-tab="${value}" aria-selected="${tab === value}" tabindex="${tab === value ? 0 : -1}">${label}</button>`).join('')}</div>`;
    if (tab === 'shortcuts') return tabs + `<form class="preferences-form"><section class="settings-section"><h2>어디서나 쓰는 단축키</h2><p class="settings-lead">다른 앱을 쓰는 중에도 바로 부르는 전역 단축키입니다. 칸을 고른 뒤 조합을 누르면 바로 저장되고, Delete는 해제, Esc는 저장된 값으로 되돌립니다.</p>${shortcutFields.map(([field,label,aria,fallback]) => `<label class="td-field">${label}<input name="${field}" data-shortcut="${field}" aria-label="${aria}" aria-describedby="shortcut-error-${field}" aria-invalid="${!!state.info.shortcutErrors?.[field]}" value="${esc(hotkey(state.prefs[field] ?? fallback))}" placeholder="사용 안 함" autocomplete="off" spellcheck="false"><span id="shortcut-error-${field}" class="settings-warning" data-shortcut-error="${field}" ${state.info.shortcutErrors?.[field] ? '' : 'hidden'}>${esc(state.info.shortcutErrors?.[field])}</span></label>`).join('')}<div class="settings-actions"><button class="td-secondary" type="button" data-action="help">앱 안 단축키 보기 (Ctrl+/)</button></div></section></form>`;
    return tabs + `<section class="settings-section theme-section"><h2>모양</h2>${themeCards()}<h3>앱 아이콘</h3>${iconCards()}<h3>할 일 표시</h3><label class="td-field settings-marker">완료 표시 방식${pickButton('data-pref="taskMarker" aria-label="할 일 완료 표시 방식"',state.prefs.taskMarker||'symbol',[{value:'symbol',label:'불릿 저널 기호 (• × > < …)'},{value:'checkbox',label:'체크박스'}])}</label><small class="settings-path">기호: • 할 일 · × 완료 · 줄 그음 취소(C) · &gt; 미룬 일 · &lt; 마감이 남은 일 · … 대기. 어느 쪽이든 Space는 완료, C는 취소입니다.</small></section>
    <section class="settings-section"><h2>시작과 알림</h2><label class="settings-check"><input type="checkbox" data-pref="launchAtLogin" ${state.prefs.launchAtLogin ? 'checked' : ''} ${state.info.launchAtLoginSupported ? '' : 'disabled'}>로그인할 때 트레이에 숨겨 실행</label>${state.info.launchAtLoginSupported ? '' : '<small class="settings-path">배포본에서만 설정할 수 있습니다.</small>'}<label class="settings-check"><input type="checkbox" data-pref="briefEnabled" ${state.prefs.briefEnabled !== false ? 'checked' : ''}>아침 브리핑 알림</label><label class="td-field settings-time">브리핑 시각<input type="time" data-pref="briefAt" aria-label="아침 브리핑 시각" value="${esc(state.prefs.briefAt || '09:00')}"></label><small class="settings-path">하루 한 번, 정한 시각부터 3시간 안에 켜져 있으면 오늘 마감·지연·일정·Waiting·InBox를 알립니다.</small></section>
    <section class="settings-section"><h2>업데이트</h2><p class="settings-update" data-update-line role="status">${esc(state.update?.line || '')}</p><div class="settings-actions"><button class="td-secondary" type="button" data-action="update-check" ${state.update?.supported ? '' : 'disabled'}>지금 확인</button><button class="td-secondary" type="button" data-action="update-install" ${state.update?.status === 'ready' ? '' : 'disabled'}>재시작해 설치</button></div></section>
    <section class="settings-section"><h2>데이터</h2><div class="settings-actions"><button class="td-secondary" data-data="importLegacy">기존 데이터 복사해 가져오기</button><button class="td-secondary" data-data="export">백업 내보내기</button><button class="td-secondary" data-data="restore">백업 복원</button><button class="td-secondary" data-data="openFolder">저장 폴더 열기</button></div><small class="settings-path">${esc(state.info.dataDir)}</small></section><section class="settings-section"><h2>WHENCOMMAND</h2><label class="settings-check"><input type="checkbox" data-pref="clipboardRow" ${state.prefs.clipboardRow !== false ? 'checked' : ''}>빈 입력에 클립보드로 할 수 있는 것 보이기</label><button class="td-secondary" data-action="refresh-command">검색 목록 새로고침</button></section><section class="settings-section"><h2>WHENDESK ${esc(state.info.version || '')}</h2><button class="td-secondary" data-action="quit">앱 종료</button></section>`;
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
    if (event.key === 'Escape') { event.preventDefault(); input.value = hotkey(state.prefs[input.dataset.shortcut] ?? ''); shortcutErrors(); return; }
    if (['Control','Alt','Shift','Meta'].includes(event.key)) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ['KeyA','KeyV','KeyC','KeyX'].includes(event.code)) return;
    event.preventDefault(); if (event.repeat) return;
    if (!event.ctrlKey && !event.altKey && !event.metaKey && ['Backspace','Delete'].includes(event.key)) { input.value = ''; shortcutErrors(); saveShortcutsSoon(input); return; }
    const keyMap = { Space:'Space', Enter:'Enter', Escape:'Escape', Backspace:'Backspace', Delete:'Delete', Insert:'Insert', Home:'Home', End:'End', PageUp:'PageUp', PageDown:'PageDown', ArrowUp:'Up', ArrowDown:'Down', ArrowLeft:'Left', ArrowRight:'Right', Slash:'/', Backslash:'\\', Minus:'-', Equal:'=', Semicolon:';', Quote:"'", Comma:',', Period:'.', BracketLeft:'[', BracketRight:']', Backquote:'`' };
    const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : /^F\d{1,2}$/.test(event.code) ? event.code : keyMap[event.code];
    if (!key || !event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d+$/.test(key)) return;
    input.value = [event.ctrlKey && 'Ctrl',event.altKey && 'Alt',event.shiftKey && 'Shift',event.metaKey && 'Super',key].filter(Boolean).join('+');
    shortcutErrors(); saveShortcutsSoon(input);
  }
  let shortcutTimer = null;
  function saveShortcutsSoon(input) { clearTimeout(shortcutTimer); shortcutTimer = setTimeout(() => { if (input.isConnected) input.form?.requestSubmit(); }, 300); }
  function commandIcon(item) {
    const names = { apps:'app-window', files:'file', calc:'calculator', tasks:'circle-check', work:'circle-check', events:'calendar-days', calendar:'calendar-days', notes:'notebook-pen', scripts:'file-code', system:'settings-2', builtin:'command', siblings:'command' };
    return names[item.source] || (/^[a-z-]+$/.test(item.icon || '') ? item.icon : 'command');
  }
  /* 매칭 위치를 강조한다 — 초성·자판 교정으로 왜 걸렸는지 설명 없이 보인다(원본 WHENCOMMAND panel.js highlight). positions는 UTF-16 인덱스. */
  function highlightTitle(title, positions) {
    const marks = new Set(positions || []); let out = '';
    for (let index = 0; index < title.length; index++) out += marks.has(index) ? `<em>${esc(title[index])}</em>` : esc(title[index]);
    return out;
  }
  const iconImages = new Map();
  function commandIconPath(item) { return ['apps', 'files'].includes(item.source) || item.key === 'clip:path' ? item.path || null : null; }
  function commandAvatar(item) {
    const file = commandIconPath(item), image = file && iconImages.get(file);
    if (image) return `<span class="command-icon is-image"><img src="${esc(image)}" alt=""></span>`;
    if (item.source !== 'apps') return icon(commandIcon(item));
    let hash = 0; for (const ch of item.title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const hue = hash % 360, letter = item.title.trim()[0]?.toUpperCase() || '?';
    return `<span class="command-icon is-letter" style="background:linear-gradient(140deg,hsl(${hue} 55% 58%),hsl(${(hue + 30) % 360} 50% 42%))">${esc(letter)}</span>`;
  }
  // 그려진 줄 중 아이콘을 아직 모르는 것만 묻고, 도착하면 그 줄의 상자만 바꾼다(목록을 다시 그리지 않는다).
  async function fetchCommandIcons() {
    const want = [...new Set(command.items.map(commandIconPath).filter(file => file && !iconImages.has(file)))];
    if (!want.length) return;
    want.forEach(file => iconImages.set(file, null));
    const got = await call('command.icons', { paths:want }).catch(() => ({}));
    for (const [file, url] of Object.entries(got || {})) iconImages.set(file, url || null);
    commandBox.querySelectorAll('[data-result]').forEach(row => {
      const item = command.items[Number(row.dataset.result)], file = item && commandIconPath(item);
      if (file && iconImages.get(file)) row.querySelector('.command-icon,svg,i')?.replaceWith(Object.assign(document.createElement('span'), { innerHTML:commandAvatar(item) }).firstElementChild);
    });
  }
  function renderCommand() {
    // 담기 모드의 결과 자리는 접두 기호 미리보기 한 줄만 쓴다(검색하지 않는다).
    if (command.capture) { commandBox.innerHTML = capturePreview; commandBox.hidden = !capturePreview; icons(); resizeCommand(); return; }
    command.selected = Math.max(0, Math.min(command.selected, Math.max(0, command.items.length-1)));
    const scrollTop = root.querySelector('#cf-command-panel').scrollTop;
    commandBox.innerHTML = `${command.items.map((item,index) => `<button id="command-option-${index}" class="td-command-result ${index === command.selected ? 'selected' : ''}" data-result="${index}" data-result-key="${esc(item.key)}" role="option" aria-selected="${index === command.selected}" tabindex="-1" ${command.running ? 'disabled' : ''}>${commandAvatar(item)}<span class="command-result-text"><span class="command-result-title">${highlightTitle(item.title, item.positions)}</span>${item.subtitle ? `<small class="command-subtitle" title="${esc(item.subtitle)}">${esc(item.subtitle)}</small>` : ''}</span><small>${esc(({apps:'앱',files:'파일',calc:'계산',tasks:'할 일',work:'할 일',events:'일정',calendar:'일정',notes:'메모',scripts:'명령',system:'시스템',builtin:'명령',clip:'클립보드'})[item.source] || (item.key?.startsWith('clip:') ? '클립보드' : ''))}</small></button>`).join('')}${command.items.length || !command.query.trim() && !command.pending ? '' : `<div class="command-empty" role="status">${command.pending ? '검색 중…' : '결과 없음'}</div>`}`;
    if(command.notice&&command.query.trim())commandBox.insertAdjacentHTML('beforeend','<div class="command-notice" role="status">'+esc(command.notice)+'</div>');
    commandBox.hidden = !!command.actions || !command.items.length && !command.query.trim() && !command.pending;
    if (command.actions) renderCommandActions();
    syncCommandSelection();
    root.querySelector('#cf-command-panel').scrollTop = scrollTop;
    icons(); resizeCommand(); safe(fetchCommandIcons);
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
  /* 스크립트 출력 화면(원본 WHENCOMMAND D-17·EXT-04·05): 길거나 실패한 출력. 종료 코드·걸린 시간·실패 위치를 보이고
   * Enter 다시 실행 · Ctrl+Enter 스크립트 열기 · Ctrl+C 복사 · Esc 닫기. */
  function outputText(output) { return output.code !== 0 ? (String(output.stderr || '').trim() || String(output.stdout || '').trim() || '(출력 없음)') : String(output.stdout || '').replace(/\s+$/, ''); }
  function showCommandOutput(output) {
    command.output = output;
    const failed = output.code !== 0, text = outputText(output), lines = text ? text.split('\n').length : 0;
    const where = String(output.path || '').replace(/\\/g, '/') + (output.line != null ? ':' + output.line : '');
    const element = root.querySelector('.command-output'); element.hidden = false;
    element.innerHTML = `<div class="command-output-head ${failed ? 'is-failed' : ''}"><strong>${esc(output.title || '스크립트')}</strong><span>${failed ? '실패' : '완료'} · exit ${output.code ?? '—'} · ${failed ? 'stderr' : lines + '줄'} · ${((output.ms || 0) / 1000).toFixed(1)}초</span></div><pre>${esc(text)}${failed && where ? `\n<span class="command-output-where">${esc(where)}</span>` : ''}</pre><p class="command-output-keys">Enter 다시 실행 · Ctrl+Enter 스크립트 열기 · Ctrl+C 복사 · Esc 닫기</p>`;
    resizeCommand();
  }
  function clearCommandOutput() {
    command.output = null;
    const output = root.querySelector('.command-output'); output.hidden = true; output.replaceChildren();
  }
  function outputKeys(event) {
    const output = command.output; if (!output || state.shell !== 'command') return false;
    if (K.is(event, 'output.copy') && !window.getSelection()?.toString()) { event.preventDefault(); call('command.copy', { text:outputText(output) }).then(() => commandNotice('출력을 복사했습니다')).catch(showError); return true; }
    if (K.is(event, 'output.open')) { event.preventDefault(); if (!event.repeat) safe(async () => { clearCommandOutput(); await call('command.run', { key:output.key, actionId:'edit', query:output.query }); await call('window.close'); }); return true; }
    if (K.is(event, 'output.rerun')) { event.preventDefault(); if (!event.repeat && !command.running) safe(() => executeCommand({ item:{ key:output.key, actions:[] }, query:output.query })); return true; }
    return false;
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
  function clearCommandNotice() { clearTimeout(commandNoticeTimer); commandNoticeTimer = null; commandInput.placeholder = command.capture ? CAPTURE[command.capture].placeholder : '검색 또는 실행'; commandInput.classList.remove('has-notice'); }
  /* 빠른 담기 모드: Command 입력줄을 한 줄 수집에 쓴다(원본 WHENWORK·WHENNOTE의 수집 창).
   * 검색하지 않고 Enter로 담은 뒤 입력을 비워 연달아 담는다. Ctrl+Enter는 담고 열기, Tab은 앱에서 열기, Esc는 닫기. */
  const CAPTURE = {
    task:{ placeholder:'InBox에 담기', type:'task.create', payload:text => ({ title:text }), label:'InBox에 담았습니다', undo:item => ({ type:'task.delete', payload:{ id:item.id } }), open:item => ({ view:'tasks', tab:'inbox', id:item.id }), section:'inbox' },
    note:{ placeholder:'메모 담기', type:'note.create', payload:text => ({ body:text }), label:'메모에 담았습니다', undo:item => ({ type:'note.delete', payload:{ id:item.id } }), open:item => ({ view:'notes', id:item.id, edit:true }), section:'notes' },
  };
  /* 접두 기호로만 고르는 받을 곳. 일정은 담기 단축키가 따로 없어 여기서만 쓴다. */
  const RAPID = {
    task:CAPTURE.task, note:CAPTURE.note,
    event:{ label:'일정에 담았습니다', undo:item => ({ type:'event.delete', payload:{ id:item.id, scope:'all' } }), open:item => ({ view:'calendar', id:item.id, date:item.date }),
      async save(text) {
        const result = await call('mutate', { type:'calendar.parse', payload:{ text } }), parsed = result?.parsed || result;
        if (parsed?.ok === false || !parsed?.startsAt) throw new Error('일정의 제목이 없습니다. 예: o 내일 오후 3시 치과');
        return { item:await mutate('event.create', parsed), line:[parsed.summary || eventWhen(parsed), parsed.title].filter(Boolean).join(' ') };
      } },
  };
  function enterCapture(kind) {
    if (!CAPTURE[kind]) return; command.capture = kind; capturePreview = ''; capturePreviewSeq++; root.classList.add('is-capture');
    // 입력을 시작하면 자리 표시 문구가 사라지므로, 어디에 담기는지는 입력줄 오른쪽에 계속 보인다.
    root.querySelector('.td-command').dataset.captureLabel = kind === 'note' ? '메모에 담기 · Enter' : 'InBox에 담기 · Enter';
    // 대시보드에서 남은 알림이 담기 미리보기 줄을 덮지 않게 닫는다. 되돌리기는 U 타임라인에 남아 있다.
    root.querySelector('.td-feedback').hidden = true;
    commandInput.value = ''; queueCommandQuery('', 0, true); clearCommandNotice(); commandInput.focus({ preventScroll:true });
  }
  function exitCapture() { if (!command.capture) return; command.capture = null; root.classList.remove('is-capture'); clearCommandNotice(); capturePreviewSeq++; capturePreview = ''; }
  /* 접두 기호가 받을 곳을 바꾸면 무엇으로 담길지 입력줄 아래 한 줄로 미리 보인다. 일정은 날짜·시간 해석까지 보인다. */
  const RAPID_PREVIEW = { task:['할 일','circle-plus'], event:['일정','calendar-plus'], note:['메모','notebook-pen'] };
  async function previewCapture() {
    const seq = ++capturePreviewSeq, parsed = window.WhendeskRapid?.parse(commandInput.value.trim());
    const rapid = parsed && parsed.kind !== command.capture ? parsed : null;
    let line = '';
    if (rapid?.kind === 'event') {
      const result = await call('mutate', { type:'calendar.parse', payload:{ text:rapid.text } }).catch(() => null), when = result?.parsed || result;
      line = when ? eventPreviewText(when) : '일정을 읽지 못했습니다';
    } else if (rapid) line = rapid.text.split('\n')[0];
    if (seq !== capturePreviewSeq || !command.capture) return;
    const [label, glyph] = RAPID_PREVIEW[rapid?.kind] || [];
    capturePreview = rapid ? `<div class="command-capture-preview" role="status">${icon(glyph)}<span><b>${label}</b> · ${esc(line)}</span></div>` : '';
    renderCommand();
  }
  async function saveCapture({ open = false } = {}) {
    // 메모 담기에서 "- "는 Markdown 목록이라 떼지 않는다.
    const raw = commandInput.value.trim(), parsed = window.WhendeskRapid?.parse(raw), rapid = parsed && !(parsed.kind === 'note' && command.capture === 'note') ? parsed : null;
    const kind = rapid ? RAPID[rapid.kind] : CAPTURE[command.capture], text = rapid ? rapid.text : raw;
    if (!CAPTURE[command.capture] || !kind || !text || command.running) return;
    command.running = true;
    try {
      const saved = kind.save ? await kind.save(text) : { item:await mutate(kind.type, kind.payload(text)), line:text.split('\n')[0] }, item = saved.item;
      commandInput.value = ''; previewCapture();
      const undo = kind.undo(item); undoTimeline.push(() => mutate(undo.type, undo.payload)); if (undoTimeline.length > 50) undoTimeline.shift();
      if (open) { exitCapture(); await navigate(kind.open(item)); return; }
      commandNotice(`${kind.label} · ${saved.line}`);
    } finally { command.running = false; }
  }
  /* 한글 조합 중에 눌린 ↑↓·Enter: 브라우저는 확정에만 쓰고 같은 키를 다시 보내지 않으므로 확정 뒤 여기서 마저 처리한다. */
  const COMPOSITION_KEYS = ['ArrowDown','ArrowUp','Enter','NumpadEnter'];
  function deferCompositionKey(event) {
    if (state.shell !== 'command' || event.target !== commandInput || !COMPOSITION_KEYS.includes(event.code)) return;
    command.afterComposition = { code:event.code, mod:!!(event.ctrlKey || event.metaKey), alt:event.altKey };
  }
  function runDeferredKey({ code, mod, alt }) {
    command.deferredKey = null; command.deferredCode = null;
    if (state.shell !== 'command' || document.activeElement !== commandInput || helpOpen) return;
    const enter = code === 'Enter' || code === 'NumpadEnter';
    if (command.capture) { if (enter) safe(() => saveCapture({ open:mod })); return; }
    if (!enter) { if (!command.actions) moveCommandSelection(code === 'ArrowDown' ? 1 : -1); return; }
    if (command.running || command.activating) return;
    if (alt && !mod) { safe(openCommandActions); return; }
    const menu = command.actions;
    safe(() => menu ? executeCommand({ item:menu.item, query:menu.query, actionId:menu.item.actions[menu.selected]?.id }) : executeCommand({ alternate:mod && !alt }));
  }
  function queueCommandQuery(query, delay = 0, force = false) {
    if (command.running || !force && query === command.query) return;
    clearTimeout(command.timer); command.timer = null;
    ++command.seq; command.request = null; command.more = null;
    notifyCommandWaiters();
    command.query = query; command.renderedQuery = null; if (!query.trim()) command.items = []; command.selected = 0; command.pending = !!query.trim(); command.notice = '';
    closeCommandActions(false); clearCommandOutput(); renderCommand();
    command.timer = setTimeout(() => { command.timer = null; safe(() => queryCommand(commandInput.value)); }, query.trim() ? delay : 0);
  }
  function applyCommandMore(message) {
    if (message.seq !== command.seq || message.query != null && message.query !== command.query.trim().slice(0,8192)) return;
    if (command.request || command.running) { command.more = message; return; }
    const selectedKey = command.items[command.selected]?.key;
    if (message.replace && command.items.length) {
      // 늦게 합류한 결과(파일)는 커서까지의 행을 그대로 두고 그 아래만 다시 섞는다(원본 WHENCOMMAND D-11).
      // 방향키를 누른 직후 도착해도 보던 줄이 밀리거나 선택이 튀지 않는다.
      const keep = Math.min(command.selected + 1, command.items.length), fixed = command.items.slice(0, keep), fixedKeys = new Set(fixed.map(item => item.key));
      command.items = [...fixed, ...(message.items || []).filter(item => !fixedKeys.has(item.key))].slice(0,12);
    } else if (message.replace) command.items = (message.items || []).slice(0,12);
    else { const existing = new Set(command.items.map(item => item.key)); command.items = [...command.items, ...(message.items || []).filter(item => !existing.has(item.key))].slice(0,12); }
    command.selected = Math.max(0, command.items.findIndex(item => item.key === selectedKey));
    command.pending = !!message.pending; if ('notice' in message) command.notice = message.notice || '';
    renderCommand();
    if (state.shell === 'command' && !command.actions && !helpOpen && document.activeElement === commandInput) syncCommandSelection(true);
    notifyCommandWaiters();
  }
  function queryCommand(query, preserve = false) {
    if (command.running) return Promise.resolve(false);
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
      // Command에서 바꾼 것도 화면 쪽 U·Ctrl+Z로 되돌릴 수 있게 같은 기록에 쌓는다.
      if (result?.undo) { const { type, payload } = result.undo; undoTimeline.push(() => mutate(type, payload)); if (undoTimeline.length > 50) undoTimeline.shift(); }
      if (result?.message) { if (cleared && state.shell === 'command') commandNotice(result.message); else feedback(result.message); }
      if (result?.output) showCommandOutput({ ...result.output, title:result.title, key:item.key, query });
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
    // 마지막 항목을 옮기거나 지워 목록이 비면 포커스가 사라져 Tab이 InBox 입력칸으로 갔다. 지금 분류 탭에 두어 Tab으로 다른 분류로 넘어가게 한다.
    if(!row&&state.view==='tasks'&&state.tab!=='projects'&&!body.contains(document.activeElement)&&modalLayer.hidden)root.querySelector('.td-work-nav [aria-selected=true]')?.focus({preventScroll:true});
  }
  function workCursorKey(){return `${state.tab}|${state.project??''}`;}
  /* 앱이 스스로 옮긴 포커스(화면 진입·펼치기)는 표시하지 않는다. 사용자가 키를 누르면 그때부터 보인다. */
  function quietFocus() { root.classList.add('focus-quiet'); }
  function focusView() {
    quietFocus(); syncHints();
    if(state.view==='notes'){notes?.focus();return;}
    if(state.view==='tasks'){if(state.tab==='projects'){focusWorkProject();return;}syncTaskCursor();if(taskCursor)focusTask();else root.querySelector('.td-work-nav [aria-selected=true]')?.focus({preventScroll:true});return;}
    if(state.view==='calendar'){if(state.calView==='month'){body.querySelector(`[data-date="${state.date}"]`)?.focus({preventScroll:true});return;}(body.querySelector(`[data-cal-day="${state.date}"] [data-event]`)||body.querySelector('[data-cal-home]'))?.focus({preventScroll:true});return;}
    if(state.view==='settings'){body.querySelector('.settings-tabs [aria-selected=true]')?.focus({preventScroll:true});return;}
    (dashboardItems()[0]||body.querySelector('button'))?.focus({preventScroll:true});
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
  /* Esc는 맨 위 하나만 끝낸다: 실행 대기 → 동작 목록 → 대화상자 → 편집 → 필터·하위 화면 → 화면 기본 자리 → 숨기기(대시보드) / 입력 지우기 → 숨기기(Command). */
  async function escapeStep() {
    if(command.activating&&!command.running)return cancelCommandActivation();
    if(command.actions)return closeCommandActions();
    if(!modalLayer.hidden)return closeModalSafely();
    if(state.shell==='dashboard'){
      if(state.view==='tasks'&&state.selected)return collapseTaskEditor();
      if(clearViewFilter())return;
      const before=document.activeElement;focusView();
      if(document.activeElement!==before&&document.activeElement!==document.body)return;
      // 대시보드의 마지막 Esc는 Command로 돌아가지 않고 창을 숨긴다. Command는 단축키로 다시 부른다.
      await flushPending();return call('window.close');
    }
    if(!root.querySelector('.command-output').hidden){clearCommandOutput();resizeCommand();return call('window.close');}
    if(commandInput.value){commandInput.value='';clearCommandNotice();if(!command.capture)queueCommandQuery('',0,true);return;}
    exitCapture();return call('window.close');
  }
  const MENU_ORDER = ['dashboard','work','notes','calendar'];
  function cycleMenu(direction) {
    const current = state.view === 'tasks' ? 'work' : state.view === 'settings' ? 'calendar' : state.view;
    const index = MENU_ORDER.indexOf(current);
    return goSection(MENU_ORDER[((index < 0 ? -1 : index) + direction + MENU_ORDER.length) % MENU_ORDER.length]);
  }
  async function goSection(section) {
    // 할 일 편집 대화상자는 자동 저장이라 화면을 옮기면 조용히 닫는다(저장은 아래 flushPending).
    if(modalLayer.querySelector('.task-form')){modalLayer.hidden=true;modalLayer.innerHTML='';modalDirty=false;taskModalKind=null;}
    if(section==='settings'||section==='shortcuts')state.settingsTab=section==='shortcuts'?'shortcuts':'general';
    const route={settings:{settings:true,view:'settings'},shortcuts:{settings:true,view:'settings'},dashboard:{view:'dashboard'},work:{view:'tasks',tab:state.tab},todo:{view:'tasks',tab:'todo'},inbox:{view:'tasks',tab:'inbox'},waiting:{view:'tasks',tab:'waiting'},done:{view:'tasks',tab:'done'},notes:{view:'notes'},calendar:{view:'calendar'}}[section];
    if(!route)return;
    // 캘린더는 오늘 보기가 기본이다. 오늘 보기로 들어갈 때는 날짜도 오늘에 맞춘다.
    if(section==='calendar'&&state.calView==='today')route.date=dateKey();
    await flushPending();state.project=null;state.selected=null;dashboardReturn=null;dashboardFocus=null;await navigate(route);focusView();
  }
  async function newInContext() {
    if(state.shell==='command'||state.view==='dashboard'||state.view==='settings')await goSection('inbox');
    if(state.view==='notes'){await notes?.create();return;}
    if(state.view==='calendar'){quickEventModal();return;}
    if(state.view==='tasks'&&state.tab==='projects'){projectModal();return;}
    root.querySelector('.td-quick input')?.focus();
  }
  async function openTaskField(id,field='title') {await flushPending();if(!state.tasks.some(task=>task.id===id))return;if(state.selected){state.selected=null;renderMainView();}taskModal(id,field);}
  async function collapseTaskEditor() {const id=state.selected;await flushPending();state.selected=null;renderMainView();focusTask(id);}
  async function taskKeyboardAction(id,action) {
    const task=visibleTasks().find(item=>item.id===id);if(!task)return;
    if(task.archived){if(['open','complete','cancel'].includes(action))return reviveTask(id);return;}
    const before=visibleTasks(),index=before.findIndex(item=>item.id===id);
    if(action==='open')return openTaskField(id);
    if(action==='due')return dueModal(id);
    if(['title','note','project_id','kind'].includes(action))return openTaskField(id,action);
    if(action==='nudge')return nudgeTask(id);
    if(action==='waiting')return waitingModal(id);
    if(action==='complete'){await mutate('task.complete',{id,done:!task.done});rememberWorkUndo(task.title,restoreClosure(task),task.done?'완료를 해제했어요.':'완료했어요.');}
    if(action==='cancel')await toggleCancel(id);
    if(action==='delete')return deleteTask(id);
    const after=visibleTasks();if(!after.some(item=>item.id===state.selected))state.selected=null;focusTask(after[Math.min(Math.max(index,0),after.length-1)]?.id||null);
  }
  async function undoLastAction() {
    const action=undoTimeline.pop();if(!action){feedback('되돌릴 작업이 없어요.');return;}
    if(undoAction===action){undoAction=null;root.querySelector('.td-feedback').hidden=true;}
    await action();if(state.view!=='notes')focusView();
  }
  /* 1~9: 활성 프로젝트 목록 순서로 바로 지정한다(원본 WHENWORK). InBox 항목은 도메인 규칙대로 ToDo로 옮겨진다. */
  async function assignProjectByNumber(id,number) {
    const task=visibleTasks().find(item=>item.id===id),project=state.projects[number-1];
    if(!task||task.archived)return;if(!project){feedback(`${number}번 프로젝트가 없어요.`);return;}
    if(task.project_id===project.id)return;
    const before=visibleTasks(),index=before.findIndex(item=>item.id===id),previous={project_id:task.project_id,kind:task.kind};
    await mutate('task.update',{id,project_id:project.id});
    rememberWorkUndo(task.title,()=>mutate('task.update',{id,...previous}),`${project.name}에 지정했어요.`);
    const after=visibleTasks();focusTask(after.some(item=>item.id===id)?id:after[Math.min(Math.max(index,0),after.length-1)]?.id||null);
  }
  /* 반복 없는 일정은 바로 지우고 되돌리기를 남긴다. 반복 일정은 범위를 고르는 대화상자로 간다. */
  async function deleteEventByKey(id) {
    const item=findEvent(id);if(!item)return;
    if(item.readonly){feedback('구독 일정은 지울 수 없어요. 원본 캘린더에서 지워 주세요.');return;}
    if(item.rrule||item.recurrence||item.recurrenceId){scopeModal(item);return;}
    // 삭제 뒤 목록을 다시 그리므로 영역은 그 뒤에 다시 찾는다.
    const side=!!document.activeElement?.closest('.td-calendar-side'),container=()=>side?root.querySelector('.td-calendar-side'):body;
    const index=[...container().querySelectorAll('[data-event]')].findIndex(row=>row.dataset.event===String(id));
    await mutate('event.delete',{id:item.id,scope:'all'});
    feedback('일정을 삭제했어요.',()=>mutate('event.restore',{id:item.id}));
    const next=[...container().querySelectorAll('[data-event]')];(next[Math.min(Math.max(index,0),next.length-1)]||container().querySelector(`[data-date="${state.date}"]`))?.focus({preventScroll:true});
  }
  function listStep(event) {
    if(K.is(event,'list.up'))return -1;if(K.is(event,'list.down'))return 1;if(K.is(event,'list.pageUp'))return -10;if(K.is(event,'list.pageDown'))return 10;
    if(K.is(event,'list.first'))return 'first';if(K.is(event,'list.last'))return 'last';return 0;
  }
  const TASK_ACTIONS=[['task.open','open'],['task.complete','complete'],['task.cancel','cancel'],['task.delete','delete'],['task.title','title'],['task.due','due'],['task.note','note'],['task.project','project_id'],['task.waiting','waiting'],['task.nudge','nudge'],['work.undo','undo']];
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
  /* 대시보드는 위아래 한 줄 목록이다: 할 일 다섯 개와 Work·Note·Calendar 입구. ↑↓·J/K로 옮기고 할 일은 Space로 완료한다. */
  function dashboardItems() { return [...body.querySelectorAll('.cf-home-task [data-reveal],.cf-entry')]; }
  function dashboardKeys(event) {
    const items=dashboardItems();if(!items.length)return false;
    const index=items.indexOf(event.target.closest('[data-reveal],.cf-entry'));
    const to=K.is(event,'list.up')?index-1:K.is(event,'list.down')?index+1:K.is(event,'list.first')?0:K.is(event,'list.last')?items.length-1:null;
    if(to!==null){event.preventDefault();items[index<0?0:Math.max(0,Math.min(items.length-1,to))].focus({preventScroll:false});return true;}
    if(K.is(event,'work.undo')){event.preventDefault();if(!event.repeat)safe(undoLastAction);return true;}
    const id=event.target.closest('.cf-home-task [data-reveal]')?.dataset.reveal,task=id&&state.tasks.find(item=>item.id===id);
    if(task&&K.is(event,'task.complete')){event.preventDefault();if(!event.repeat)safe(async()=>{
      await mutate('task.complete',{id,done:true});rememberWorkUndo(task.title,()=>mutate('task.complete',{id,done:false}),'완료했어요.');
      const rest=dashboardItems();rest[Math.max(0,Math.min(index,rest.length-1))]?.focus({preventScroll:true});
    });return true;}
    return false;
  }
  function workspaceKeys(event) {
    const target=event.target;
    if(state.shell!=='dashboard'){
      if(K.is(event,'app.new')){event.preventDefault();if(!event.repeat)safe(newInContext);return true;}return false;
    }
    if(state.view==='notes'&&notes?.handleKeydown(event))return true;
    if(state.view==='notes'&&K.is(event,'note.undo')&&!editingTarget(target)&&!target.closest('.desk-note-preview,[data-note-preview]')){event.preventDefault();if(!event.repeat)safe(undoLastAction);return true;}
    if(K.is(event,'project.new')&&['tasks','dashboard'].includes(state.view)){event.preventDefault();if(!event.repeat)projectModal();return true;}
    if(K.is(event,'app.new')){event.preventDefault();if(!event.repeat)safe(newInContext);return true;}
    if(K.is(event,'app.save')){event.preventDefault();if(state.view==='settings')body.querySelector('.preferences-form')?.requestSubmit();else safe(flushPending);return true;}
    if(K.is(event,'app.undo')&&!editingTarget(target)){event.preventDefault();safe(undoLastAction);return true;}
    if(state.view==='dashboard'&&!editingTarget(target)&&body.contains(target)&&dashboardKeys(event))return true;
    if(state.view==='settings'&&target.closest('.settings-tabs')){const order=SETTINGS_TABS.map(([tab])=>tab),index=order.indexOf(state.settingsTab),to=K.is(event,'settings.next')?index+1:K.is(event,'settings.prev')?index-1:null;if(to!==null){event.preventDefault();setSettingsTab(order[(to+order.length)%order.length]);return true;}}
    if(state.view==='settings'&&target.matches('[data-theme-pick],[data-skin-pick],[data-icon-pick]')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
      event.preventDefault();const cards=[...target.closest('.theme-grid').querySelectorAll('.theme-card')],index=cards.indexOf(target),columns=Math.max(1,cards.filter(card=>card.offsetTop===cards[0].offsetTop).length);
      const to={ArrowLeft:index-1,ArrowRight:index+1,ArrowUp:index-columns,ArrowDown:index+columns,Home:0,End:cards.length-1}[event.key];
      const next=cards[Math.min(cards.length-1,Math.max(0,to))];if(next&&next!==target){next.focus({preventScroll:false});safe(()=>next.dataset.iconPick?pickIcon(next.dataset.iconPick):next.dataset.skinPick?pickSkin(next.dataset.skinPick):pickTheme(next.dataset.themePick));}return true;
    }
    if(workKeys(event))return true;
    if(state.view==='calendar'&&!editingTarget(target)&&target.closest('.td-full-calendar')&&K.is(event,'calendar.view')){event.preventDefault();if(!event.repeat){const order=CAL_VIEWS.map(([view])=>view);safe(()=>setCalView(order[(order.indexOf(state.calView)+(event.shiftKey?order.length-1:1))%order.length]));}return true;}
    if(state.view==='calendar'&&state.calView!=='month'&&!editingTarget(target)&&target.closest('.cal-list')){
      const span=state.calView==='week'?7:1;
      if(K.is(event,'agenda.prevDay')||K.is(event,'agenda.nextDay')){event.preventDefault();safe(async()=>{await moveCalendarDate(K.is(event,'agenda.prevDay')?-span:span);focusView();});return true;}
      if(K.is(event,'agenda.today')){event.preventDefault();safe(async()=>{await moveCalendarDate(0,0,false,true);focusView();});return true;}
      if(K.is(event,'agenda.new')){event.preventDefault();quickEventModal();return true;}
    }
    const day=target.closest('[data-date]');
    if(day){
      const dayMove=Object.keys(DAY_MOVES).find(id=>K.is(event,id)),side=!!day.closest('.td-calendar-side');
      if(dayMove){event.preventDefault();const [days,months]=DAY_MOVES[dayMove];safe(()=>moveCalendarDate(days,months,side,dayMove==='date.today'));return true;}
      if(K.is(event,'date.open')){event.preventDefault();const area=side?root.querySelector('.td-calendar-side'):body;const first=area.querySelector('[data-event]');if(first)first.focus();else quickEventModal();return true;}
      if(K.is(event,'event.new')){event.preventDefault();quickEventModal();return true;}
      if(K.is(event,'calendar.undo')){event.preventDefault();if(!event.repeat)safe(undoLastAction);return true;}
    }
    const eventButton=target.closest('[data-event]');
    if(eventButton&&!editingTarget(target)){
      const step=K.is(event,'agenda.up')?-1:K.is(event,'agenda.down')?1:K.is(event,'agenda.first')?'first':K.is(event,'agenda.last')?'last':0;
      if(step){event.preventDefault();const area=eventButton.closest('.td-main-calendar-agenda,.td-day-detail')||body;const rows=[...area.querySelectorAll('[data-event]')],index=rows.indexOf(eventButton);const next=step==='first'?0:step==='last'?rows.length-1:(index+(step===1?1:rows.length-1))%rows.length;rows[next]?.focus();return true;}
      if(K.is(event,'event.edit')){event.preventDefault();eventModal(eventButton.dataset.event);return true;}
      if(K.is(event,'event.rename')||K.is(event,'event.move')){event.preventDefault();lineEditModal(K.is(event,'event.rename')?'title':'when',eventButton.dataset.event);return true;}
      if(K.is(event,'event.delete')){event.preventDefault();if(!event.repeat)safe(()=>deleteEventByKey(eventButton.dataset.event));return true;}
      if(K.is(event,'agenda.undo')){event.preventDefault();if(!event.repeat)safe(undoLastAction);return true;}
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
        if(row&&K.is(event,'task.assign')){event.preventDefault();if(!event.repeat)safe(()=>assignProjectByNumber(taskCursor,Number(event.code.slice(5))));return true;}
        if(row){
          const action=TASK_ACTIONS.find(([id])=>K.is(event,id))?.[1];
          if(action){event.preventDefault();if(!event.repeat)safe(()=>action==='undo'?undoLastAction():taskKeyboardAction(taskCursor,action));return true;}
        }
      }
    }
    return false;
  }

  root.addEventListener('click', event => safe(async () => {
    const option = event.target.closest('.td-pick-menu [data-pick-index]'); if (option) { choosePick(Number(option.dataset.pickIndex)); return; }
    const button = event.target.closest('button'); if (!button) { if (event.target === modalLayer) closeModal(); return; }
    if (button.matches('.td-pick')) { if (pick?.button === button) closePick(); else openPick(button); return; }
    const data = button.dataset;
    if (data.action === 'close-help') return closeHelp();
    if (data.action === 'help-shortcuts') { await closeHelp(); return goSection('shortcuts'); }
    if (data.calView) return setCalView(data.calView);
    if (data.settingsTab) return setSettingsTab(data.settingsTab);
    if (data.themePick) return pickTheme(data.themePick);
    if (data.skinPick) return pickSkin(data.skinPick);
    if (data.iconPick) return pickIcon(data.iconPick);
    if (data.tab) return switchWorkTab(data.tab,{focus:button.closest('.td-work-nav')?'tab':'list',clearProject:state.view!=='tasks'});
    if (button.classList.contains('td-drag-handle')) return;
    if (data.task) { taskCursor=data.task; await openTaskField(data.task);return; }
    if (data.reveal) return reveal(data.reveal);
    if (data.editDue) return dueModal(data.editDue);
    if (data.mark) { const task=state.tasks.find(item=>item.id===data.mark); if(!task)return; await mutate('task.complete',{id:task.id,done:!task.done}); rememberWorkUndo(task.title,restoreClosure(task),task.done?'완료를 해제했어요.':'완료했어요.'); return; }
    if (data.reviveTask) return reviveTask(data.reviveTask);
    if (data.date) {const side=!!button.closest('.td-calendar-side');await selectDate(data.date);(side?root.querySelector('.td-calendar-side'):body).querySelector(`[data-date="${state.date}"]`)?.focus({preventScroll:true});return;}
    if (data.calStep) { const step=Number(data.calStep); await moveCalendarDate(step*(state.calView==='week'?7:1)); body.querySelector(`[data-cal-step="${step}"]`)?.focus({preventScroll:true}); return; }
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
    if (data.deleteTask) { if (button.closest('.task-form')) { modalLayer.hidden = true; modalLayer.innerHTML = ''; taskModalKind = null; } return deleteTask(data.deleteTask); }
    // 편집 대화상자의 완료·취소: 대화상자를 닫고(자동 저장 반영) 목록의 Space·C와 같은 동작을 한다.
    if (data.completeTask || data.cancelTask) { const id=data.completeTask||data.cancelTask; if (button.closest('.task-form')) { closeModal(); await flushPending(); } const task=state.tasks.find(item=>item.id===id); if(!task)return; if(data.cancelTask)return toggleCancel(id); await mutate('task.complete',{id,done:!task.done}); rememberWorkUndo(task.title,restoreClosure(task),task.done?'완료를 해제했어요.':'완료했어요.'); return; }
    if (data.nudge) return nudgeTask(data.nudge);
    if (data.subToggle || data.subSync || data.subDelete) { const id=Number(data.subToggle||data.subSync||data.subDelete); await mutate(data.subToggle?'subscription.toggle':data.subSync?'subscription.sync':'subscription.delete',{id}); return subscriptions(); }
    if (data.media) { await call('media.control',{action:data.media,appId:data.appId}); return; }
    if (data.data) { await flushPending(); const result=await call('data.'+data.data); if(result?.ok===false)throw new Error(result.error||'데이터 작업을 완료하지 못했습니다.'); if (!result?.cancelled) { if(result?.preferences){state.prefs=result.preferences;state.theme=result.preferences.theme;look();state.info=await call('app.info');} await loadState(); if(['restore','importLegacy'].includes(data.data)){workUndo.length=0;projectMoves.clear();state.workQuery='';state.workTrash=false;state.selected=null;taskCursor=null;projectCursor=null;await notes?.refresh({reset:true});renderMainView();} if (result?.message) feedback(result.message); } return; }
    switch(data.action) {
      case 'switch-shell': await flushPending(); return shell(state.shell==='command'?'dashboard':'command');
      case 'home': await flushPending(); state.view='dashboard'; renderNav(); renderMainView(); await shell('dashboard',false);focusView();break;
      case 'work': await flushPending(); state.view='tasks'; state.project=null; state.selected=null; renderNav(); renderMainView(); await shell('dashboard',false); focusView();break;
      case 'calendar': await flushPending(); state.view='calendar'; renderNav(); renderMainView(); await shell('dashboard',false);focusView();break;
      case 'notes': return navigate({view:'notes'});
      case 'inbox': case 'waiting': return goSection(data.action);
      case 'command': return shell('command');
      case 'collapse': await collapseTaskEditor(); break;
      case 'new-project': projectModal(); break;
      case 'work-project-trash': state.workTrash=!state.workTrash;projectCursor=null;renderMainView();focusWorkProject();break;
      case 'clear-work-search': clearWorkSearch();break;
      case 'today': {const side=!!button.closest('.td-calendar-side');await moveCalendarDate(0,0,side,true);if(!side&&state.calView!=='month')body.querySelector('.cal-list-head [data-action=today]')?.focus({preventScroll:true});break;}
      case 'new-event': quickEventModal(); break;
      case 'close-modal': closeModal(); break;
      case 'delete-event': { const selected=editingEvent; if (!selected || selected.readonly) return; if(selected.rrule||selected.recurrenceId){closeModal();scopeModal(selected);break;} await mutate('event.delete',{id:selected.id,scope:'all'}); closeModal(); feedback('일정을 삭제했어요.',()=>mutate('event.restore',{id:selected.id})); break; }
      case 'pick-scope': { const form=modalLayer.querySelector('.scope-form'),selected=form&&findEvent(form.dataset.event),scope=button.dataset.scope,run=scopeRun; if(!selected||!run||!['one','future','all'].includes(scope))return; scopeRun=null; closeModal(); await run(selected,scope); break; }
      case 'undo': { const action=undoAction; if(action){ const index=undoTimeline.lastIndexOf(action); if(index>=0)undoTimeline.splice(index,1); undoAction=null; root.querySelector('.td-feedback').hidden=true; await action(); } break; }
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
      case 'update-check': syncUpdate(await call('update.check')); break;
      case 'update-install': await flushPending(); await call('update.install'); break;
    }
  }));
  root.addEventListener('input', event => {
    const element=event.target;
    if (element===commandInput) { if (!command.capture) queueCommandQuery(element.value); else previewCapture(); return; }
    if (element.matches('.quick-event-form [name=line]')) { clearTimeout(quickEventTimer); quickEventTimer = setTimeout(() => safe(parseQuickEvent), 120); return; }
    if (element.matches('.line-edit-form[data-mode=when] [name=line]')) { clearTimeout(quickEventTimer); quickEventTimer = setTimeout(() => safe(previewLineEdit), 120); return; }
    if (element.matches('[data-shortcut]')) { shortcutErrors(); return; }
    if (element.matches('[data-work-search]')) {state.workQuery=element.value;state.selected=null;taskCursor=null;projectCursor=null;if(!event.isComposing&&!workComposing)renderMainView();return;}
    if (element.matches('[data-field]') && ['title','note','waitingFor'].includes(element.dataset.field)) {
      const id=element.closest('[data-editor]').dataset.editor;
      queueTask(id,{[element.dataset.field]:element.value});
      if(element.dataset.field==='title')element.closest('.td-task')?.querySelector('[data-check],[data-mark]')?.setAttribute('aria-label',element.value+' 완료');
    }
  });
  root.addEventListener('change', event => safe(async()=>{
    const element=event.target;
    if(element.dataset.pref){const value=element.type==='checkbox'?element.checked:element.value;if(element.dataset.pref==='briefAt'&&!value)return;state.prefs=await call('preferences.set',{[element.dataset.pref]:value});feedback('설정을 저장했어요.');return;}
    if(element.matches('[data-shortcut]')){saveShortcutsSoon(element);return;}
    if(element.dataset.check){await mutate('task.complete',{id:element.dataset.check,done:element.checked});return;}
    if(element.matches('[data-work-project-filter]')){await flushPending();state.project=element.value==='unassigned'?'unassigned':Number(element.value)||null;state.selected=null;taskCursor=null;renderMainView();return;}
    if(element.matches('[data-work-sort]')){state.workSort=element.value;renderMainView();return;}
    if(element.matches('[data-work-range]')){state.workRange=element.value?Number(element.value):null;renderMainView();return;}
    if(element.matches('[data-due-only]')){state.dueOnly=element.checked;renderMainView();return;}
    if(element.matches('[data-field=due]')&&element.closest('[data-editor]')) {
      // 값을 확정할 때(Enter·칸 떠나기) 원본 WHENWORK 규칙으로 해석한다. 잘못된 형식이면 이전 값으로 되돌린다.
      const id=element.closest('[data-editor]').dataset.editor,previous=state.tasks.find(task=>task.id===id)?.due||'',postponed=state.tasks.find(task=>task.id===id)?.postponed??0;
      if(element.value.trim()===previous)return;
      let updated;
      try{updated=await mutate('task.setDue',{id,text:element.value},{renderMain:false});}
      catch(error){element.value=previous;feedback(error.message,null,true);if(document.activeElement===element)element.select();return;}
      const due=updated?.due||'';if(element.isConnected)element.value=due;
      const label=element.closest('.td-task')?.querySelector('.td-due'),badge=workRules.dueBadge(due);
      if(label){label.textContent=badge?.text||'마감 없음';label.title=due||'마감 없음';label.classList.toggle('today',badge?.cls==='today');label.classList.toggle('work-overdue',badge?.cls==='over');}
      rememberWorkUndo('마감일',()=>mutate('task.update',{id,due:previous,postponed}),due?`마감을 ${dueLabel(due)}로 정했어요.`:'마감을 해제했어요.');
      if(element.closest('.task-form'))renderMainView();
      return;
    }
    if(element.matches('[data-field]') && ['kind','due','project_id'].includes(element.dataset.field)) {
      const id=element.closest('[data-editor]').dataset.editor;const field=element.dataset.field;const value=field==='project_id'?(element.value?Number(element.value):null):element.value;
      const activeAtRequest=document.activeElement,updated=await mutate('task.update',{id,[field]:value},{renderMain:false});
      if(field==='due') {const due=element.closest('.td-task')?.querySelector('.td-due'),badge=workRules.dueBadge(value);if(due){due.textContent=badge?.text||'마감 없음';due.title=value||'마감 없음';due.classList.toggle('today',badge?.cls==='today');due.classList.toggle('work-overdue',badge?.cls==='over');}return;}
      // 대화상자에서 바꾸면 뒤의 목록도 바로 따라간다(분류 이동 포함). 포커스는 대화상자에 그대로 둔다.
      if(element.closest('.task-form')){if(state.view==='tasks'&&!['done','projects'].includes(state.tab)&&(field==='kind'||field==='project_id')&&updated.kind!==state.tab){state.tab=updated.kind;taskModalKind=updated.kind;}if(field==='project_id'&&state.project&&state.project!==updated.project_id)state.project=null;renderNav();renderMainView();return;}
      if(state.view!=='tasks'||state.selected!==id||!element.isConnected)return;
      const activeAfterSave=document.activeElement,focus=captureFocus(),sameControl=activeAfterSave===activeAtRequest;
      if(field==='kind'||field==='project_id'&&updated.kind!==state.tab&&state.tab!=='done')state.tab=updated.kind;
      if(field==='project_id'&&state.project&&state.project!==updated.project_id)state.project=null;
      renderNav();renderMainView();if(focus)restoreFocus(focus);else if(sameControl)body.querySelector(`[data-editor="${CSS.escape(id)}"] [data-field="${field}"]`)?.focus({preventScroll:true});else if(activeAfterSave?.isConnected)activeAfterSave.focus({preventScroll:true});
    }
  }));
  root.addEventListener('submit',event=>{
    if(!event.target.matches('.td-quick,.event-form,.project-form,.subscription-form,.preferences-form,.quick-event-form,.line-edit-form,.work-due-form,.work-waiting-form,.work-archive-form,.task-form'))return;
    event.preventDefault();
    const submittingForm=event.target;if(submittingForm.dataset.submitting==='true')return;
    submittingForm.dataset.submitting='true';const submitButton=submittingForm.querySelector('[type=submit]');if(submitButton)submitButton.disabled=true;
    safe(async()=>{
      const form=event.target;
      if(form.matches('.td-quick')){const input=form.querySelector('input');const title=input.value.trim();if(!title)return;input.disabled=true;let result;try{result=await addTask(title);input.value='';}finally{input.disabled=false;if(result?.followed)focusTask(result.id);else if(!result)input.focus();}return;}
      if(form.matches('.task-form')){closeModal();return;}
      const values=Object.fromEntries(new FormData(form).entries());
      // 목록 상자(.td-pick)는 버튼이라 FormData에 없다. 이름 있는 것만 값을 더한다.
      form.querySelectorAll('.td-pick[name]').forEach(button=>{values[button.name]=button.value;});
      if(form.matches('.work-due-form')){
        const id=form.dataset.taskId,before=state.tasks.find(task=>task.id===id),previous=before?.due||'',postponed=before?.postponed??0;
        await mutate('task.setDue',{id,text:values.text});closeModal();
        rememberWorkUndo('마감일',()=>mutate('task.update',{id,due:previous,postponed}),'마감을 변경했어요.');return;
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
        const allDay=form.querySelector('[name=allDay]').checked,payload={...values,allDay};
        // 종료는 날짜와 시각을 함께 본다 — 자정을 넘는 일정(23:00 → 다음 날 01:00)도 저장된다. 종일의 종료 날짜는 마지막 날이라 다음 날 0시로 넘긴다.
        const startAt=new Date(`${values.date}T${allDay?'00:00':values.time}:00`).getTime(),endAt=new Date(`${values.endDate}T${allDay?'00:00':values.end}:00`).getTime();
        if(!(allDay?endAt>=startAt:endAt>startAt)){const end=form.querySelector(allDay?'[name=endDate]':'[name=end]');end.setCustomValidity(allDay?'종료 날짜를 시작 날짜와 같거나 뒤로 정해 주세요.':'종료를 시작 이후로 정해 주세요.');end.reportValidity();form.addEventListener('input',()=>end.setCustomValidity(''),{once:true});return;}
        if(allDay){payload.endDate=shiftDateKey(values.endDate,1);delete payload.time;delete payload.end;}
        if(editingEvent){payload.id=editingEvent.id;payload.recurrenceId=editingEvent.recurrenceId||editingEvent.startsAt;}
        const result=await mutate(editingEvent?'event.update':'event.create',payload);await selectDate(payload.date);closeModal();feedback('일정을 저장했어요.');return result;
      }
      if(form.matches('.project-form')){const id=Number(form.dataset.projectId)||null,result=await mutate(id?'project.update':'project.create',{...(id?{id}:{}),name:values.name.trim()});if(state.tab==='projects')projectCursor=String(result.id);closeModal();if(state.view==='tasks'&&state.tab==='projects')focusWorkProject();return;}
      if(form.matches('.subscription-form')){const result=await mutate('subscription.add',{url:values.url});await subscriptions();if(result?.error)feedback(result.error,null,true);return;}
      if(form.matches('.preferences-form')){const field=document.activeElement?.name,changed=Object.entries(values).some(([key,value])=>accelerator(value)!==(state.prefs[key]??''));if(!changed)return;try{state.prefs=await call('preferences.set',Object.fromEntries(Object.entries(values).map(([key,value])=>[key,accelerator(value)])));state.info=await call('app.info');renderMainView();(field?body.querySelector(`.preferences-form [name="${CSS.escape(field)}"]`):body.querySelector('.settings-tabs [aria-selected=true]'))?.focus();feedback('단축키를 저장했어요.');}catch(error){shortcutErrors(error.fields||{});form.querySelector('[aria-invalid=true]')?.focus();feedback(error.message,null,true);}return;}
      if(form.matches('.quick-event-form')){await submitQuickEvent();return;}
      if(form.matches('.line-edit-form')){await submitLineEdit(form);return;}
    }).finally(()=>{delete submittingForm.dataset.submitting;if(submitButton?.isConnected)submitButton.disabled=false;});
  });
  commandInput.addEventListener('focus',()=>{if(command.renderedQuery!==commandInput.value&&!command.request&&!command.timer&&!command.composing)safe(()=>queryCommand(commandInput.value,true));});
  root.addEventListener('compositionstart',event=>{if(event.target.matches('[data-work-search]'))workComposing=true;});
  modalLayer.addEventListener('input',()=>{modalDirty=true;});modalLayer.addEventListener('change',()=>{modalDirty=true;});
  commandInput.addEventListener('input',()=>{if(commandInput.classList.contains('has-notice'))clearCommandNotice();});
  root.addEventListener('compositionend',event=>{if(event.target.matches('[data-work-search]')){workComposing=false;state.workQuery=event.target.value;renderMainView();}});
  commandInput.addEventListener('compositionstart',()=>{command.composing=true;cancelCommandActivation();});
  // 조합을 확정한 ↑↓·Enter는 확정만 하고 사라지지 않게, 확정 직후 원래 동작을 이어서 한다(원본 WHENCOMMAND 함정 #12).
  // 값이 같은 확정은 새 입력으로 보지 않는다 — 옮긴 선택이 처음으로 돌아가지 않도록.
  commandInput.addEventListener('compositionend',()=>{
    command.composing=false;
    if(!command.capture&&commandInput.value!==command.query)queueCommandQuery(commandInput.value,0);
    const pending=command.afterComposition;command.afterComposition=null;
    if(pending){clearTimeout(command.deferredKey);command.deferredCode=pending.code;command.deferredKey=setTimeout(()=>runDeferredKey(pending),0);}
  });
  // 결과가 다시 그려지거나 늦은 결과가 합류해 행이 커서 밑으로 지나가도 Chromium은 pointermove를 보낸다. 마우스가 실제로 움직였을 때만 선택을 옮긴다.
  let lastPointer=null;
  commandBox.addEventListener('pointermove',event=>{const at=event.screenX+','+event.screenY,moved=lastPointer!==null&&lastPointer!==at;lastPointer=at;if(!moved)return;const row=event.target.closest('[data-result]');if(row&&!command.running&&!command.actions&&command.selected!==Number(row.dataset.result)){command.selected=Number(row.dataset.result);syncCommandSelection();}});
  commandActions.addEventListener('pointermove',event=>{const row=event.target.closest('[data-command-action]');if(row&&command.actions&&!command.running){const index=command.actions.item.actions.findIndex(action=>action.id===row.dataset.commandAction);if(index>=0&&index!==command.actions.selected){command.actions.selected=index;syncCommandSelection();}}});
  root.addEventListener('focusin',syncHints);
  root.addEventListener('focusout',event=>{if(event.target.matches('[data-field]')){const element=event.target;dashboardFocus={id:element.closest('[data-editor]')?.dataset.editor,field:element.dataset.field,start:element.selectionStart,end:element.selectionEnd,scroll:element.scrollTop};}});
  // 보조 키만 누른 것은 이동이 아니다. 그 밖의 키는 조용한 포커스를 풀고, 이어지는 처리가 포커스를 옮기면 표시가 보인다.
  document.addEventListener('keydown',event=>{if(!['Control','Alt','Shift','Meta','Process'].includes(event.key))root.classList.remove('focus-quiet');},true);
  document.addEventListener('keydown',event=>{
    if(event.isComposing||event.keyCode===229||command.composing){deferCompositionKey(event);return;}
    // 편집 대화상자의 한 줄 칸에서 Enter는 그 칸만 확정하고 대화상자는 그대로 둔다(목록 편집기와 같다). 양식 암묵 제출을 막는다.
    if(!modalLayer.hidden&&event.key==='Enter'&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&event.target.matches?.('.task-form input:not([type=checkbox])')){event.preventDefault();event.target.dispatchEvent(new Event('change',{bubbles:true}));return;}
    // 확정 직후 브라우저가 같은 키를 다시 보내면 미뤄 둔 처리는 버린다(두 번 움직이지 않게).
    if(command.deferredKey&&event.target===commandInput&&event.code===command.deferredCode){clearTimeout(command.deferredKey);command.deferredKey=null;command.deferredCode=null;}
    const section=K.section(event);
    const reservedFieldKey=K.is(event,'app.save')||K.is(event,'help.toggle')||!!section;
    if(event.target.matches('[data-shortcut]')&&!helpOpen&&!reservedFieldKey){recordShortcut(event);return;}
    if(K.is(event,'help.toggle')){event.preventDefault();if(!event.repeat)safe(()=>helpOpen?closeHelp():openHelp());return;}
    if(helpOpen){if(K.is(event,'back')){event.preventDefault();safe(closeHelp);}else if(K.is(event,'focus.cycle')){event.preventDefault();helpLayer.querySelector('button')?.focus();}return;}
    if(section){event.preventDefault();if(!event.repeat&&(modalLayer.hidden||modalLayer.querySelector('.task-form'))&&!command.running)safe(()=>goSection(section));return;}
    if(K.is(event,'nav.next')||K.is(event,'nav.prev')){event.preventDefault();if(!event.repeat&&(modalLayer.hidden||modalLayer.querySelector('.task-form'))&&!command.running&&state.shell==='dashboard')safe(()=>cycleMenu(K.is(event,'nav.next')?1:-1));return;}
    if(K.is(event,'command.open')){event.preventDefault();if(!event.repeat&&(modalLayer.hidden||modalLayer.querySelector('.task-form'))&&!command.running){cancelCommandActivation();safe(async()=>{const same=state.shell==='command'&&!command.capture;exitCapture();await flushPending();await shell('command');if(same)commandInput.select();});}return;}
    if(state.shell==='dashboard'&&!modalLayer.hidden&&K.is(event,'focus.cycle')){
      // 할 일 편집 대화상자의 Tab은 입력 칸만 돈다(삭제·닫기 버튼에 멈추지 않는다. 닫기는 Esc·Ctrl+S).
      if(modalLayer.querySelector('.task-form')){event.preventDefault();const fields=[...modalLayer.querySelectorAll('.task-form :is(input:not([type=checkbox]),textarea,.td-pick)')].filter(element=>!element.disabled&&element.getClientRects().length);const index=fields.indexOf(event.target);fields[index<0?0:(index+(event.shiftKey?fields.length-1:1))%fields.length]?.focus();return;}
      const focusable=[...modalLayer.querySelectorAll('button,input,select,textarea,[tabindex]')].filter(element=>!element.disabled&&element.tabIndex>=0&&element.getClientRects().length);
      const first=focusable[0],last=focusable.at(-1);
      if(!first){event.preventDefault();return;}
      if(event.shiftKey&&(event.target===first||!modalLayer.contains(event.target))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(event.target===last||!modalLayer.contains(event.target))){event.preventDefault();first.focus();}
      return;
    }
    if(!modalLayer.hidden&&event.target.closest('.quick-event-form')&&K.is(event,'quickEvent.detail')){event.preventDefault();if(!event.repeat)safe(()=>submitQuickEvent({detail:true}));return;}
    if(!modalLayer.hidden&&K.is(event,'app.save')){event.preventDefault();const form=modalLayer.querySelector('form');if(!event.repeat&&form?.querySelector('[type=submit]')&&!form.querySelector('[type=submit]').disabled)form.requestSubmit();return;}
    if(modalLayer.hidden&&workspaceKeys(event))return;
    if(state.shell==='dashboard'&&modalLayer.hidden&&state.view!=='settings'&&K.is(event,'focus.cycle')){event.preventDefault();nextTabStop(event.target,event.shiftKey)?.focus({preventScroll:false});return;}
    const inCommandInput=state.shell==='command'&&event.target===commandInput;
    if(command.output&&(inCommandInput||root.querySelector('.command-output').contains(event.target))&&outputKeys(event))return;
    if(command.capture&&inCommandInput){
      if(K.is(event,'capture.save')||K.is(event,'capture.saveOpen')){event.preventDefault();if(!event.repeat)safe(()=>saveCapture({open:K.is(event,'capture.saveOpen')}));return;}
      if(K.is(event,'capture.open')){event.preventDefault();const section=CAPTURE[command.capture].section;exitCapture();safe(()=>goSection(section));return;}
    }
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
  api.on('update.changed',syncUpdate);
  api.on('state.changed',()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>safe(()=>loadState({renderMain:!helpOpen&&pending.size===0&&!body.contains(document.activeElement)})),70);});
  window.addEventListener('beforeunload',()=>{if(pending.size||notes?.hasPending())safe(flushPending);});
  new ResizeObserver(()=>resizeCommand()).observe(root.querySelector('#cf-command-panel'));
  async function init(){
    try{
      const results=await Promise.allSettled([call('preferences.get'),call('app.info'),call('media.state')]);
      if(results[0].status==='fulfilled'){state.prefs=results[0].value||{};state.theme=state.prefs.theme||'zen-sage';}
      if(results[1].status==='fulfilled')state.info=results[1].value||{};
      document.title = state.info.isPackaged === false ? 'WHENDESK 개발본' : 'WHENDESK';
      look();await loadState();if(results[2].status==='fulfilled')renderMedia(results[2].value);else renderMedia({sessions:[],failure:true});
      await shell('command',false);await queryCommand('');commandInput.focus({preventScroll:true});
      window.dispatchEvent(new CustomEvent('whendesk:ready'));
    }catch(error){commandBox.innerHTML=`<div class="command-empty" role="alert">시작하지 못했습니다.<br>${esc(error.message)}</div>`;showError(error);resizeCommand();}
  }
  Object.defineProperty(window,'__whendeskFlush',{value:flushPending});
  // 화면으로 바로 가는 통로(e2e·덱 등 키 입력이 아닌 호출용). 키보드에는 Ctrl+Tab 순환과 Ctrl+,만 둔다.
  Object.defineProperty(window,'__whendeskGo',{value:section=>goSection(section)});
  Object.defineProperty(window,'__whendeskRecordShortcut',{value:accelerator=>{
    const input=document.activeElement;
    if(helpOpen||state.shell!=='dashboard'||!input?.matches('[data-shortcut]')||typeof accelerator!=='string')return false;
    input.value=hotkey(accelerator);input.dispatchEvent(new Event('input',{bubbles:true}));saveShortcutsSoon(input);return true;
  }});
  init();
})();
