/* WHENNOTE의 저장·검색·마크다운을 사용하는 메모 화면. mount는 DOM을 옮겨 편집 이력을 보존한다. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const titleOf = body => String(body).split('\n').map(line => line.replace(/^\s*#{1,6}\s+/, '').trim()).find(Boolean)?.slice(0,200) || '빈 메모';
  const textField = element => element?.matches('input,textarea,select,[contenteditable=true]');
  const isPinned = note => !!(note?.pinned || note?.pinned_at || note?.pinnedAt);
  const isArchived = note => !!(note?.archived || note?.archived_at || note?.archivedAt);
  const isDeleted = note => !!(note?.deleted || note?.deleted_at || note?.deletedAt);
  function create({ container, call, feedback = () => {}, onChanged = () => {}, onError = error => feedback(error.message,null,true) } = {}) {
    if (typeof call !== 'function') throw new Error('메모 API가 필요합니다.');
    const element = document.createElement('section');
    element.className = 'desk-notes'; element.setAttribute('aria-label','메모 작업 공간');
    element.innerHTML = `<aside class="desk-notes-browser" aria-label="메모 목록"><div class="desk-notes-search"><i data-lucide="search" aria-hidden="true"></i><input type="search" data-note-search aria-label="메모 검색" placeholder="메모 검색" autocomplete="off" spellcheck="false"><button data-note-action="create" aria-label="새 메모">${icon('plus')}</button></div><div class="desk-notes-list-head"><select data-note-scope aria-label="메모 보기"><option value="active">메모</option><option value="archived">보관함</option><option value="trash">휴지통</option></select><span data-note-count></span></div><div class="desk-notes-list" data-note-list role="listbox" aria-label="메모 검색 결과" tabindex="0"></div><div class="desk-notes-tags" data-note-tags aria-label="태그"></div></aside><section class="desk-note-editor" aria-label="메모 편집"><div data-note-placeholder class="desk-note-placeholder">메모 없음</div><div data-note-content hidden><div class="desk-note-toolbar"><span class="desk-note-title" data-note-title></span><div class="desk-note-tools"><button data-note-action="preview" aria-label="마크다운 미리보기" aria-pressed="false">${icon('eye')}</button><button data-note-action="pin" aria-label="메모 고정" aria-pressed="false">${icon('pin')}</button><button data-note-action="archive" aria-label="메모 보관" aria-pressed="false">${icon('archive')}</button><button data-note-action="attach" aria-label="이미지 첨부">${icon('image-plus')}</button><button data-note-action="export" aria-label="메모 마크다운 내보내기">${icon('download')}</button><button data-note-action="delete" aria-label="메모 삭제">${icon('trash-2')}</button><button data-note-action="restore" aria-label="메모 복원" hidden>${icon('undo-2')}</button></div></div><textarea class="desk-note-body" data-note-editor aria-label="메모 본문" placeholder="메모 내용" spellcheck="false"></textarea><div class="desk-note-preview" data-note-preview tabindex="0" role="region" aria-label="메모 미리보기" hidden></div><div class="desk-note-meta"><div data-note-meta></div><span class="desk-note-save" data-note-save role="status" aria-live="polite"></span></div><div class="desk-note-links" data-note-links></div></div></section>`;
    const $ = selector => element.querySelector(selector);
    const search = $('[data-note-search]'), scope = $('[data-note-scope]'), list = $('[data-note-list]');
    const editor = $('[data-note-editor]'), preview = $('[data-note-preview]');
    const state = { active:false, query:'', scope:'active', results:[], tags:[], selectedId:null, note:null, preview:false, creating:false, attaching:false, searching:false, error:null, undo:null };
    const pending = new Map();
    let saveTimer, searchTimer, searchSeq = 0, openSeq = 0, previewSeq = 0, writeTail = Promise.resolve(), lastFocus = null, disposed = false;
    const mutate = (type,payload = {}) => call('mutate',{type,payload});
    const icons = () => window.lucide?.createIcons({attrs:{width:15,height:15}});
    const notify = () => Promise.resolve(onChanged()).catch(onError);
    const safe = fn => Promise.resolve().then(fn).catch(onError);
    function mount(target = container) {
      if (!target) throw new Error('메모를 표시할 영역이 필요합니다.');
      container = target;
      if (element.parentElement !== target) target.replaceChildren(element);
      icons(); return element;
    }
    function rememberFocus() {
      const focused = document.activeElement;
      if (!element.contains(focused)) return;
      lastFocus = { element:focused, start:focused.selectionStart, end:focused.selectionEnd, scroll:focused.scrollTop };
    }
    function focus({ edit = false, list:toList = false } = {}) {
      if (toList) return focusList();
      if (edit && state.note && !isDeleted(state.note)) { setPreview(false); return; }
      if (element.contains(document.activeElement)) return;
      if (lastFocus?.element?.isConnected && element.contains(lastFocus.element) && !lastFocus.element.hidden) {
        lastFocus.element.focus({preventScroll:true});
        if (lastFocus.start != null) { try { lastFocus.element.setSelectionRange(lastFocus.start,lastFocus.end); } catch {} }
        lastFocus.element.scrollTop = lastFocus.scroll; return;
      }
      search.focus({preventScroll:true});
    }
    function focusList() { (list.querySelector('[aria-selected=true]') || list).focus({preventScroll:true}); }
    function setActive(active) { if (!active) rememberFocus(); state.active = !!active; }
    function renderList() {
      const restore = list.contains(document.activeElement);
      const oldScroll = list.scrollTop;
      if (!state.results.some(note => note.id === state.selectedId)) state.selectedId = state.results[0]?.id || null;
      $('[data-note-count]').textContent = state.results.length ? `${state.results.length}` : '';
      list.innerHTML = state.results.map((note,index) => {
        const draft = pending.get(note.id)?.body;
        return `<button id="desk-note-row-${index}" class="desk-note-row ${note.id === state.selectedId ? 'selected' : ''}" data-note-row="${esc(note.id)}" role="option" aria-selected="${note.id === state.selectedId}" tabindex="${note.id === state.selectedId ? '0' : '-1'}"><span class="desk-note-row-title">${isPinned(note) ? icon('pin') : ''}<span>${esc(draft == null ? note.title : titleOf(draft))}</span></span><small>${esc(draft == null ? note.snippet || '' : draft.split('\n').slice(1).join(' ').slice(0,100))}</small>${note.tags?.length ? `<span class="desk-note-row-tags">${esc(note.tags.map(tag => '#'+tag).join(' '))}</span>` : ''}</button>`;
      }).join('') || `<p class="desk-notes-empty" role="status">${state.searching ? '검색 중…' : '메모 없음'}</p>`;
      list.scrollTop = oldScroll; icons(); if (restore) focusList();
    }
    function renderTags() {
      const focused = document.activeElement?.dataset?.noteTag;
      $('[data-note-tags]').innerHTML = state.tags.map(tag => `<button data-note-tag="${esc(tag.tag || tag.name || tag)}">#${esc(tag.tag || tag.name || tag)}</button>`).join('');
      if (focused) [...$('[data-note-tags]').children].find(button => button.dataset.noteTag === focused)?.focus({preventScroll:true});
    }
    async function refresh({ focus:shouldFocus = false, selectedId, reset = false } = {}) {
      if (reset) {
        if (pending.size) throw new Error('메모 저장을 마친 뒤 데이터를 다시 불러와 주세요.');
        ++openSeq; ++previewSeq; clearTimeout(searchTimer);
        state.note = null; state.selectedId = null; state.results = []; state.query = ''; state.scope = 'active';
        state.preview = false; state.error = null; state.undo = null; lastFocus = null;
        editor.value = ''; preview.replaceChildren(); search.value = ''; scope.value = 'active'; showNote();
      }
      const seq = ++searchSeq;
      if (selectedId) state.selectedId = selectedId;
      const results = await Promise.all([mutate('note.search',{q:state.query,scope:state.scope,limit:500}),mutate('note.tags')]);
      if (seq !== searchSeq || disposed) return;
      state.searching = false;
      state.results = Array.isArray(results[0]) ? results[0] : results[0]?.items || [];
      state.tags = Array.isArray(results[1]) ? results[1] : results[1]?.items || results[1]?.tags || [];
      scope.value = state.scope; if (search.value !== state.query) search.value = state.query;
      renderList(); renderTags();
      if (shouldFocus) focusList();
      return state.results;
    }
    function saveStatus() {
      const status = $('[data-note-save]');
      status.textContent = state.error ? '저장 실패' : pending.size ? '저장 중…' : '';
      status.classList.toggle('is-error',!!state.error);
    }
    function renderMeta() {
      const note = state.note; if (!note) return;
      $('[data-note-title]').textContent = pending.has(note.id) ? titleOf(editor.value) : note.title || titleOf(editor.value);
      const trash = isDeleted(note);
      editor.readOnly = trash;
      for (const action of ['pin','archive','attach','delete']) $(`[data-note-action=${action}]`).hidden = trash;
      $('[data-note-action=restore]').hidden = !trash;
      const pin = $('[data-note-action=pin]'), archive = $('[data-note-action=archive]');
      pin.setAttribute('aria-pressed',String(isPinned(note))); pin.setAttribute('aria-label',isPinned(note) ? '메모 고정 해제' : '메모 고정');
      archive.setAttribute('aria-pressed',String(isArchived(note))); archive.setAttribute('aria-label',isArchived(note) ? '메모 보관 해제' : '메모 보관');
      const when = note.updated_at || note.updatedAt || note.created_at || note.createdAt;
      const time = when && Number.isFinite(new Date(when).getTime()) ? new Date(when).toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
      $('[data-note-meta]').innerHTML = `${time ? `<span>${esc(time)}</span>` : ''}${(note.tags || []).map(tag => `<button data-note-tag="${esc(tag)}">#${esc(tag)}</button>`).join('')}`;
      const links = $('[data-note-links]');
      links.innerHTML = (note.backlinks || []).length ? `<span>연결된 메모</span>${note.backlinks.map(link => `<button data-note-open="${esc(link.id)}">${esc(link.title)}</button>`).join('')}` : '';
      saveStatus();
    }
    function showNote() {
      $('[data-note-placeholder]').hidden = !!state.note;
      $('[data-note-content]').hidden = !state.note;
      element.classList.toggle('has-note',!!state.note);
      if (state.note) renderMeta();
    }
    function markDirty() {
      if (!state.note || isDeleted(state.note)) return;
      pending.set(state.note.id,{body:editor.value}); state.error = null;
      state.note.body = editor.value; $('[data-note-title]').textContent = titleOf(editor.value);
      const row = [...list.querySelectorAll('[data-note-row]')].find(row => row.dataset.noteRow === state.note.id);
      if (row) row.querySelector('.desk-note-row-title>span').textContent = titleOf(editor.value);
      saveStatus(); clearTimeout(saveTimer); saveTimer = setTimeout(() => safe(flush),350);
    }
    function flush() {
      clearTimeout(saveTimer); saveTimer = null;
      if (!pending.size) return writeTail;
      writeTail = writeTail.catch(() => {}).then(async () => {
        let changed = false;
        while (pending.size) {
          const [id,draft] = pending.entries().next().value;
          try {
            const saved = await mutate('note.update',{id,body:draft.body});
            changed = true;
            if (pending.get(id) === draft) pending.delete(id);
            if (state.note?.id === id) {
              state.note = {...state.note,...saved,body:editor.value};
              if (pending.has(id)) state.note.body = pending.get(id).body;
              renderMeta();
            }
            state.error = null; saveStatus();
          } catch (error) { state.error = error; saveStatus(); throw error; }
        }
        if (changed) { try { await refresh(); } catch (error) { onError(error); } notify(); }
      });
      return writeTail;
    }
    async function open(id,{ edit = true, touch = true, focus:shouldFocus = true } = {}) {
      await flush();
      const seq = ++openSeq;
      const note = await mutate(touch ? 'note.open' : 'note.get',{id});
      if (seq !== openSeq || !note || disposed) return;
      const noteScope = isDeleted(note) ? 'trash' : isArchived(note) ? 'archived' : 'active';
      if (state.scope !== noteScope || !state.results.some(item => item.id === note.id)) {
        clearTimeout(searchTimer); state.scope = noteScope; scope.value = noteScope;
        state.query = ''; search.value = '';
        await refresh({selectedId:note.id});
        if (seq !== openSeq || disposed) return;
      }
      const sameNote = state.note?.id === note.id;
      state.note = note; state.selectedId = note.id; state.error = null;
      const body = pending.get(note.id)?.body ?? note.body ?? '';
      if (!sameNote || editor.value !== body) editor.value = body;
      showNote(); renderList(); setPreview(!edit || isDeleted(note),{focus:shouldFocus});
      return note;
    }
    async function newNote(body = '') {
      if (state.creating) return;
      state.creating = true;
      try {
        await flush(); const note = await mutate('note.create',{body});
        clearTimeout(searchTimer);
        state.scope = 'active'; state.query = ''; search.value = ''; scope.value = 'active';
        await refresh({selectedId:note.id}); await open(note.id,{edit:true});
        editor.setSelectionRange(editor.value.length,editor.value.length); notify(); return note;
      } finally { state.creating = false; }
    }
    async function setScope(next) {
      if (!['active','archived','trash'].includes(next)) return;
      await flush(); clearTimeout(searchTimer); state.scope = next; scope.value = next; state.selectedId = null;
      state.note = null; ++openSeq; showNote(); await refresh({focus:true});
    }
    let previewTimer = null;
    function select(delta,{edge} = {}) {
      if (!state.results.length) return;
      const current = Math.max(0,state.results.findIndex(note => note.id === state.selectedId));
      const index = edge === 'first' ? 0 : edge === 'last' ? state.results.length-1 : (current+delta+state.results.length)%state.results.length;
      state.selectedId = state.results[index].id;
      list.querySelectorAll('[data-note-row]').forEach(row => { const selected = row.dataset.noteRow === state.selectedId; row.classList.toggle('selected',selected); row.setAttribute('aria-selected',String(selected)); row.tabIndex = selected ? 0 : -1; });
      const row = list.querySelector('[aria-selected=true]'); row?.scrollIntoView({block:'nearest'});
      if (list.contains(document.activeElement)) row?.focus({preventScroll:true});
      // 선택을 옮기면 오른쪽에 그 메모를 보기 모드로 바로 보여 준다(원본 WHENNOTE). 포커스는 목록에 둔다.
      clearTimeout(previewTimer); const target = state.selectedId;
      previewTimer = setTimeout(() => { if (state.active && state.selectedId === target && state.note?.id !== target && !pending.size) safe(() => open(target,{edit:false,touch:false,focus:false})); },120);
    }
    async function activateSelected({edit = true,createFromQuery = false} = {}) {
      const query = state.query, selectedScope = state.scope;
      clearTimeout(searchTimer);
      if (createFromQuery) { await newNote(query.trim() ? query.trim()+'\n' : ''); return; }
      // 디바운스 중 Enter를 눌러도 이전 검색의 메모를 열거나 중복 메모를 만들지 않는다.
      await refresh();
      if (query !== state.query || selectedScope !== state.scope || !state.active) return;
      if (state.selectedId) await open(state.selectedId,{edit});
      else if (state.scope === 'active') await newNote(query.trim() ? query.trim()+'\n' : '');
    }
    async function toggleFlag(type) {
      if (state.scope === 'trash') return;
      const id = state.note?.id || state.selectedId; if (!id) return;
      await flush(); const note = await mutate(type,{id});
      if (state.note?.id === id) { state.note = {...state.note,...note}; renderMeta(); }
      if (type === 'note.archive') { state.note = null; showNote(); }
      await refresh({focus:type === 'note.archive'}); notify();
    }
    async function remove(id = state.note?.id || state.selectedId) {
      if (!id || state.scope === 'trash') return;
      await flush(); const previousScope = state.scope;
      await mutate('note.delete',{id}); state.undo = {id,scope:previousScope};
      if (state.note?.id === id) { state.note = null; showNote(); }
      await refresh({focus:true}); notify();
      feedback('메모를 삭제했습니다.',() => restore(id,{scope:previousScope}));
    }
    async function restore(id = state.note?.id || state.selectedId,{scope:nextScope} = {}) {
      if (!id) return;
      await flush(); const note = await mutate('note.restore',{id}); state.undo = null;
      state.scope = nextScope || (isArchived(note) ? 'archived' : 'active'); scope.value = state.scope;
      state.query = ''; search.value = ''; state.note = null; showNote();
      await refresh({selectedId:id}); await open(id,{edit:true}); notify(); feedback('메모를 복원했습니다.');
    }
    function setPreview(on,{focus:shouldFocus = true} = {}) {
      if (!state.note) return;
      state.preview = !!on; editor.hidden = state.preview; preview.hidden = !state.preview;
      const button = $('[data-note-action=preview]');
      button.setAttribute('aria-pressed',String(state.preview)); button.setAttribute('aria-label',state.preview ? '메모 편집' : '마크다운 미리보기');
      button.innerHTML = icon(state.preview ? 'square-pen' : 'eye'); icons();
      if (state.preview) renderPreview();
      if (shouldFocus) (state.preview ? preview : editor).focus({preventScroll:true});
    }
    async function openLink(title) {
      const link = state.note?.links?.find(link => link.title?.toLocaleLowerCase() === title.toLocaleLowerCase());
      if (link?.to_id || link?.id) await open(link.to_id || link.id,{edit:false});
      else await newNote(title+'\n');
    }
    function renderPreview() {
      const seq = ++previewSeq, note = state.note;
      if (!note) return;
      const fragment = window.MD?.render ? window.MD.render(editor.value) : document.createTextNode(editor.value);
      const images = [...fragment.querySelectorAll?.('img') || []];
      for (const image of images) {
        const file = image.getAttribute('src')?.match(/^wn-attach:\/\/files\/([a-f0-9-]{36}\.[a-z0-9]{1,5})$/)?.[1];
        image.removeAttribute('src'); if (file) image.dataset.noteImage = file;
      }
      preview.replaceChildren(fragment);
      for (const link of preview.querySelectorAll('a.wikilink,a.tag')) { link.tabIndex = 0; link.setAttribute('role','button'); }
      for (const checkbox of preview.querySelectorAll('input[type=checkbox]')) checkbox.disabled = isDeleted(note);
      for (const image of images) {
        const file = image.dataset.noteImage; if (!file) continue;
        const button = document.createElement('button'); button.className = 'desk-note-image'; button.dataset.noteAttachment = file; button.setAttribute('aria-label',`${image.alt || '첨부 이미지'} 열기`);
        image.replaceWith(button); button.append(image);
        safe(async () => {
          const attachment = await mutate('note.attachment',{id:note.id,file});
          if (seq !== previewSeq || !image.isConnected) return;
          const url = typeof attachment === 'string' ? attachment : attachment?.dataUrl;
          if (/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i.test(url || '')) image.src = url;
        });
      }
    }
    async function searchTag(tag) {
      await flush(); state.query = '#'+tag; search.value = state.query;
      state.scope = 'active'; scope.value = 'active'; await refresh(); search.focus({preventScroll:true});
    }
    function insertText(text) {
      if (!state.note || isDeleted(state.note)) return;
      setPreview(false,{focus:false}); editor.setRangeText(text,editor.selectionStart,editor.selectionEnd,'end'); markDirty(); editor.focus({preventScroll:true});
    }
    async function attachFile() {
      if (!state.note || isDeleted(state.note) || state.attaching) return;
      state.attaching = true;
      try { await flush(); const id = state.note.id, result = await call('note.attachFile',{id}); if (!result?.cancelled && state.note?.id === id && result?.markdown) { insertText('\n'+result.markdown+'\n'); await flush(); } }
      finally { state.attaching = false; }
    }
    async function attachBlob(file) {
      if (!state.note || isDeleted(state.note) || state.attaching) return;
      state.attaching = true;
      try {
        if (file.size > 16*1024*1024) throw new Error('16MB 이하의 이미지를 선택해 주세요.');
        const id = state.note.id;
        const base64 = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.')); reader.readAsDataURL(file); });
        const result = await mutate('note.attach',{id,bytes:base64});
        if (state.note?.id === id && result?.markdown) { insertText('\n'+result.markdown+'\n'); await flush(); }
      } finally { state.attaching = false; }
    }
    function imageFromTransfer(transfer) {
      for (const item of transfer?.items || []) { const file = item.kind === 'file' ? item.getAsFile() : null; if (file && (/^image\//.test(file.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name))) return file; }
      return [...transfer?.files || []].find(file => /^image\//.test(file.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name));
    }
    async function exportNote() { if (!state.note) return; await flush(); const result = await call('note.export',{id:state.note.id}); if (!result?.cancelled) feedback(result?.message || '메모를 내보냈습니다.'); }
    function editList(event) {
      if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || editor.readOnly) return false;
      const start = editor.value.lastIndexOf('\n',editor.selectionStart-1)+1, endAt = editor.value.indexOf('\n',editor.selectionStart);
      const end = endAt < 0 ? editor.value.length : endAt;
      const match = editor.value.slice(start,end).match(/^(\s*)([-*]|\d+)([.)]?)(\s+)(\[[ xX]\]\s+)?(.*)$/);
      if (!match) return false;
      event.preventDefault();
      if (!match[6].trim() && editor.selectionStart >= end) { editor.setSelectionRange(start,end); editor.setRangeText(match[1],start,end,'end'); }
      else { const marker = /^\d+$/.test(match[2]) ? String(Number(match[2])+1)+(match[3] || '.') : match[2]; editor.setRangeText('\n'+match[1]+marker+' '+(match[5] ? '[ ] ' : ''),editor.selectionStart,editor.selectionEnd,'end'); }
      markDirty(); return true;
    }
    function handleKeydown(event) {
      if (!state.active || !element.isConnected || event.isComposing || event.keyCode === 229) return false;
      const K = window.WhendeskKeys, mod = event.ctrlKey || event.metaKey, inEditor = event.target === editor, inList = event.target === search || list.contains(event.target) || event.target === list;
      const consume = action => { event.preventDefault(); if (!event.repeat) safe(action); return true; };
      if (K.is(event,'app.new')) return consume(() => newNote());
      if (K.is(event,'note.search')) return consume(() => { search.focus({preventScroll:true}); search.select(); });
      if (K.is(event,'app.save')) return consume(flush);
      if (K.is(event,'note.preview') && state.note) return consume(() => setPreview(!state.preview));
      if (K.is(event,'note.pin')) return consume(() => toggleFlag('note.pin'));
      if (K.is(event,'note.archive')) return consume(() => toggleFlag('note.archive'));
      if (K.is(event,'note.attach')) return consume(attachFile);
      if (K.is(event,'note.export')) return consume(exportNote);
      const scopeAction = ['note.scope.active','note.scope.archived','note.scope.trash'].find(id => K.is(event,id));
      if (scopeAction) return consume(() => setScope(K.find(scopeAction).scopeName));
      if (K.is(event,'note.restore') && !textField(event.target) && (state.undo || state.scope === 'trash')) return consume(() => state.undo ? restore(state.undo.id,{scope:state.undo.scope}) : restore(state.selectedId));
      if (K.is(event,'back')) {
        if ($('[data-note-content]').contains(event.target) && state.note) return consume(async () => { await flush(); focusList(); });
        if (event.target === search && search.value) return consume(async () => { state.query = ''; search.value = ''; await refresh(); search.focus({preventScroll:true}); });
        if (inList && state.query) return consume(async () => { state.query = ''; search.value = ''; await refresh(); focusList(); });
        if (inList && state.scope !== 'active') return consume(() => setScope('active'));
        return false;
      }
      if (inList && K.is(event,'note.scope.cycle')) { const order = ['active','archived','trash']; return consume(() => setScope(order[(order.indexOf(state.scope) + (event.shiftKey ? order.length - 1 : 1)) % order.length])); }
      if (inEditor) return editList(event);
      // 보기 모드의 본문에서 E는 편집으로 바꾼다.
      if (state.note && state.preview && preview.contains(event.target) && !textField(event.target) && K.is(event,'note.edit')) return consume(() => setPreview(false));
      // 목록에 포커스가 있을 때만 글자 키를 동작으로 읽는다(검색칸에서는 글자로 입력된다).
      if (list.contains(event.target) && !textField(event.target)) {
        if (K.is(event,'note.edit')) return consume(() => state.selectedId ? open(state.selectedId,{edit:true}) : null);
        if (K.is(event,'note.new')) return consume(() => newNote());
        if (K.is(event,'note.find')) return consume(() => { search.focus({preventScroll:true}); search.select(); });
        const cursor = K.is(event,'note.cursorUp') ? -1 : K.is(event,'note.cursorDown') ? 1 : 0;
        if (cursor) { event.preventDefault(); select(cursor); return true; }
      }
      // 검색칸의 ↓는 Work 검색과 같이 목록으로 내려간다. 목록에서는 ↑↓·J/K가 선택을 옮긴다.
      if (event.target === search && K.is(event,'note.down') && state.results.length) return consume(() => focusList());
      if (inList) {
        const move = K.is(event,'note.up') ? -1 : K.is(event,'note.down') ? 1 : 0, reorder = K.is(event,'note.moveUp') ? -1 : K.is(event,'note.moveDown') ? 1 : 0;
        if (reorder && !list.contains(event.target)) return false;
        if (reorder) {
          event.preventDefault();
          if (!event.repeat && isPinned(state.results.find(note => note.id === state.selectedId))) safe(async () => { await flush(); await mutate('note.reorder',{id:state.selectedId,direction:reorder}); await refresh({focus:list.contains(event.target)}); notify(); });
          return true;
        }
        if (move) { event.preventDefault(); select(move); return true; }
      }
      const edge = K.is(event,'note.first') ? 'first' : K.is(event,'note.last') ? 'last' : null;
      if (list.contains(event.target) && edge) { event.preventDefault(); select(0,{edge}); return true; }
      if (inList && K.is(event,'note.open')) return consume(() => activateSelected({edit:mod,createFromQuery:event.shiftKey}));
      if (list.contains(event.target) && !textField(event.target) && K.is(event,'note.delete') && state.scope !== 'trash') return consume(() => remove(state.selectedId));
      if (!textField(event.target) && event.target.matches('a[role=button]') && K.is(event,'link.activate')) { event.preventDefault(); event.target.click(); return true; }
      return false;
    }
    element.addEventListener('input',event => {
      if (event.target === editor) markDirty();
      else if (event.target === search) { state.query = search.value; ++searchSeq; state.searching = true; state.results = []; state.selectedId = null; renderList(); clearTimeout(searchTimer); searchTimer = setTimeout(() => safe(() => refresh()),100); }
    });
    element.addEventListener('change',event => {
      if (event.target === scope) safe(() => setScope(scope.value));
      if (event.target.matches('[data-note-preview] input[data-line]')) {
        const line = event.target.dataset.line; editor.value = window.MD.toggleTask(editor.value,Number(line)); markDirty(); renderPreview(); preview.querySelector(`input[data-line="${line}"]`)?.focus({preventScroll:true});
      }
    });
    element.addEventListener('focusin',rememberFocus);
    element.addEventListener('click',event => {
      const row = event.target.closest('[data-note-row]'); if (row) { safe(() => open(row.dataset.noteRow,{edit:true})); return; }
      const tag = event.target.closest('[data-note-tag]'); if (tag) { safe(() => searchTag(tag.dataset.noteTag)); return; }
      const backlink = event.target.closest('[data-note-open]'); if (backlink) { safe(() => open(backlink.dataset.noteOpen,{edit:false})); return; }
      const attachment = event.target.closest('[data-note-attachment]'); if (attachment) { safe(() => call('note.openAttachment',{id:state.note.id,file:attachment.dataset.noteAttachment})); return; }
      const link = event.target.closest('a');
      if (link && preview.contains(link)) { event.preventDefault(); if (link.classList.contains('wikilink')) safe(() => openLink(link.dataset.title)); else if (link.classList.contains('tag')) safe(() => searchTag(link.dataset.tag)); else if (link.classList.contains('ext')) safe(() => call('note.openExternal',{url:link.href})); return; }
      const button = event.target.closest('[data-note-action]'); if (!button) return;
      const actions = {create:() => newNote(),preview:() => setPreview(!state.preview),pin:() => toggleFlag('note.pin'),archive:() => toggleFlag('note.archive'),delete:remove,restore,attach:attachFile,export:exportNote};
      if (actions[button.dataset.noteAction]) safe(() => actions[button.dataset.noteAction]());
    });
    editor.addEventListener('blur',() => { if (pending.size) safe(flush); });
    editor.addEventListener('paste',event => { const file = imageFromTransfer(event.clipboardData); if (file) { event.preventDefault(); safe(() => attachBlob(file)); } });
    editor.addEventListener('dragover',event => { if ([...event.dataTransfer?.types || []].includes('Files')) event.preventDefault(); });
    editor.addEventListener('drop',event => { const file = imageFromTransfer(event.dataTransfer); if (file) { event.preventDefault(); safe(() => attachBlob(file)); } });
    if (container) mount(container);
    return {
      mount,refresh,open,create:newNote,flush,focus,setActive,handleKeydown,setScope,
      togglePreview:() => setPreview(!state.preview),
      hasPending:() => pending.size > 0,
      status:() => ({active:state.active,selectedId:state.selectedId,noteId:state.note?.id || null,scope:state.scope,query:state.query,preview:state.preview,pending:pending.size,error:state.error?.message || null}),
      element,
      dispose:async () => { await flush(); disposed = true; clearTimeout(saveTimer); clearTimeout(searchTimer); clearTimeout(previewTimer); element.remove(); },
    };
  }
  window.WhendeskNotes = Object.freeze({create});
})();
