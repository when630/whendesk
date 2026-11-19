/* 키보드 재설계 2단계 검증: 화면마다 같은 동사 키(N 새로·Enter 열기·E 편집·X 삭제·U 되돌리기·/ 검색·J/K 이동),
 * 화면을 넘나드는 하나의 되돌리기 기록, 메모 보기 기본과 즉시 미리보기, Projects A·U 분리, 접힌 행 Ctrl+Enter 무동작.
 * 실제 개발 main·격리된 프로필에서 키보드 입력만 사용한다. fixture는 desk API로 만든다. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron:electron } = require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname,'..');
// WHENDESK_TEST_PACKAGED=1이면 WHENDESK_TEST_EXECUTABLE의 배포본을 검사한다. 배포본은 resources/app을 앱 경로로 쓴다.
const packaged = process.env.WHENDESK_TEST_PACKAGED === '1';
const executable = process.env.WHENDESK_TEST_EXECUTABLE || 'D:/when630/whencommand/node_modules/electron/dist/electron.exe';
const appRoot = packaged ? path.join(path.dirname(executable),'resources','app') : root;
const runId = String(Date.now());
const output = path.join(root,'test-output');
const dataDir = path.join(output,'common-keys-profile-'+runId);
const shots = path.join(output,'common-keys-shots',runId);
fs.mkdirSync(shots,{recursive:true});
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const results = [], errors = [], screenshots = [], measurements = {inputMethods:['page.keyboard.press','page.keyboard.insertText'],pointerActions:0};
let app,page,identity,failure=null;
const call = (method,payload) => page.evaluate(({method,payload})=>window.desk.call(method,payload),{method,payload});
const state = () => call('state',{});
const press = key => page.keyboard.press(key);
async function waitUntil(predicate,message){const deadline=Date.now()+12000;do{if(await predicate())return;await page.waitForTimeout(35);}while(Date.now()<deadline);assert.fail(message);}
const focused = selector => page.evaluate(selector=>!!document.activeElement?.matches(selector),selector);
const within = selector => page.evaluate(selector=>!!document.activeElement?.closest(selector),selector);
async function waitFocus(selector){await waitUntil(()=>focused(selector),'포커스가 도착하지 않았습니다: '+selector);}
async function waitWithin(selector){try{await waitUntil(()=>within(selector),'');}catch{assert.fail('포커스가 영역 안에 없습니다: '+selector+' · 지금 '+await page.evaluate(()=>{const e=document.activeElement;return e?e.tagName+'.'+e.className+' '+(e.outerHTML||'').slice(0,160):'none';}));}}
const selectedNote = () => page.locator('[data-note-list] [aria-selected=true]').getAttribute('data-note-row');
const note = async id => (await state()).notes.find(item=>item.id===id);
const task = async id => (await state()).tasks.find(item=>item.id===id);
async function screenshot(name){const file=path.join(shots,name+'.png');await page.screenshot({path:file,animations:'disabled'});screenshots.push(file);}
async function test(name,action){const start=Date.now();try{await action();results.push({name,ok:true,durationMs:Date.now()-start});}catch(error){results.push({name,ok:false,durationMs:Date.now()-start,error:error.message});throw error;}}
function normalize(value){return String(value).replace(/\\"/g,'"').replace(/"/g,'').replace(/\\/g,'/').toLowerCase();}
async function closeApp(){
  if(!app)return;
  const child=app.process(),spawn=(child?.spawnargs||[]).map(normalize).join(' '),argv=(identity?.argv||[]).map(normalize);
  const owned=(spawn.includes(normalize(packaged?executable:root))&&spawn.includes(normalize('--data-dir='+dataDir))) || (child?.pid===identity?.childPid&&identity?.dataDir===dataDir&&argv.includes(normalize('--data-dir='+dataDir))&&normalize(identity?.appPath)===normalize(appRoot));
  let timer;
  try{await Promise.race([(async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__whendeskFlush?.()).catch(()=>{});await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);return true;}).catch(()=>{});await app.close().catch(()=>{});})(),new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);}finally{clearTimeout(timer);}
  const alive=child&&child.exitCode===null&&child.signalCode===null;
  if(alive){if(!owned)throw new Error('이 실행의 격리된 개발 프로세스인지 확인하지 못했습니다.');child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);clearTimeout(timer);}
  measurements.cleanup={owned,forced:!!alive,exitCode:child?.exitCode??null};
}

(async()=>{
  try{
    app=await electron.launch({executablePath:executable,args:[...(packaged?[]:[root]),'--test','--no-media','--data-dir='+dataDir],env,timeout:30000});
    page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>window.desk?.call&&document.querySelector('.td-command input')===document.activeElement);
    identity=await app.evaluate(({app})=>({argv:[...process.argv],mainPid:process.pid,appPath:app.getAppPath()}));identity.childPid=app.process()?.pid;identity.dataDir=(await call('app.info')).dataDir;
    assert.equal(identity.dataDir,dataDir);assert.equal(normalize(identity.appPath),normalize(appRoot));assert.equal((await call('app.info')).isPackaged,packaged);
    const initial=await state();assert.equal(initial.tasks.length+initial.notes.length,0);

    const inboxTask=await call('mutate',{type:'task.create',payload:{title:'공통키 인박스 '+runId}});
    const notes=[];for(const name of ['하나','둘','셋'])notes.push(await call('mutate',{type:'note.create',payload:{body:`공통키 메모 ${name} ${runId}\n본문 ${name}`}}));

    await test('메모 목록: 검색 ↓로 목록 진입, J/K와 즉시 미리보기, Enter 보기, E 편집, / 검색, N 새 메모',async()=>{
      await press('Tab');await page.locator('#cf-dashboard-panel').waitFor();
      await page.evaluate(section=>window.__whendeskGo(section),'notes');await waitFocus('[data-note-search]');
      // 목록이 그려지기 전의 ↓는 옮길 행이 없어 무시된다 — 행을 기다린 뒤 누른다(가끔 실패하던 원인).
      await page.locator('[data-note-list] [data-note-row]').first().waitFor();
      await press('ArrowDown');await waitWithin('[data-note-list]');
      const first=await selectedNote();
      await press('j');await waitUntil(async()=>await selectedNote()!==first,'J가 선택을 옮기지 않았습니다.');
      const second=await selectedNote(),secondTitle=(await note(second)).title;
      await waitWithin('[data-note-list]');
      await waitUntil(async()=>await page.locator('[data-note-preview]').isVisible()&&(await page.locator('[data-note-preview]').innerText()).includes(secondTitle),'선택을 옮겨도 오른쪽 미리보기가 바뀌지 않았습니다.');
      assert.equal(await within('[data-note-list]'),true,'즉시 미리보기가 목록 포커스를 가져갔습니다.');
      await screenshot('01-note-instant-preview');
      await press('k');await waitUntil(async()=>await selectedNote()===first,'K가 선택을 되돌리지 않았습니다.');
      await press('Enter');await waitFocus('[data-note-preview]');
      assert.equal(await page.locator('[data-note-editor]').isVisible(),false,'Enter가 보기가 아니라 편집으로 열었습니다.');
      // 보기 모드에서 E는 본문 밖(도구 막대)에 포커스가 있어도 편집으로 들어간다. Ctrl+S는 저장하고 보기로 나온다.
      await page.locator('[data-note-action=pin]').focus();await press('e');await waitFocus('[data-note-editor]');
      await press('End');await page.keyboard.insertText(' 덧붙임');await press('Control+s');await waitFocus(`[data-note-row="${first}"]`); // 저장하고 보기로 나와 목록의 그 줄로
      assert.equal(await page.locator('[data-note-editor]').isVisible(),false,'Ctrl+S가 보기 모드로 나오지 않았습니다.');
      await waitUntil(async()=>(await note(first)).body.includes(' 덧붙임'),'Ctrl+S가 메모를 저장하지 않았습니다.');
      await press('e');await waitFocus('[data-note-editor]');
      await press('Escape');await waitWithin('[data-note-list]');
      await press('e');await waitFocus('[data-note-editor]');
      await press('Escape');await waitWithin('[data-note-list]');
      await press('/');await waitFocus('[data-note-search]');
      await press('ArrowDown');await waitWithin('[data-note-list]');
      const count=(await state()).notes.length;
      await press('n');await waitFocus('[data-note-editor]');await page.keyboard.insertText('공통키 새 메모 '+runId);await press('Control+s');
      await waitUntil(async()=>(await state()).notes.length===count+1,'N이 새 메모를 만들지 않았습니다.');
      await waitWithin('[data-note-list]'); // Ctrl+S가 저장하고 목록으로 보냈다
    });

    await test('되돌리기 기록은 화면을 넘나든다: 메모 X 삭제·할 일 완료를 Work의 U로 최근 것부터 되돌린다',async()=>{
      await press('Home');await waitWithin('[data-note-list]');
      const target=await selectedNote();
      await press('x');await waitUntil(async()=>(await note(target))?.deleted===true,'X가 메모를 삭제하지 않았습니다.');
      await page.evaluate(section=>window.__whendeskGo(section),'inbox');await waitWithin(`[data-task-row="${inboxTask.id}"]`);
      await press('Space');await waitUntil(async()=>(await task(inboxTask.id)).done===true,'Space가 할 일을 완료하지 않았습니다.');
      await waitWithin('.td-main');
      await press('u');await waitUntil(async()=>(await task(inboxTask.id)).done===false,'첫 U가 가장 최근 작업(완료)을 되돌리지 않았습니다.');
      assert.equal((await note(target)).deleted,true,'첫 U가 더 오래된 메모 삭제까지 되돌렸습니다.');
      await waitWithin('.td-main');
      await press('u');await waitUntil(async()=>(await note(target))?.deleted===false,'두 번째 U가 다른 화면의 메모 삭제를 되돌리지 않았습니다.');
      measurements.crossScreenUndo={task:inboxTask.id,note:target};
    });

    await test('접힌 할 일 행의 Ctrl+Enter는 완료하지 않고, Projects의 A는 보관함 보기·U는 되돌리기다',async()=>{
      await page.evaluate(section=>window.__whendeskGo(section),'inbox');await waitWithin(`[data-task-row="${inboxTask.id}"]`);
      await press('Control+Enter');await page.waitForTimeout(400);
      assert.equal((await task(inboxTask.id)).done,false,'접힌 행의 Ctrl+Enter가 할 일을 완료했습니다.');
      // 프로젝트 관리는 설정의 프로젝트 분류에 있다.
      await page.evaluate(()=>window.__whendeskGo('projects'));await page.locator('[data-settings-tab=projects][aria-selected=true]').waitFor();
      const toggle=page.locator('[data-action=work-project-trash]');
      assert.equal(await toggle.getAttribute('aria-pressed'),'false');
      await press('a');await waitUntil(async()=>await toggle.getAttribute('aria-pressed')==='true','A가 보관함 보기로 바꾸지 않았습니다.');
      await press('Escape');await waitUntil(async()=>await toggle.getAttribute('aria-pressed')==='false','Esc가 보관함 보기를 풀지 않았습니다.');
      await press('u');await waitUntil(async()=>(await page.locator('.td-feedback').innerText().catch(()=>'')).includes('되돌릴 작업이 없어요'),'Projects의 U가 되돌리기로 동작하지 않았습니다.');
      assert.equal(await toggle.getAttribute('aria-pressed'),'false','Projects의 U가 보관함 보기를 바꿨습니다.');
      await screenshot('02-projects');
      assert.equal(errors.length,0,errors.join('\n'));
    });

    await test('할 일 편집기의 마감 칸은 자연어로 입력하고, 잘못된 값은 되돌리며, U로 되돌린다',async()=>{
      const dayKey=offset=>page.evaluate(offset=>{const d=new Date();d.setDate(d.getDate()+offset);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');},offset);
      await page.evaluate(section=>window.__whendeskGo(section),'inbox');await waitWithin(`[data-task-row="${inboxTask.id}"]`);
      await press('Enter');await waitFocus('[data-editor] [data-field=title]');
      for(let step=0;step<6&&!await focused('[data-editor] [data-field=due]');step++)await press('Tab');
      await waitFocus('[data-editor] [data-field=due]');
      const due=page.locator('[data-editor] [data-field=due]');
      await press('Control+a');await page.keyboard.insertText('+3');await press('Enter');
      const plus3=await dayKey(3);
      await waitUntil(async()=>(await task(inboxTask.id)).due===plus3,'+3이 사흘 뒤 마감으로 저장되지 않았습니다.');
      await waitUntil(async()=>await due.inputValue()===plus3,'해석한 날짜가 칸에 보이지 않습니다.');
      await press('Control+a');await page.keyboard.insertText('아무때나');await press('Enter');
      await waitUntil(async()=>/마감 형식/.test(await page.locator('.td-feedback').innerText().catch(()=>'')),'잘못된 마감 형식을 알리지 않았습니다.');
      assert.equal(await due.inputValue(),plus3,'잘못된 값이 칸에 남았습니다.');assert.equal((await task(inboxTask.id)).due,plus3);
      await press('Control+a');await press('Backspace');await press('Enter');
      await waitUntil(async()=>!(await task(inboxTask.id)).due,'비운 마감이 해제되지 않았습니다.');
      await press('Escape');await waitWithin(`[data-task-row="${inboxTask.id}"]`);
      await press('u');await waitUntil(async()=>(await task(inboxTask.id)).due===plus3,'U가 마감 해제를 되돌리지 않았습니다.');
      await press('u');await waitUntil(async()=>!(await task(inboxTask.id)).due,'U가 처음 마감 지정까지 되돌리지 않았습니다.');
    });

    await test('설정의 시작과 알림: 아침 브리핑을 키보드로 끄고 켜며, 개발 실행에서는 자동 시작을 막는다',async()=>{
      await press('Control+Comma');await page.locator('[data-pref=briefEnabled]').waitFor();
      for(let step=0;step<30&&!await focused('[data-pref=briefEnabled]');step++)await press('Tab');
      await waitFocus('[data-pref=briefEnabled]');
      assert.equal((await call('preferences.get')).briefEnabled,true);
      await press('Space');await waitUntil(async()=>(await call('preferences.get')).briefEnabled===false,'아침 브리핑을 끄지 못했습니다.');
      await press('Space');await waitUntil(async()=>(await call('preferences.get')).briefEnabled===true,'아침 브리핑을 다시 켜지 못했습니다.');
      assert.equal(await page.locator('[data-pref=briefAt]').inputValue(),'09:00');
      const info=await call('app.info');
      assert.equal(await page.locator('[data-pref=launchAtLogin]').isDisabled(),!info.launchAtLoginSupported,'자동 시작 칸의 사용 가능 여부가 실행 형태와 다릅니다.');
      await screenshot('04-settings-startup');
    });

    await test('스크롤바는 보이지 않고, 목록만 스크롤되며 제목·탭은 위에, 힌트는 맨 아래에 뒤가 비치지 않게 붙는다',async()=>{
      for(let index=1;index<=30;index++)await call('mutate',{type:'task.create',payload:{title:`스크롤 ${index} ${runId}`}});
      await page.evaluate(section=>window.__whendeskGo(section),'inbox');await waitWithin('.td-main');await page.waitForTimeout(300);
      const layout=await page.evaluate(()=>{
        const main=document.querySelector('.td-main'),scroller=document.querySelector('.td-main>.td-body'),head=document.querySelector('.td-main-head'),hints=document.querySelector('.td-hints');
        const headBefore=head.getBoundingClientRect().top;scroller.scrollTop=scroller.scrollHeight;
        const bars=[...document.querySelectorAll('#whendesk-command-first *')].filter(el=>el.scrollHeight>el.clientHeight+1&&['auto','scroll'].includes(getComputedStyle(el).overflowY)&&el.offsetWidth-el.clientWidth>0).map(el=>el.className);
        const mainBox=main.getBoundingClientRect(),hintsBox=hints.getBoundingClientRect();
        return {scrolled:scroller.scrollTop,headMoved:Math.round(head.getBoundingClientRect().top-headBefore),gapBelowHints:Math.round(mainBox.bottom-hintsBox.bottom),hintsOpaque:getComputedStyle(hints).backgroundColor!=='rgba(0, 0, 0, 0)',bars};
      });
      measurements.scrollLayout=layout;
      assert.ok(layout.scrolled>0,'목록이 스크롤되지 않았습니다.');
      assert.equal(layout.headMoved,0,'스크롤하면 제목이 밀려 올라갑니다.');
      assert.equal(layout.gapBelowHints,0,'힌트 아래로 목록이 비쳐 보입니다.');
      assert.ok(layout.hintsOpaque,'힌트 줄 배경이 투명합니다.');
      assert.deepEqual(layout.bars,[],'보이는 스크롤바가 있습니다.');
    });

    await test('대시보드의 Tab은 버튼·체크박스를 건너뛰고, 창을 끄는 자리에 표시가 있다',async()=>{
      await page.evaluate(section=>window.__whendeskGo(section),'inbox');await waitWithin(`[data-task-row="${inboxTask.id}"]`);
      await press('Enter');await waitFocus('[data-editor] [data-field=title]');
      const visited=[];
      for(let step=0;step<10;step++){await press('Tab');visited.push(await page.evaluate(()=>{const element=document.activeElement;return (element.matches('.td-pick')?'PICK':element.tagName+(element.type?':'+element.type:''))+(element.dataset.field?'#'+element.dataset.field:'');}));}
      measurements.tabStops=visited;
      assert.deepEqual(visited.filter(stop=>stop.startsWith('BUTTON')||stop.includes(':checkbox')),[],'Tab이 버튼이나 체크박스에 멈췄습니다: '+visited.join(' → '));
      assert.ok(visited.some(stop=>stop.endsWith('#due'))&&visited.some(stop=>stop.endsWith('#note')),'편집기의 입력 칸을 Tab으로 돌지 못했습니다: '+visited.join(' → '));
      await press('Escape');
      const grips=await page.evaluate(()=>['.command-grip','.head-grip'].map(selector=>{const element=document.querySelector(selector);return element&&getComputedStyle(element).webkitAppRegion;}));
      assert.deepEqual(grips,['drag','drag'],'창을 끄는 자리 표시가 없거나 끌기 영역이 아닙니다.');
      await screenshot('05-grips');
    });

    await test('Ctrl+Tab·Ctrl+Shift+Tab은 머리 탭(Today·InBox·Journey·Note)을 순환한다',async()=>{
      const title=()=>page.locator('.td-main-head h1').innerText();
      await page.evaluate(section=>window.__whendeskGo(section),'inbox');await waitUntil(async()=>(await title())==='InBox','InBox로 가지 않았습니다.');
      // 선택 알약(glide.js .tab-glide)은 탭을 바꿔도 같은 요소로 남아 이어 미끄러진다 — 막대를 새로 만들면 선택 배경이 먼저 깜빡인다.
      await page.evaluate(()=>{window.__tabMarker=document.querySelector('.td-main-head .td-tabs>.tab-glide');});
      const visited=[];
      for(const key of ['Control+Tab','Control+Tab','Control+Tab','Control+Tab','Control+Shift+Tab']){const before=await title();await press(key);await waitUntil(async()=>await title()!==before,key+'가 탭을 바꾸지 않았습니다.');visited.push(await title());}
      measurements.menuCycle=visited;
      measurements.tabMarker=await page.evaluate(()=>{const markers=document.querySelectorAll('.td-main-head .td-tabs>.tab-glide'),selected=document.querySelector('.td-main-head [role=tab][aria-selected=true]');return {count:markers.length,same:markers[0]===window.__tabMarker,selectedBackground:getComputedStyle(selected).backgroundColor};});
      assert.deepEqual(measurements.tabMarker,{count:1,same:true,selectedBackground:'rgba(0, 0, 0, 0)'},'탭을 바꾸면 선택 알약이 새로 생기거나 선택 배경이 따로 칠해졌습니다: '+JSON.stringify(measurements.tabMarker));
      assert.deepEqual(visited,['Journey','Note','Today','InBox','Today'],'탭 순환 순서가 다릅니다: '+visited.join(' → '));
    });

    await test('화면에 들어온 직후에는 포커스 표시가 없고 키로 움직이면 생긴다',async()=>{
      // 대시보드에서 시작한다 — Work의 Tab은 분류를 바꾸는 키라 앱이 둔 포커스가 다시 조용해진다.
      await page.evaluate(()=>window.__whendeskGo('dashboard'));await page.waitForTimeout(100);
      const mark=()=>page.evaluate(()=>{const element=document.activeElement,style=getComputedStyle(element),row=element.closest('.cf-home-task'),painted=!!row&&getComputedStyle(row).backgroundColor!=='rgba(0, 0, 0, 0)'||[...document.querySelectorAll('.focus-glide.on')].some(glide=>{const g=glide.getBoundingClientRect(),r=element.getBoundingClientRect(),cy=r.top+r.height/2;return getComputedStyle(glide).opacity>0.5&&g.top<=cy&&g.bottom>=cy;});return {quiet:document.getElementById('whendesk-command-first').classList.contains('focus-quiet'),tag:element.tagName,shown:(style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>0)||style.boxShadow!=='none'||painted};});
      for(const key of ['Control+Tab','Control+Shift+Tab']){
        await press(key);await page.waitForTimeout(150);const landed=await mark();
        assert.equal(landed.quiet,true,key+' 뒤 앱이 둔 포커스가 조용하지 않습니다.');assert.equal(landed.shown,false,key+' 뒤 포커스 표시가 바로 보입니다: '+JSON.stringify(landed));
      }
      await press('Tab');await page.waitForTimeout(100);const moved=await mark();
      assert.equal(moved.quiet,false,'키로 움직였는데 조용한 포커스가 풀리지 않았습니다.');
      assert.ok(moved.shown||['INPUT','TEXTAREA','SELECT'].includes(moved.tag),'키로 움직였는데 포커스 표시가 없습니다: '+JSON.stringify(moved));
    });

    await test('Today는 ↑↓로 항목을 오가고 Space 완료한 일은 × 줄로 남는다',async()=>{
      // – 한 줄 메모는 Work 항목이다(긴 글의 Note 문서는 저널에 오르지 않는다).
      const memo=await call('mutate',{type:'task.create',payload:{title:'저널 메모 '+runId,kind:'note'}});
      const ids=[];for(const title of ['대시보드 첫째 '+runId,'대시보드 둘째 '+runId]){const created=await call('mutate',{type:'task.create',payload:{title}});await call('mutate',{type:'task.update',payload:{id:created.id,kind:'todo'}});ids.push(created.id);}
      await page.evaluate(section=>window.__whendeskGo(section),'inbox');await page.evaluate(section=>window.__whendeskGo(section),'dashboard');await waitUntil(async()=>(await page.locator('.td-main-head h1').innerText())==='Today','Today로 가지 않았습니다.');
      const active=()=>page.evaluate(()=>{const element=document.activeElement;return element.dataset.reveal?(element.closest('.is-note')?'note:':'task:')+element.dataset.reveal:element.classList.contains('cf-entry')?'entry:'+element.dataset.action:element.tagName+'.'+element.className;});
      const items=await page.evaluate(()=>[...document.querySelectorAll('.cf-home-task :is([data-reveal],[data-event],[data-open-note]),.cf-entry')].map(element=>element.dataset.reveal?(element.closest('.is-note')?'note:':'task:')+element.dataset.reveal:element.dataset.event?'event:'+element.dataset.event:'entry:'+element.dataset.action));
      for(const id of ids)assert.ok(items.includes('task:'+id),'오늘 담은 할 일이 오늘 칸에 없습니다.');
      assert.ok(items.includes('note:'+memo.id),'오늘 적은 한 줄 메모가 – 줄로 보이지 않습니다.');
      await waitUntil(async()=>await active()===items[0],'첫 포커스가 첫 줄이 아닙니다: '+await active());
      await press('ArrowDown');assert.equal(await active(),items[1]);await press('ArrowUp');assert.equal(await active(),items[0]);
      await press('End');assert.equal(await active(),items[items.length-1]);await press('Home');assert.equal(await active(),items[0]);
      while(await active()!=='task:'+ids[0])await press('ArrowDown');
      await press('Space');
      await waitUntil(async()=>(await task(ids[0])).done,'Space가 할 일을 완료하지 않았습니다.');
      await waitUntil(async()=>await page.locator(`.cf-home-task.done [data-reveal="${ids[0]}"]`).count()===1,'완료한 일이 오늘 칸에 × 줄로 남지 않았습니다.');
      assert.equal(await active(),'task:'+ids[0],'완료 뒤 포커스가 같은 할 일에 머물지 않았습니다.');
      await press('Control+Slash');await page.locator('.help-group.is-current').waitFor();assert.equal(await page.locator('.help-group').first().locator('h3').evaluate(element=>element.firstChild.textContent),'Today','안내의 첫 묶음이 지금 화면이 아닙니다.');await screenshot('09-help-dashboard');await press('Escape');await page.locator('.minimal-help-layer').waitFor({state:'hidden'});
      await press('u');await waitUntil(async()=>!(await task(ids[0])).done,'U가 완료를 되돌리지 않았습니다.');
      await waitFocus(`[data-reveal="${ids[0]}"]`);
      await press('c');await waitUntil(async()=>(await task(ids[0])).cancelled,'C가 취소하지 않았습니다.');
      await waitUntil(async()=>await page.locator(`.cf-home-task.cancelled [data-reveal="${ids[0]}"]`).count()===1,'취소한 일이 줄 그은 채 남지 않았습니다.');
      await press('Space');await waitUntil(async()=>{const t=await task(ids[0]);return !t.done&&!t.cancelled;},'취소한 일에서 Space가 취소를 풀지 않았습니다.');
    });

    await test('저널의 – 메모는 Enter로 메모 편집(상태·마감 없음)을 열고, Space·C는 메모에 아무 일도 하지 않으며, Command 검색으로 찾는다',async()=>{
      const memo=await call('mutate',{type:'task.create',payload:{title:'편집할 메모 '+runId,kind:'note'}});
      await page.evaluate(section=>window.__whendeskGo(section),'inbox');await page.evaluate(section=>window.__whendeskGo(section),'dashboard');
      const row=`.cf-home-task.is-note [data-reveal="${memo.id}"]`;await page.locator(row).waitFor();
      await page.evaluate(selector=>document.querySelector(selector)?.focus(),row);await waitFocus(row);
      await press('Space');await press('c');await page.waitForTimeout(200);
      assert.equal(await page.locator('.task-form').count(),0,'메모 줄의 Space가 편집기를 열었습니다.');
      const after=await task(memo.id);assert.equal(after.done,false);assert.equal(after.cancelled,false);assert.equal(after.title,'편집할 메모 '+runId,'메모 제목이 키 입력으로 바뀌었습니다.');
      await press('Enter');await page.locator('.task-form[aria-label="메모 편집"]').waitFor();
      assert.equal(await page.locator('.task-form [data-field=kind]').count(),0,'메모 편집에 상태 칸이 있습니다.');
      assert.equal(await page.locator('.task-form [data-field=due]').count(),0,'메모 편집에 마감 칸이 있습니다.');
      await screenshot('12-memo-editor');
      await page.locator('.task-form [data-field=title]').fill('고친 메모 '+runId);await press('Enter');
      await waitUntil(async()=>(await task(memo.id)).title==='고친 메모 '+runId,'메모 제목이 저장되지 않았습니다.');
      await press('Escape');await page.locator('.task-form').waitFor({state:'hidden'});
      await waitFocus(`[data-reveal="${memo.id}"]`);
      await press('Control+k');await page.locator('#cf-command-panel').waitFor();
      await page.locator('.td-command input').fill('');await page.keyboard.insertText('고친 메모 '+runId);
      await waitUntil(()=>page.evaluate(id=>[...document.querySelectorAll('[data-result-key],[data-key]')].some(el=>(el.dataset.resultKey||el.dataset.key||'')==='tasks:'+id),memo.id),'Command 검색에 메모가 나오지 않았습니다.');
      await press('Escape');
    });

    await test('마감이 있는 할 일은 오른쪽 달력의 마감 줄과 Today 모두에서 < 다',async()=>{
      const d=new Date(),today=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const due=await call('mutate',{type:'task.create',payload:{title:'오늘 마감 기호 '+runId}});await call('mutate',{type:'task.update',payload:{id:due.id,kind:'todo',due:today}});
      await page.evaluate(section=>window.__whendeskGo(section),'inbox');await page.evaluate(section=>window.__whendeskGo(section),'dashboard');
      const sideMark=page.locator(`.td-calendar-side .td-deadline[data-reveal="${due.id}"] .td-deadline-glyph`);await sideMark.waitFor();
      assert.equal((await sideMark.innerText()).trim(),'<','달력의 마감 줄에서 마감 있는 일이 < 가 아닙니다.');
      const journalMark=page.locator(`.cf-home-task:has([data-reveal="${due.id}"]) .task-mark`);await journalMark.waitFor();
      assert.equal((await journalMark.innerText()).trim(),'<','Today에서 오늘 마감인 일이 < 가 아닙니다.');
    });

    await test('지난 마감: 프로젝트 묶음 안 맨 앞에 붉은 D+n으로 서고, T로 오늘로 넘기면 미룸이 세지고 U로 돌아온다',async()=>{
      const key=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
      const late=await call('mutate',{type:'task.create',payload:{title:'넘길 일 '+runId}});await call('mutate',{type:'task.update',payload:{id:late.id,kind:'todo',due:key(-2)}});
      await call('mutate',{type:'event.create',payload:{title:'저널 일정 '+runId,date:key(0),time:'09:00',end:'10:00',allDay:false}});
      await page.evaluate(section=>window.__whendeskGo(section),'inbox');await page.evaluate(section=>window.__whendeskGo(section),'dashboard');
      const lateRow=`.cf-home-task.is-late [data-reveal="${late.id}"]`;await page.locator(lateRow).waitFor();
      assert.equal(await page.locator(`.cf-home-task:has([data-reveal="${late.id}"]) .work-overdue`).count(),1,'지난 마감에 붉은 D+n이 없습니다.');
      assert.equal(await page.locator('.cf-home-task [data-event]').filter({hasText:'저널 일정 '+runId}).count(),1,'오늘 일정이 ○ 줄로 보이지 않습니다.');
      const firstInGroup=await page.evaluate(id=>{const row=document.querySelector(`.cf-home-task [data-reveal="${id}"]`).closest('.today-group');return row.querySelector('.cf-home-task [data-reveal],.cf-home-task [data-event]')?.dataset.reveal;},late.id);
      assert.equal(firstInGroup,late.id,'지난 마감이 프로젝트 묶음의 맨 앞이 아닙니다.');
      await page.evaluate(selector=>document.querySelector(selector)?.focus(),lateRow);await waitFocus(`[data-reveal="${late.id}"]`);
      await waitUntil(async()=>(await page.locator('.td-hints').innerText()).includes('오늘로'),'지난 마감의 하단 힌트에 오늘로가 없습니다.');
      await screenshot('10-today-late');
      await press('t');
      await waitUntil(async()=>(await task(late.id)).due===key(0),'T가 마감을 오늘로 옮기지 않았습니다.');
      assert.equal((await task(late.id)).postponed,1,'오늘로 넘겼는데 미룸 횟수가 세지지 않았습니다.');
      await waitUntil(async()=>await page.locator(lateRow).count()===0,'넘긴 일이 아직 지난 마감으로 보입니다.');
      assert.equal(await focused(`[data-reveal="${late.id}"]`),true,'넘긴 뒤 포커스가 그 할 일을 따라가지 않았습니다.');
      await screenshot('11-today-moved');
      await press('u');await waitUntil(async()=>{const t=await task(late.id);return t.due===key(-2)&&t.postponed===0;},'U가 마감과 미룸 횟수를 되돌리지 않았습니다.');
      await page.locator(lateRow).waitFor();
    });

    await test('하단 힌트는 포커스 자리에 맞는 키를 보여 준다',async()=>{
      const hints=()=>page.locator('.td-hints').innerText();
      await page.evaluate(()=>window.__whendeskGo('projects'));await page.locator('[data-settings-tab=projects][aria-selected=true]').waitFor();
      await waitUntil(async()=>/보관함/.test(await hints()),'Projects 힌트가 아닙니다.');
      await page.evaluate(section=>window.__whendeskGo(section),'inbox');await waitWithin(`[data-task-row="${inboxTask.id}"]`);
      await waitUntil(async()=>/Space\s*완료/.test(await hints())&&/1 ~ 9\s*프로젝트/.test(await hints()),'할 일 목록 힌트가 아닙니다.');
      await press('Enter');await waitFocus('[data-editor] [data-field=title]');
      await waitUntil(async()=>/저장 · 닫기/.test(await hints())&&/Esc\s*목록/.test(await hints()),'편집기 힌트가 아닙니다.');
      await screenshot('03-hints-editor');
      await press('Escape');await page.evaluate(section=>window.__whendeskGo(section),'notes');await waitFocus('[data-note-search]');
      await waitUntil(async()=>/검색 지우기/.test(await hints()),'메모 검색 힌트가 아닙니다.');
      await press('ArrowDown');await waitWithin('[data-note-list]');
      await waitUntil(async()=>/새 메모/.test(await hints())&&/Tab\s*분류/.test(await hints()),'메모 목록 힌트가 아닙니다.');
      measurements.noteHints=await hints();
    });
  }catch(error){failure=error.stack||String(error);if(page&&!page.isClosed())await screenshot('failure').catch(()=>{});}
  finally{
    try{await closeApp();}catch(error){failure=[failure,error.stack||String(error)].filter(Boolean).join('\n');}
    const report={results,errors,failure,measurements,dataDir,packaged,actualMain:true,screenshots};
    fs.writeFileSync(path.join(output,packaged?'e2e-common-keys-packaged.json':'e2e-common-keys.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(failure||errors.length)process.exitCode=1;
  }
})();
