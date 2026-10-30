/* 실제 개발 main의 모든 스킨/모드에서 포커스 외곽선과 입력 상태를 검사한다.
 * UI 입력은 Playwright 키보드·focus이며 OS 전역키·미디어 실행은 사용하지 않는다. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {_electron:electron}=require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const runId=String(Date.now());
const output=path.join(root,'test-output');
const dataDir=path.join(output,'focus-flow-profile-'+runId);
const shots=path.join(output,'focus-flow-shots',runId);
fs.mkdirSync(shots,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const results=[],errors=[],screenshots=[],measurements={pointerActions:0,focusMethod:'keyboard modality + locator.focus',matrix:[],checks:[]};
let app,page,identity,failure=null,fixture={};
const call=(method,payload)=>page.evaluate(({method,payload})=>window.desk.call(method,payload),{method,payload});
const press=key=>page.keyboard.press(key);
const state=()=>call('state',{});
async function waitUntil(predicate,message){const end=Date.now()+12000;while(Date.now()<end){if(await predicate())return;await page.waitForTimeout(30);}assert.fail(message);}
async function focused(selector){return page.evaluate(selector=>!!document.activeElement?.matches(selector),selector);}
async function waitFocus(selector){await waitUntil(()=>focused(selector),'포커스가 도착하지 않았습니다: '+selector);}
async function waitTab(tab){await page.locator(`.td-work-nav [data-tab="${tab}"][aria-selected=true]`).waitFor();}
async function waitRowFocus(id){await waitFocus(`[data-task-row="${id}"]`);}
async function currentRow(){return page.evaluate(()=>document.activeElement?.closest('[data-task-row]')?.dataset.taskRow||null);}
async function section(key,selector){await press('Alt+'+key);await page.locator(selector).first().waitFor();}
async function screenshot(name){const file=path.join(shots,name+'.png');await page.screenshot({path:file});screenshots.push(file);}
async function test(name,run){const started=Date.now();try{await run();results.push({name,ok:true,durationMs:Date.now()-started});}catch(error){results.push({name,ok:false,durationMs:Date.now()-started,error:error.message});throw error;}}
function normalize(value){return String(value).replace(/\\"/g,'"').replace(/"/g,'').replace(/\\/g,'/').toLowerCase();}
async function closeApp(){
  if(!app)return;
  const child=app.process(),spawn=(child?.spawnargs||[]).map(normalize).join(' '),argv=(identity?.argv||[]).map(normalize);
  const owned=(spawn.includes(normalize(root))&&spawn.includes(normalize('--data-dir='+dataDir)))||(child?.pid===identity?.childPid&&identity?.dataDir===dataDir&&argv.includes(normalize('--data-dir='+dataDir))&&normalize(identity?.appPath)===normalize(root));
  let timer;
  try{await Promise.race([(async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__whendeskFlush?.()).catch(()=>{});await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);return true;}).catch(()=>{});await app.close().catch(()=>{});})(),new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);}finally{clearTimeout(timer);}
  const alive=child&&child.exitCode===null&&child.signalCode===null;
  if(alive){if(!owned)throw new Error('격리된 테스트 프로세스 소유권을 확인하지 못했습니다.');child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);clearTimeout(timer);}
  measurements.cleanup={owned,forced:!!alive,exitCode:child?.exitCode??null};
}
// 줄·패널 경계로 원래 있던 테두리는 유지하되 포커스 전후 변화는 허용하지 않는다.
async function snapshot(locator){return locator.evaluate(element=>{
  const records=[];
  for(let node=element,depth=0;node&&depth<4;node=node.parentElement,depth++){
    const style=getComputedStyle(node);
    records.push({tag:node.tagName,classes:node.className,outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth,outlineColor:style.outlineColor,shadow:style.boxShadow,borders:['Top','Right','Bottom','Left'].map(side=>[style['border'+side+'Width'],style['border'+side+'Style'],style['border'+side+'Color']]),background:style.backgroundColor});
  }
  return records;
});}
async function probe(selector,label,variant){
  const locator=page.locator(selector).first();await locator.waitFor();
  await page.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();});
  // 실제 키보드 입력 뒤 focus를 옮겨 :focus-visible과 :focus-within 둘 다 측정한다.
  await press('Tab');await page.evaluate(()=>document.body.focus());
  const before=await snapshot(locator);
  await locator.focus();await waitUntil(()=>locator.evaluate(element=>document.activeElement===element),'focus 실패: '+selector);
  const after=await snapshot(locator);
  for(let index=0;index<after.length;index++){
    const current=after[index],prefix=variant+' / '+label+' / depth '+index;
    assert.ok(current.outlineStyle==='none'||parseFloat(current.outlineWidth)===0,prefix+' 포커스 외곽선: '+JSON.stringify(current));
    assert.equal(current.shadow,'none',prefix+' 포커스 그림자가 남아 있습니다.');
    for(let side=0;side<current.borders.length;side++){
      const prior=before[index].borders[side],next=current.borders[side];
      assert.deepEqual(next.slice(0,2),prior.slice(0,2),prefix+' 포커스로 테두리 두께·종류가 바뀌었습니다.');
      // border가 그려지지 않을 때 currentColor 계산값의 변화는 텍스트 강조일 뿐이다.
      const visible=border=>parseFloat(border[0])>0&&!['none','hidden'].includes(border[1]);
      if(visible(prior)||visible(next))assert.equal(next[2],prior[2],prefix+' 포커스로 보이는 테두리 색이 바뀌었습니다.');
    }
  }
  measurements.checks.push({variant,label,selector,focusVisible:await locator.evaluate(element=>element.matches(':focus-visible')),backgroundChanged:after[0].background!==before[0].background});
}
async function changeLook(skin,mode){
  await section('s','[data-look=skin]');
  await page.locator('[data-look=skin]').selectOption(skin);
  await page.locator('[data-look=mode]').selectOption(mode);
  await waitUntil(async()=>{const preferences=await call('preferences.get');return preferences.skin===skin&&preferences.mode===mode;},'외관 설정 저장 실패');
  await page.waitForFunction(({skin,mode})=>{const app=document.querySelector('.td-app');return app.dataset.skin===skin&&app.style.colorScheme===mode;},{skin,mode});
}
async function sendMockMedia(active){
  await app.evaluate(({BrowserWindow},active)=>{
    const win=BrowserWindow.getAllWindows().find(window=>!window.isDestroyed());
    win.webContents.send('media.changed',active?{currentId:'focus-fixture',sessions:[{sourceAppId:'focus-fixture',media:{title:'포커스 검증 미디어'},playback:{playbackStatus:4}}]}:{sessions:[]});
  },active);
}
async function withDelayedTaskSelection(run){
  await app.evaluate(({ipcMain})=>{
    const handler=ipcMain._invokeHandlers?.get('desk:call');
    if(typeof handler!=='function')throw new Error('검증용 IPC 핸들러를 찾지 못했습니다.');
    globalThis.__focusFlowOriginalIPC=handler;
    ipcMain.removeHandler('desk:call');
    ipcMain.handle('desk:call',async(event,method,payload)=>{
      if(method==='mutate'&&payload?.type==='task.update'&&('project_id' in (payload.payload||{})||'kind' in (payload.payload||{})))await new Promise(resolve=>setTimeout(resolve,450));
      return handler(event,method,payload);
    });
  });
  try{return await run();}
  finally{await app.evaluate(({ipcMain})=>{if(globalThis.__focusFlowOriginalIPC){ipcMain.removeHandler('desk:call');ipcMain.handle('desk:call',globalThis.__focusFlowOriginalIPC);delete globalThis.__focusFlowOriginalIPC;}});}
}

(async()=>{
  try{
    app=await electron.launch({executablePath:process.env.WHENDESK_TEST_EXECUTABLE||'D:/when630/whencommand/node_modules/electron/dist/electron.exe',args:[root,'--test','--no-media','--data-dir='+dataDir],env,timeout:30000});
    page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>window.desk?.call&&document.activeElement===document.querySelector('.td-command input'));
    identity=await app.evaluate(({app})=>({argv:[...process.argv],mainPid:process.pid,appPath:app.getAppPath()}));identity.childPid=app.process()?.pid;identity.dataDir=(await call('app.info')).dataDir;
    assert.equal(identity.dataDir,dataDir);assert.equal(normalize(identity.appPath),normalize(root));
    const info=await call('app.info');assert.equal(info.isPackaged,false);assert.equal(info.shortcutsEnabled,false);
    fixture.project=await call('mutate',{type:'project.create',payload:{name:'포커스 프로젝트 '+runId}});
    fixture.inbox=await call('mutate',{type:'task.create',payload:{title:'포커스 인박스 '+runId}});
    fixture.todo=await call('mutate',{type:'task.create',payload:{title:'포커스 할 일 '+runId}});
    await call('mutate',{type:'task.update',payload:{id:fixture.todo.id,kind:'todo',project_id:fixture.project.id,note:'상세 입력을 유지합니다.'}});
    fixture.note=await call('mutate',{type:'note.create',payload:{body:'포커스 메모 '+runId+'\n본문 #검증\n[웹 링크](https://example.com)'}});
    await press('Tab');await page.locator('#cf-dashboard-panel').waitFor();

    await test('프로젝트로 거른 ToDo에서 새 캡처 후 InBox 행으로 이동해 바로 프로젝트·마감을 지정',async()=>{
      await section('t','.td-work-nav');await waitTab('todo');
      await page.locator('[data-work-project-filter]').selectOption(String(fixture.project.id));
      await press('Control+n');await waitFocus('.td-quick input');
      const title='즉시 분류 캡처 '+runId;await page.keyboard.insertText(title);await press('Enter');
      await waitUntil(async()=>{fixture.captured=(await state()).tasks.find(task=>task.title===title);return !!fixture.captured;},'새 캡처가 저장되지 않았습니다.');
      await waitTab('inbox');await waitRowFocus(fixture.captured.id);
      assert.equal(await page.locator('[data-work-project-filter]').inputValue(),'');
      await press('m');await waitFocus('[data-field=project_id]');await press('Escape');await waitRowFocus(fixture.captured.id);
      await press('d');await waitFocus('.work-due-form [name=text]');await press('Escape');await waitRowFocus(fixture.captured.id);
      measurements.captureFlow={id:fixture.captured.id,createdKind:fixture.captured.kind,returnedTab:'inbox',directActions:['M','D']};
    });

    await test('목록 Tab 순환은 빈 분류를 거쳐 Projects 행으로 진입하고 돌아오면 마지막 ToDo 선택을 복원',async()=>{
      fixture.todoSecond=await call('mutate',{type:'task.create',payload:{title:'마지막 선택 할 일 '+runId}});
      await call('mutate',{type:'task.update',payload:{id:fixture.todoSecond.id,kind:'todo',project_id:fixture.project.id}});
      await section('t','.td-work-nav');await waitTab('todo');await page.locator(`[data-task-row="${fixture.todo.id}"]`).focus();await press('End');
      const remembered=await currentRow();assert.ok(remembered,'기억할 ToDo 행 포커스가 없습니다.');
      await press('Tab');await waitTab('waiting');await waitFocus('.td-work-nav [data-tab=waiting]');
      await press('Tab');await waitTab('done');await waitFocus('.td-work-nav [data-tab=done]');
      await press('Tab');await waitTab('projects');await waitFocus('[data-work-project-row]');
      await press('Shift+Tab');await waitTab('done');await press('Shift+Tab');await waitTab('waiting');await press('Shift+Tab');await waitTab('todo');await waitRowFocus(remembered);
      measurements.tabRoundtrip={remembered,restored:await currentRow(),emptyTabs:['waiting','done'],projectsDirect:true};
    });

    await test('Work 검색 Tab은 필터·정렬로 이동하고 Enter·아래 방향키는 검색 결과 목록으로 진입',async()=>{
      await section('t','.td-work-nav');await waitTab('todo');await press('Control+f');await waitFocus('[data-work-search]');await page.keyboard.insertText(fixture.todo.title);
      const visited=[];
      for(let index=0;index<4&&!await focused('[data-work-project-filter]');index++){
        await press('Tab');await waitTab('todo');visited.push(await page.evaluate(()=>document.activeElement?.outerHTML?.slice(0,250)));
      }
      await waitFocus('[data-work-project-filter]');await press('Tab');await waitFocus('[data-work-sort]');await waitTab('todo');
      await page.locator('[data-work-search]').focus();await press('Enter');await waitRowFocus(fixture.todo.id);
      await page.locator('[data-work-search]').focus();await press('ArrowDown');await waitRowFocus(fixture.todo.id);
      await page.locator('[data-work-search]').focus();await press('Escape');
      await waitUntil(async()=>await page.locator('[data-work-search]').inputValue()==='','Work 검색을 해제하지 못했습니다.');
      measurements.searchFieldFlow={tabTargets:visited,enteredRow:fixture.todo.id};
    });

    await test('주 메뉴 Calendar를 Enter로 열면 날짜에 바로 포커스되어 방향키 이동 가능',async()=>{
      await page.locator('.td-nav [data-action=calendar]').focus();await press('Enter');
      await page.locator('.td-body [data-date]').first().waitFor();await waitFocus('.td-body [data-date]');
      const before=await page.evaluate(()=>document.activeElement.dataset.date);await press('ArrowRight');
      await waitUntil(async()=>await page.evaluate(()=>document.activeElement?.dataset.date)!==before,'Calendar 진입 뒤 방향키가 날짜를 옮기지 못했습니다.');
      const after=await page.evaluate(()=>document.activeElement.dataset.date);
      assert.equal((new Date(after+'T12:00:00')-new Date(before+'T12:00:00'))/86400000,1);
      measurements.calendarEntry={before,after};
    });

    await test('상태·프로젝트 저장 응답이 늦어도 사용자가 이동한 다음 입력 필드에 포커스를 유지',async()=>{
      fixture.altProject=await call('mutate',{type:'project.create',payload:{name:'다음 프로젝트 '+runId}});
      fixture.delayTask=await call('mutate',{type:'task.create',payload:{title:'느린 저장 포커스 '+runId}});
      await call('mutate',{type:'task.update',payload:{id:fixture.delayTask.id,kind:'todo',project_id:fixture.project.id}});
      await section('t','.td-work-nav');await waitTab('todo');await page.locator(`[data-task-row="${fixture.delayTask.id}"]`).focus();await press('Enter');await waitFocus('[data-field=title]');
      await withDelayedTaskSelection(async()=>{
        await page.locator('[data-field=project_id]').focus();await press('End');await press('Tab');await waitFocus('[data-field=note]');
        await waitUntil(async()=>(await state()).tasks.find(task=>task.id===fixture.delayTask.id)?.project_id===fixture.altProject.id,'지연된 프로젝트 선택이 저장되지 않았습니다.');
        await page.waitForTimeout(120);await waitFocus('[data-field=note]');
        await page.locator('[data-field=kind]').focus();await press('End');await press('Tab');await waitFocus('[data-field=due]');
        await waitUntil(async()=>(await state()).tasks.find(task=>task.id===fixture.delayTask.id)?.kind==='waiting','지연된 상태 선택이 저장되지 않았습니다.');
        await page.waitForTimeout(120);await waitFocus('[data-field=due]');
      });
      await press('Escape');await call('mutate',{type:'task.update',payload:{id:fixture.delayTask.id,kind:'todo'}});
      measurements.selectionSaveFocus={delayMs:450,projectNextField:'note',kindNextField:'due',restoredSelection:false};
    });

    for(const skin of ['base','ink','paper'])for(const mode of ['light','dark']){
      const variant=skin+'/'+mode;
      await test(variant+' 전 화면 포커스 테두리·그림자 제거',async()=>{
        await changeLook(skin,mode);measurements.matrix.push({skin,mode});
        await probe('[data-look=skin]','스킨 선택',variant);
        await probe('[data-look=mode]','모드 선택',variant);
        await probe('[data-shortcut=hotkey]','단축키 입력',variant);
        await probe('.preferences-form [type=submit]','설정 저장 버튼',variant);
        await probe('.td-nav [data-action=work]','주 메뉴',variant);

        await press('Control+k');await waitFocus('.td-command input');
        await probe('.td-command input','Command 입력',variant);
        await sendMockMedia(true);await page.locator('.td-media button').first().waitFor();
        for(const slot of ['prev','toggle','next'])await probe(`.td-media [data-media-slot=${slot}]`,'미디어 '+slot,variant);
        await sendMockMedia(false);
        await page.locator('.td-command input').focus();await press('Tab');

        await section('i','.td-work-nav');await waitTab('inbox');
        await probe('.td-work-nav [data-tab=inbox]','Work 탭',variant);
        await probe('.td-quick input','빠른 할 일 입력',variant);
        await probe('[data-work-search]','Work 검색',variant);
        await probe('[data-work-project-filter]','프로젝트 필터',variant);
        await probe(`[data-task-row="${fixture.inbox.id}"]`,'할 일 행',variant);
        await page.locator(`[data-task-row="${fixture.inbox.id}"]`).focus();await press('Enter');
        await page.locator('[data-field=title]').waitFor();
        for(const field of ['title','kind','due','project_id','note'])await probe(`[data-field=${field}]`,'할 일 편집 '+field,variant);
        await probe(`[data-check="${fixture.inbox.id}"]`,'할 일 완료 체크',variant);
        await page.locator('[data-field=title]').focus();await press('Control+Enter');
        await page.locator('[data-field=title]').waitFor({state:'hidden'});
        await page.locator(`[data-task-row="${fixture.inbox.id}"]`).focus();await press('d');
        await page.locator('.work-due-form').waitFor();
        await probe('.work-due-form [name=text]','마감 대화상자 입력',variant);
        await probe('.work-due-form [type=submit]','마감 대화상자 저장',variant);await press('Escape');
        await page.locator('.td-work-nav [data-tab=projects]').focus();await press('Enter');await waitTab('projects');
        await probe(`[data-work-project-row="${fixture.project.id}"]`,'프로젝트 행',variant);
        await probe(`[data-edit-project="${fixture.project.id}"]`,'프로젝트 관리 버튼',variant);

        await section('n','[data-note-search]');
        await probe('[data-note-search]','메모 검색',variant);
        await probe('[data-note-scope]','메모 보기',variant);
        await page.locator(`[data-note-row="${fixture.note.id}"]`).waitFor();
        await probe(`[data-note-row="${fixture.note.id}"]`,'메모 목록 행',variant);
        await page.locator(`[data-note-row="${fixture.note.id}"]`).focus();await press('Enter');
        await page.locator('[data-note-editor]').waitFor();
        await probe('[data-note-editor]','메모 본문',variant);
        await probe('[data-note-action=pin]','메모 도구',variant);
        await page.locator('[data-note-editor]').focus();await press('Control+e');
        await page.locator('[data-note-preview]').waitFor();
        await probe('[data-note-preview]','메모 미리보기',variant);
        await probe('[data-note-preview] a','메모 링크',variant);

        await section('c','.td-body [data-date]');
        await probe('.td-body [data-date][tabindex="0"]','캘린더 날짜',variant);
        await press('Control+n');await page.locator('.event-form').waitFor();
        for(const field of ['title','date','time','rrule','note'])await probe(`.event-form [name=${field}]`,'일정 대화상자 '+field,variant);
        await probe('.event-form [type=submit]','일정 저장 버튼',variant);await press('Escape');

        await section('t','.td-work-nav');await waitTab('todo');
        await page.locator(`[data-task-row="${fixture.todo.id}"]`).focus();
        await screenshot('focus-'+skin+'-'+mode);
      });
    }
    assert.deepEqual(errors,[]);
  }catch(error){failure=error.stack||String(error);if(page&&!page.isClosed())await screenshot('failure').catch(()=>{});}
  finally{
    try{await closeApp();}catch(error){failure=[failure,error.stack||String(error)].filter(Boolean).join('\n');}
    const report={results,errors,failure,measurements,dataDir,actualMain:true,packaged:false,screenshots};
    fs.writeFileSync(path.join(output,'e2e-focus-flow.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({...report,measurements:{...measurements,checks:measurements.checks.length}}));
    if(failure||errors.length)process.exitCode=1;
  }
})();
