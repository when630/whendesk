/* 대시보드 목록의 움직임: 미끄러지는 포커스 면 · 부드러운 스크롤 · 목록이 바뀔 때 줄이 새 자리로 미끄러지기(FLIP).
 * Command 결과 목록(app.js placeCommandCursor)과 같은 말투를 Today·InBox·Journey·노트 목록·프로젝트 목록에 입힌다.
 *
 * 포커스 면(.focus-glide): 키보드 포커스(:focus-visible)가 줄에 있을 때만 보인다. 줄이 속한 스크롤 영역 안에 하나를 깔고(뒤에, z-index -1)
 * 포커스가 옮겨 가면 그 자리로 미끄러진다. 위치는 offsetTop 기준이라 줄이 FLIP으로 움직이는 중에도 도착할 자리를 향한다.
 * 화면을 다시 그려 면이 지워지면 새 면을 이전 자리(last)에서 시작해 다시 미끄러뜨린다 — 다시 그린 티가 나지 않게.
 * 줄 자신의 포커스 배경은 면이 있는 동안 지운다(focus.css, .glide-active). 이 파일이 없으면 줄 배경이 그대로 포커스를 알린다. */
(() => {
  const root = document.getElementById('whendesk-command-first');
  if (!root) return;
  const ROWS = '[data-task-row],[data-work-project-row],.cf-home-task,.future-row,.desk-note-row';
  const FOCUSABLE = ROWS + ',.td-day'; // 포커스 면은 달력 날짜 칸도 따라간다(FLIP은 줄만)
  const EASE = 'cubic-bezier(.16,1,.3,1)', SOFT = 'cubic-bezier(.4,0,.2,1)';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const last = new WeakMap();
  let watched = null;
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => update()) : null;

  function containerOf(element) {
    for (let node = element?.parentElement; node && node !== root; node = node.parentElement) {
      if (node.matches('.td-calendar-side') || /(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node; // 오른쪽 작은 달력은 스크롤하지 않아도 면을 깐다
    }
    return null;
  }
  // 면을 깔 스크롤 영역을 기준(position)으로 삼는다. 기준이 생긴 뒤에 위치를 재야 offsetParent 사슬이 영역에서 끝난다.
  // 기준이 없을 때(static)만 relative를 준다. 이미 자리 잡힌 것(fixed·absolute·sticky)을 relative로 덮으면 그 요소가 흐름에 끼어 엉뚱한 곳에 그려진다.
  function anchor(container) { if (getComputedStyle(container).position === 'static') container.style.position = 'relative'; }
  function host(container) { if (!container.classList.contains('glide-host')) { container.classList.add('glide-host'); anchor(container); } return container; }
  function offsetWithin(element, container) {
    let x = 0, y = 0, node = element;
    while (node && node !== container) { x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent; }
    return node === container ? { x, y } : null;
  }
  function rowFor(element) {
    if (!element || !root.contains(element)) return null;
    if (element.matches('[role=listbox]')) return element.querySelector('[aria-selected=true]');
    return element.closest(FOCUSABLE);
  }
  function showing() {
    const active = document.activeElement;
    return !!active && active.matches(':focus-visible') && !root.classList.contains('focus-quiet') && !root.classList.contains('is-command');
  }
  function place(glide, box, animate) {
    if (!animate) glide.style.transition = 'none';
    glide.style.transform = `translate(${box.x}px,${box.y}px)`; glide.style.width = box.w + 'px'; glide.style.height = box.h + 'px';
    if (!animate) { void glide.offsetWidth; glide.style.transition = ''; }
  }
  function glideIn(container) {
    let glide = container.querySelector(':scope>.focus-glide');
    if (!glide) {
      glide = document.createElement('div'); glide.className = 'focus-glide'; glide.setAttribute('aria-hidden', 'true'); container.prepend(glide);
      const from = last.get(container); if (from) { place(glide, from, false); glide.classList.add('on'); }
    }
    return glide;
  }
  function watch(row) {
    if (watched === row || !resize) return;
    if (watched) resize.unobserve(watched);
    watched = row; if (row) resize.observe(row);
  }
  function update() {
    const row = rowFor(document.activeElement), visible = !!row && showing();
    const container = visible ? containerOf(row) : null;
    root.classList.toggle('glide-active', !!container);
    for (const glide of root.querySelectorAll('.focus-glide')) if (glide.parentElement !== container) glide.classList.remove('on');
    if (!container) { watch(null); return; }
    host(container);
    const at = offsetWithin(row, container); if (!at) return;
    const reach = 0; // 줄마다 좌우 여백이 있어(brand.css) 면은 줄 크기 그대로다
    const box = { x:at.x - reach, y:at.y, w:row.offsetWidth + reach * 2, h:row.offsetHeight };
    const glide = glideIn(container), moving = glide.classList.contains('on');
    place(glide, box, moving && !reduced());
    glide.classList.add('on'); last.set(container, box); watch(row);
  }
  // 화면이 바뀌면(Today → InBox) 지난 화면의 자리에서 미끄러져 오지 않게 잊는다.
  function reset(container) { if (container) last.delete(container); container?.querySelector(':scope>.focus-glide')?.remove(); }

  // 줄이 스크롤 영역 밖에 있으면 부드럽게 굴려 보이게 한다(키를 누르고 있으면 목표만 바뀌며 이어서 굴러간다).
  function reveal(element) {
    const container = containerOf(element); if (!element || !container) { element?.scrollIntoView({ block:'nearest' }); return; }
    host(container);
    const at = offsetWithin(element, container); if (!at) { element.scrollIntoView({ block:'nearest' }); return; }
    const pad = 8, top = at.y - pad, bottom = at.y + element.offsetHeight + pad, behavior = reduced() ? 'auto' : 'smooth';
    if (top < container.scrollTop) container.scrollTo({ top, behavior });
    else if (bottom > container.scrollTop + container.clientHeight) container.scrollTo({ top:bottom - container.clientHeight, behavior });
  }
  function focus(element) { if (!element) return; element.focus({ preventScroll:true }); reveal(element); }

  /* FLIP: 다시 그리기 전에 줄 자리를 재 두고(measure), 그린 뒤 같은 줄은 이전 자리에서 새 자리로 미끄러지고 새 줄은 떠오른다(play).
   * 지워진 줄은 이미 없으므로 남은 줄이 그 틈을 메우며 미끄러지는 것으로 보인다. */
  function keyOf(element) {
    const data = element.dataset;
    if (data.taskRow) return 't:' + data.taskRow;
    if (data.workProjectRow) return 'p:' + data.workProjectRow;
    if (data.noteRow) return 'n:' + data.noteRow;
    const target = element.matches('[data-reveal],[data-event]') ? element : element.querySelector('[data-reveal],[data-event]');
    return target?.dataset.reveal ? 'r:' + target.dataset.reveal : target?.dataset.event ? 'e:' + target.dataset.event : null;
  }
  function measure(scope) {
    const map = new Map(); if (!scope || reduced()) return map;
    for (const element of scope.querySelectorAll(ROWS)) { const key = keyOf(element); if (key && !map.has(key)) map.set(key, { top:element.getBoundingClientRect().top, done:isDone(element) }); }
    return map;
  }
  function play(scope, before) {
    if (!scope || !before?.size || reduced() || before.size > 400) return;
    for (const element of scope.querySelectorAll(ROWS)) {
      const key = keyOf(element); if (!key) continue;
      if (!before.has(key)) { element.animate([{ opacity:0, transform:'translateY(-4px)' }, { opacity:1, transform:'none' }], { duration:220, easing:EASE }); continue; }
      const was = before.get(key), dy = was.top - element.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) element.animate([{ transform:`translateY(${dy}px)` }, { transform:'none' }], { duration:260, easing:EASE });
      // 완료·되살리기로 기호가 바뀌면 기호가 살짝 눌렸다 튀어 오른다.
      if (was.done !== isDone(element)) element.querySelector('[data-mark],[data-check],.journal-glyph,.task-mark')?.animate([{ transform:'scale(.55)', opacity:.4 }, { transform:'scale(1.12)', offset:.6 }, { transform:'none', opacity:1 }], { duration:260, easing:'ease-out' });
    }
  }
  function isDone(element) { return element.classList.contains('done') || element.classList.contains('cancelled'); }
  // 화면에 들어올 때 줄이 위에서부터 차례로 떠오른다(처음 열두 줄만).
  function enter(scope) {
    if (!scope || reduced()) return;
    [...scope.querySelectorAll(ROWS)].slice(0, 12).forEach((element, index) => element.animate([{ opacity:0, transform:'translateY(5px)' }, { opacity:1, transform:'none' }], { duration:240, delay:40 + index * 18, easing:EASE, fill:'backwards' }));
  }

  document.addEventListener('focusin', () => update());
  document.addEventListener('focusout', () => setTimeout(update));
  new MutationObserver(() => update()).observe(root, { attributes:true, attributeFilter:['class'] });
  window.addEventListener('resize', () => { update(); tabs(); });
  /* 선택 표시가 옆으로 미끄러진다(머리 탭·설정 분류 탭의 알약, 선택 메뉴의 고른 줄). 탭 막대는 다시 그릴 때마다 새로 생기므로
   * 지난 자리(marks, 이름별)를 기억했다가 새 표시를 그 자리에서 시작해 새 자리로 보낸다. */
  const marks = new Map();
  function mark(container, element, name, className) {
    if (!container) return;
    let marker = container.querySelector(`:scope>.${className}`);
    if (!element) { marker?.remove(); return; }
    // 숨은 상태(Command 모드에서 그린 대시보드)에서는 크기가 0으로 재진다. 그때는 재지도 기억하지도 않는다 — 보이게 된 뒤 tabs()가 다시 잰다.
    if (!element.offsetWidth || !element.offsetHeight) return;
    if (!container.classList.contains('mark-host')) { container.classList.add('mark-host'); anchor(container); }
    const box = { x:element.offsetLeft, y:element.offsetTop, w:element.offsetWidth, h:element.offsetHeight };
    if (!marker) {
      marker = document.createElement('span'); marker.className = className; marker.setAttribute('aria-hidden', 'true'); container.prepend(marker);
      place(marker, marks.get(name) || box, false);
    }
    place(marker, box, !reduced()); marks.set(name, box);
  }
  function tabs(scope) {
    for (const list of (scope || root).querySelectorAll('.td-tabs,.cal-views')) {
      const name = list.classList.contains('td-tabs') ? 'top' : list.classList.contains('settings-tabs') ? 'settings' : 'views';
      mark(list, list.querySelector('[role=tab][aria-selected=true]'), name, 'tab-glide');
    }
  }

  /* 방향이 있는 등장: 오른쪽 탭으로 가면 오른쪽에서, 왼쪽이면 왼쪽에서 살짝 밀려 들어온다(direction 0이면 아래에서 떠오른다). */
  // 옆으로 오가는 화면 전환은 튀지 않게 부드럽게 출발해 부드럽게 서는 곡선(SOFT)과 짧은 거리로 움직인다.
  function slide(element, direction = 0, { distance = 8, duration = 240 } = {}) {
    if (!element || reduced()) return;
    const from = direction ? `translateX(${direction * distance}px)` : 'translateY(6px)';
    element.animate([{ opacity:0, transform:from }, { opacity:1, transform:'none' }], { duration, easing:direction ? SOFT : EASE });
  }

  /* 잔상 퇴장: 대화상자·알림·도움말·선택 메뉴·동작 목록은 닫는 즉시 로직은 끝나고, 보이는 모습만 복제해 사라지게 한 뒤 지운다.
   * 복제본은 닫힌 Shadow DOM 안에 둔다 — 문서 검색(앱의 querySelector·테스트 선택자)에 원본과 겹쳐 잡히지 않게.
   * 그 안에서도 모양이 같도록 문서 스타일시트를 한 장으로 옮기고(sheet), 원본의 조상(테마·Command 모드 등)을 상자 없는 껍데기로 재현한다. */
  let ghostSheet = null;
  function sheet() {
    if (ghostSheet) return ghostSheet;
    const text = [...document.styleSheets].map(styles => { try { return [...styles.cssRules].map(rule => rule.cssText).join(String.fromCharCode(10)); } catch { return ''; } }).join(String.fromCharCode(10));
    ghostSheet = new CSSStyleSheet(); try { ghostSheet.replaceSync(text); } catch {}
    return ghostSheet;
  }
  function ghost(element, kind = 'fade') {
    if (!element || element.hidden || !element.isConnected || reduced() || !element.getClientRects().length) return;
    const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const copy = element.cloneNode(true);
    const fields = element.querySelectorAll('input,textarea,select'), copied = copy.querySelectorAll('input,textarea,select');
    fields.forEach((field, index) => { if (copied[index] && field.type !== 'file') copied[index].value = field.value; });
    copy.classList.add('motion-ghost'); copy.inert = true;
    Object.assign(copy.style, { position:'fixed', left:rect.left + 'px', top:rect.top + 'px', width:rect.width + 'px', height:rect.height + 'px', margin:'0', transform:'none', pointerEvents:'none' });
    // 조상 껍데기: root부터 원본 바로 위까지 태그·클래스·속성만 옮기고 상자는 만들지 않는다(display:contents).
    const chain = []; for (let node = element.parentElement; node; node = node.parentElement) { chain.unshift(node); if (node === root) break; }
    const host = document.createElement('div'); host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000';
    const shadow = host.attachShadow({ mode:'closed' }); shadow.adoptedStyleSheets = [sheet()];
    let parent = shadow;
    for (const node of chain) { const shell = node.cloneNode(false); shell.removeAttribute('hidden'); shell.style.display = 'contents'; parent.append(shell); parent = shell; }
    parent.append(copy); document.body.append(host);
    const out = { duration:140, easing:'cubic-bezier(.5,0,.75,0)', fill:'forwards' };
    let animation;
    if (kind === 'modal') {
      animation = copy.animate([{ opacity:1 }, { opacity:0 }], { ...out, duration:160 });
      copy.querySelector('.td-modal')?.animate([{ transform:'none' }, { transform:'translateY(6px) scale(.98)' }], { ...out, duration:160 });
    } else if (kind === 'toast') animation = copy.animate([{ opacity:1, transform:'none' }, { opacity:0, transform:'translateY(8px)' }], out);
    else if (kind === 'pick') animation = copy.animate([{ opacity:1, transform:'none' }, { opacity:0, transform:'translateY(-4px) scale(.98)' }], { ...out, duration:110 });
    else if (kind === 'rollup') animation = copy.animate([{ clipPath:'inset(0 0 0 0 round 20px)', opacity:1 }, { clipPath:'inset(0 0 100% 0 round 20px)', opacity:.6 }], out);
    else animation = copy.animate([{ opacity:1 }, { opacity:0 }], out);
    const done = () => host.remove(); animation.finished.then(done, done); setTimeout(done, 600);
  }

  window.WhendeskGlide = Object.freeze({ update, reset, reveal, focus, measure, play, enter, mark, tabs, slide, ghost });
})();
