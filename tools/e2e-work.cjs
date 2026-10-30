/* 실제 개발 main·격리된 프로필에서 Work를 키보드로 검증한다.
 * desk API는 fixture 생성과 저장 결과 조회에만 사용한다. 과거 완료 시각은 소유권을 확인한
 * 이번 테스트 프로필 SQLite에서 fixture 행의 done_at만 바꾼다.
 * 사용자 앱·원본 앱·실제 데이터·미디어·OS 전역 단축키는 건드리지 않는다. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron:electron } = require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname,'..');
const runId = String(Date.now());
const output = path.join(root,'test-output');
const dataDir = path.join(output,'work-profile-'+runId);
const shots = path.join(output,'work-shots',runId);
fs.mkdirSync(shots,{recursive:true});
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const tabs = ['inbox','todo','waiting','done','projects'];
const results = [], errors = [], screenshots = [];
const measurements = {inputMethods:['page.keyboard.press','page.keyboard.insertText'],pointerActions:0,fixtureSetup:'desk API; 과거 완료 시각만 소유 확인한 테스트 SQLite에서 설정'};
let app,page,identity,failure=null,fixture={},taskId,projectId,secondProjectId;
const projectName = '키보드프로젝트'+runId;
const secondProjectName = '추가프로젝트'+runId;
const editedProjectName = '프로젝트수정'+runId;
const taskTitle = '키보드 분류 할 일 '+runId;
const editedTaskTitle = '키보드 제목 수정 '+runId;
const waitForName = '응답 담당자 '+runId;
const call = (method,payload) => page.evaluate(({method,payload})=>window.desk.call(method,payload),{method,payload});
const state = () => call('state',{});
const task = async id => (await state()).tasks.find(item=>item.id===id);
const press = key => page.keyboard.press(key);
const text = value => page.keyboard.insertText(value);
async function replaceText(value){await press('Control+a');if(value)await text(value);else await press('Backspace');}
async function waitUntil(predicate,message){const deadline=Date.now()+12000;do{if(await predicate())return;await page.waitForTimeout(35);}while(Date.now()<deadline);assert.fail(message);}
async function focused(selector){return page.evaluate(selector=>!!document.activeElement?.matches(selector),selector);}
async function focusWithin(selector){return page.evaluate(selector=>!!document.activeElement?.closest(selector),selector);}
async function waitFocus(selector){await waitUntil(()=>focused(selector),'키보드 포커스가 도착하지 않았습니다: '+selector);}
async function waitWithin(selector){await waitUntil(()=>focusWithin(selector),'키보드 포커스가 행에 도착하지 않았습니다: '+selector);}
async function tabTo(selector,{reverse=false,limit=24}={}){
  for(let index=0;index<limit;index++){if(await focused(selector))return;await press(reverse?'Shift+Tab':'Tab');}
  const actual=await page.evaluate(()=>document.activeElement?.outerHTML?.slice(0,500));assert.fail('키보드 필드 이동으로 도착하지 못했습니다: '+selector+' / '+actual);
}
async function activeTab(){return page.locator('.td-work-nav [role=tab][aria-selected=true]').getAttribute('data-tab');}
async function expectTab(tab){await waitUntil(async()=>await activeTab()===tab,'Work 탭이 바뀌지 않았습니다: '+tab);}
async function gotoTab(tab){
  assert.ok(tabs.includes(tab),'알 수 없는 Work 탭: '+tab);
  // 초기 fixture InBox 행은 모든 테스트에서 남겨 두므로 확실히 목록 포커스로 진입한다.
  await press('Alt+i'); await expectTab('inbox'); await waitWithin('[data-task-row]');
  for(let step=0;step<tabs.indexOf(tab);step++){
    await press('Tab'); await expectTab(tabs[step+1]);
    await waitUntil(()=>page.evaluate(()=>!!document.activeElement?.closest('[data-task-row],[data-work-project-row],[data-restore-project],[role=tab]')),'Tab 전환 뒤 목록이나 탭에 포커스가 없습니다.');
  }
}
async function focusRow(selector,idAttribute,id){
  const ids = await page.locator(selector).evaluateAll((rows,attribute)=>rows.map(row=>row.getAttribute(attribute)),idAttribute);
  const index = ids.indexOf(String(id));assert.ok(index>=0,'현재 목록에 검증할 행이 없습니다: '+id);
  // 탭의 Home은 ARIA 규칙대로 첫 탭을 고른다. 목록으로 먼저 내려간 뒤 행 Home을 쓴다.
  if(await focusWithin('[role=tab]')){await press('ArrowDown');await waitWithin(selector);}
  await press('Home');await waitWithin(`${selector}[${idAttribute}="${ids[0]}"]`);
  for(let step=1;step<=index;step++){await press('ArrowDown');await waitWithin(`${selector}[${idAttribute}="${ids[step]}"]`);}
}
const focusTask = id => focusRow('[data-task-row]','data-task-row',id);
const focusProject = id => focusRow('[data-work-project-row]','data-work-project-row',id);
async function screenshot(name){const file=path.join(shots,name+'.png');await page.screenshot({path:file});screenshots.push(file);}
async function test(name,action){const start=Date.now();try{await action();results.push({name,ok:true,durationMs:Date.now()-start});}catch(error){results.push({name,ok:false,durationMs:Date.now()-start,error:error.message});throw error;}}
function normalize(value){return String(value).replace(/\\"/g,'"').replace(/"/g,'').replace(/\\/g,'/').toLowerCase();}
async function closeApp(){
  if(!app)return;
  const child=app.process(),spawn=(child?.spawnargs||[]).map(normalize).join(' '),argv=(identity?.argv||[]).map(normalize);
  const owned=(spawn.includes(normalize(root))&&spawn.includes(normalize('--data-dir='+dataDir))) || (child?.pid===identity?.childPid&&identity?.dataDir===dataDir&&argv.includes(normalize('--data-dir='+dataDir))&&normalize(identity?.appPath)===normalize(root));
  let timer;
  try{await Promise.race([(async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__whendeskFlush?.()).catch(()=>{});await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);return true;}).catch(()=>{});await app.close().catch(()=>{});})(),new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);}finally{clearTimeout(timer);}
  const alive=child&&child.exitCode===null&&child.signalCode===null;
  if(alive){if(!owned)throw new Error('이 실행의 격리된 개발 프로세스인지 확인하지 못했습니다.');child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);clearTimeout(timer);}
  measurements.cleanup={owned,forced:!!alive,exitCode:child?.exitCode??null};
}
async function dateAfter(days){return page.evaluate(days=>{const d=new Date();d.setDate(d.getDate()+days);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;},days);}
function setOwnedFixtureDoneDates(entries){
  assert.equal(identity?.dataDir,dataDir);assert.equal(identity?.childPid,app.process()?.pid);
  assert.ok(identity.argv.some(value=>normalize(value)===normalize('--data-dir='+dataDir)),'격리 프로필 인자가 실제 개발 프로세스에 없습니다.');
  const realOutput=fs.realpathSync(output),realProfile=fs.realpathSync(dataDir),workFile=path.join(dataDir,'work','store.sqlite');
  assert.equal(normalize(path.relative(realOutput,realProfile)),normalize('work-profile-'+runId),'현재 실행의 테스트 프로필 밖에는 쓸 수 없습니다.');
  assert.ok(fs.lstatSync(workFile).isFile());assert.equal(fs.lstatSync(workFile).isSymbolicLink(),false);
  assert.equal(normalize(path.relative(realProfile,fs.realpathSync(workFile))),'work/store.sqlite','Work SQLite가 테스트 프로필 바깥을 가리킵니다.');
  const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(workFile);
  try{
    db.exec('PRAGMA busy_timeout=5000');db.exec('BEGIN IMMEDIATE');
    try{
      const find=db.prepare('SELECT id, done_at, deleted_at FROM item WHERE id = ?');
      const update=db.prepare('UPDATE item SET done_at = ? WHERE id = ? AND done_at IS NOT NULL AND deleted_at IS NULL');
      for(const entry of entries){const current=find.get(entry.id);assert.ok(current?.done_at&&!current.deleted_at,'완료 fixture 행만 시각을 바꿀 수 있습니다.');assert.equal(Number(update.run(entry.iso,entry.id).changes),1);}
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }finally{db.close();}
  measurements.doneTimestampOwnership={owned:true,profile:realProfile,relativeFile:'work/store.sqlite',fixtureIds:entries.map(entry=>entry.id)};
}

(async()=>{
  try{
    app=await electron.launch({executablePath:process.env.WHENDESK_TEST_EXECUTABLE||'D:/when630/whencommand/node_modules/electron/dist/electron.exe',args:[root,'--test','--no-media','--data-dir='+dataDir],env,timeout:30000});
    page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>window.desk?.call&&document.querySelector('.td-command input')===document.activeElement);
    identity=await app.evaluate(({app})=>({argv:[...process.argv],mainPid:process.pid,appPath:app.getAppPath()}));identity.childPid=app.process()?.pid;identity.dataDir=(await call('app.info')).dataDir;
    assert.equal(identity.dataDir,dataDir);assert.equal(normalize(identity.appPath),normalize(root));
    const info=await call('app.info');assert.equal(info.isPackaged,false);assert.equal(info.shortcutsEnabled,false);
    const initial=await state();assert.equal(initial.tasks.length,0);assert.equal(initial.projects.length,0);assert.equal(initial.events.length,0);assert.equal(initial.notes.length,0);

    // 원본 앱이 아닌 새 프로필에만 초기 검색·이동 fixture를 만든다.
    const projectA=await call('mutate',{type:'project.create',payload:{name:'검증가'+runId}});
    const projectB=await call('mutate',{type:'project.create',payload:{name:'검증나'+runId}});
    const createFixture=async(title,patch={})=>{
      const item=await call('mutate',{type:'task.create',payload:{title}});
      if(Object.keys(patch).length)await call('mutate',{type:'task.update',payload:{id:item.id,...patch}});
      return item.id;
    };
    fixture={projectA:projectA.id,projectB:projectB.id,projectAName:projectA.name,projectBName:projectB.name};
    fixture.inboxId=await createFixture('고정 인박스 검증 '+runId);
    fixture.todoA=await createFixture('한글 검색 첫째 '+runId,{kind:'todo',project_id:projectA.id,due:await dateAfter(0),note:'본문전용검색 '+runId});
    fixture.todoB=await createFixture('다른 항목 둘째 '+runId,{kind:'todo',project_id:projectB.id});
    fixture.waitingId=await createFixture('대기 복원 검증 '+runId,{kind:'waiting',waitingFor:'기존 상대'});
    fixture.deletedDoneTitle='삭제완료동시복원 '+runId;
    fixture.deletedDoneId=await createFixture(fixture.deletedDoneTitle,{kind:'todo',done:true});
    await call('mutate',{type:'task.delete',payload:{id:fixture.deletedDoneId}});
    measurements.fixture={...fixture};

    await test('Work 하위 분류는 화면 안 탭이며 Tab·ShiftTab으로 순환하고 주 메뉴는 네 개만 표시',async()=>{
      await press('Tab');await page.locator('#cf-dashboard-panel').waitFor();await gotoTab('inbox');
      assert.deepEqual((await page.locator('.td-nav>button').allTextContents()).map(value=>value.trim()),['Dashboard','Work','Note','Calendar']);
      assert.equal(await page.locator('.td-sidebar .td-work-nav').count(),0);
      assert.equal(await page.locator('.td-main>.td-work-nav').count(),1);
      assert.deepEqual(await page.locator('.td-work-nav [role=tab]').evaluateAll(rows=>rows.map(row=>row.dataset.tab)),tabs);
      assert.equal(await page.locator('.td-work-nav [aria-selected=true]').count(),1);
      const placement=await page.evaluate(()=>{const head=document.querySelector('.td-main-head'),nav=document.querySelector('.td-work-nav'),quick=document.querySelector('.td-quick');return {afterHead:!!(head.compareDocumentPosition(nav)&Node.DOCUMENT_POSITION_FOLLOWING),beforeQuick:!!(nav.compareDocumentPosition(quick)&Node.DOCUMENT_POSITION_FOLLOWING)};});
      assert.deepEqual(placement,{afterHead:true,beforeQuick:true});
      for(const next of ['todo','waiting','done','projects','inbox']){await press('Tab');await expectTab(next);}
      await press('Shift+Tab');await expectTab('projects');await press('Tab');await expectTab('inbox');
      measurements.tabOrder=[...tabs,'inbox'];
      await gotoTab('todo');
      const groupOrder=await page.locator('.td-body .work-group[data-work-group]').evaluateAll(groups=>groups.map(group=>group.dataset.workGroup));
      assert.deepEqual(groupOrder,['p'+fixture.projectA,'p'+fixture.projectB],'ToDo 그룹이 원본 프로젝트 순서를 따르지 않습니다.');
      assert.deepEqual(await page.locator('[data-task-row]').evaluateAll(rows=>rows.map(row=>row.dataset.taskRow)),[fixture.todoA,fixture.todoB],'ToDo 그룹의 표시 순서와 행 선택 순서가 어긋납니다.');
      measurements.initialGroupOrder=groupOrder;await screenshot('01-work-tabs');
    });

    await test('Projects에서 CtrlN·N으로 추가하고 E 이름 수정·Shift방향키 순서를 키보드로 저장',async()=>{
      await gotoTab('projects');await press('Control+n');await page.locator('.project-form').waitFor();await waitFocus('.project-form [name=name]');await text(projectName);await press('Control+s');await page.locator('.project-form').waitFor({state:'hidden'});
      await waitUntil(async()=>{projectId=(await state()).projects.find(project=>project.name===projectName)?.id;return !!projectId;},'Ctrl+N 프로젝트가 저장되지 않았습니다.');
      await focusProject(projectId);await press('n');await page.locator('.project-form').waitFor();await waitFocus('.project-form [name=name]');await text(secondProjectName);await press('Enter');await page.locator('.project-form').waitFor({state:'hidden'});
      await waitUntil(async()=>{secondProjectId=(await state()).projects.find(project=>project.name===secondProjectName)?.id;return !!secondProjectId;},'N 프로젝트가 저장되지 않았습니다.');
      await focusProject(secondProjectId);await press('e');await waitFocus('.project-form [name=name]');await replaceText(editedProjectName);await press('Control+s');await page.locator('.project-form').waitFor({state:'hidden'});
      await waitUntil(async()=>(await state()).projects.find(project=>project.id===secondProjectId)?.name===editedProjectName,'프로젝트 이름이 저장되지 않았습니다.');
      await focusProject(secondProjectId);const order=await page.locator('[data-work-project-row]').evaluateAll(rows=>rows.map(row=>row.dataset.workProjectRow));const index=order.indexOf(String(secondProjectId));assert.ok(index>0);
      await press('Shift+ArrowUp');await waitUntil(async()=>{const current=await page.locator('[data-work-project-row]').evaluateAll(rows=>rows.map(row=>row.dataset.workProjectRow));return current.indexOf(String(secondProjectId))===index-1;},'프로젝트 순서를 위로 바꾸지 못했습니다.');await waitWithin(`[data-work-project-row="${secondProjectId}"]`);
      await press('Shift+ArrowDown');await waitUntil(async()=>JSON.stringify(await page.locator('[data-work-project-row]').evaluateAll(rows=>rows.map(row=>row.dataset.workProjectRow)))===JSON.stringify(order),'프로젝트 순서를 아래로 되돌리지 못했습니다.');
      measurements.projectOrder=order;await screenshot('02-work-projects');
    });

    await test('할 일을 InBox에 담고 M 프로젝트 지정으로 ToDo 분류하며 입력중 Tab은 필드만 이동',async()=>{
      await gotoTab('inbox');await press('Control+n');await waitFocus('.td-quick input');await text(taskTitle);await press('Enter');
      await waitUntil(async()=>{taskId=(await state()).tasks.find(item=>item.title===taskTitle)?.id;return !!taskId;},'새 할 일이 InBox에 저장되지 않았습니다.');
      await gotoTab('inbox');await focusTask(taskId);await press('m');await waitFocus('[data-field=project_id]');
      assert.equal(await page.locator('[data-field=project_id] option').last().getAttribute('value'),String(secondProjectId));await press('End');await press('Tab');
      await waitUntil(async()=>{const item=await task(taskId);return item?.project_id===secondProjectId&&item.kind==='todo';},'프로젝트 지정이 InBox를 ToDo로 분류하지 않았습니다.');
      await gotoTab('todo');await focusTask(taskId);await press('e');await waitFocus('[data-field=title]');await replaceText(editedTaskTitle);await press('Control+s');
      await waitUntil(async()=>(await task(taskId))?.title===editedTaskTitle,'제목 편집이 저장되지 않았습니다.');
      await press('Tab');assert.equal(await activeTab(),'todo');assert.equal(await focused('[data-field=title]'),false);assert.equal(await focusWithin('[data-editor]'),true,'편집중 Tab이 입력 필드 밖으로 Work 탭을 전환했습니다.');
      await press('Control+Enter');await page.locator('[data-field=title]').waitFor({state:'hidden'});await waitWithin(`[data-task-row="${taskId}"]`);
    });

    await test('D 마감 입력은 내일·+3·빈값 해제 규칙을 쓰고 CtrlS·Enter 저장 뒤 행 포커스를 복원',async()=>{
      const setDue=async(value,expected,save)=>{
        await press('d');await page.locator('.work-due-form').waitFor();await waitFocus('.work-due-form [name=text]');await replaceText(value);await press(save);await page.locator('.work-due-form').waitFor({state:'hidden'});
        await waitUntil(async()=>(await task(taskId))?.due===expected,'자연어 마감이 저장되지 않았습니다: '+value);await waitWithin(`[data-task-row="${taskId}"]`);assert.equal(await activeTab(),'todo');
      };
      await setDue('내일',await dateAfter(1),'Control+s');await setDue('+3',await dateAfter(3),'Enter');await setDue('','','Enter');await setDue('오늘',await dateAfter(0),'Control+s');
      measurements.due=(await task(taskId)).due;await screenshot('03-work-deadline');
    });

    await test('W 대기 상대를 저장하고 P·R 재촉 중복 방지와 U 연속 되돌림을 원본 규칙으로 처리',async()=>{
      await press('w');await page.locator('.work-waiting-form').waitFor();await waitFocus('.work-waiting-form [name=waitingFor]');await text(waitForName);await press('Control+s');await page.locator('.work-waiting-form').waitFor({state:'hidden'});
      await waitUntil(async()=>{const item=await task(taskId);return item?.kind==='waiting'&&item.waitingFor===waitForName;},'대기 상대와 Waiting 분류가 저장되지 않았습니다.');await expectTab('waiting');await waitWithin(`[data-task-row="${taskId}"]`);
      await press('p');await waitUntil(async()=>(await task(taskId))?.nudgeCount===1,'P 재촉이 기록되지 않았습니다.');const first=await task(taskId);assert.ok(first.nudgedAt);
      await page.waitForTimeout(45);await press('r');await waitUntil(async()=>(await task(taskId))?.nudgedAt!==first.nudgedAt,'R 재촉 기록이 갱신되지 않았습니다.');assert.equal((await task(taskId)).nudgeCount,1,'30분 내 재촉 횟수가 중복 증가했습니다.');
      await press('u');await waitUntil(async()=>{const item=await task(taskId);return item?.nudgedAt===first.nudgedAt&&item.nudgeCount===1;},'최근 재촉을 되돌리지 못했습니다.');
      await press('u');await waitUntil(async()=>{const item=await task(taskId);return item?.nudgedAt===null&&item.nudgeCount===0;},'첫 재촉을 연속으로 되돌리지 못했습니다.');
      assert.equal((await task(taskId)).project_id,secondProjectId);await screenshot('04-work-waiting');
    });

    await test('두 할 일 연속 삭제를 빈 목록에서도 U로 역순 복원',async()=>{
      await gotoTab('waiting');await focusTask(taskId);await press('Delete');await waitUntil(async()=>!(await task(taskId)),'선택한 할 일이 삭제되지 않았습니다.');
      await focusTask(fixture.waitingId);await press('x');await waitUntil(async()=>!(await task(fixture.waitingId)),'X로 두 번째 할 일이 삭제되지 않았습니다.');
      await press('u');await press('u');
      await waitUntil(async()=>!!(await task(fixture.waitingId))&&!!(await task(taskId)),'빠른 연속 U에서 두 삭제를 모두 복원하지 못했습니다.');
    });

    await test('프로젝트 보관은 남은 일을 InBox로 보내며 보관함 Enter 복원이 같은 실행의 항목도 복구',async()=>{
      await gotoTab('projects');await focusProject(secondProjectId);await press('Delete');await page.locator('.work-archive-form').waitFor();await press('Control+s');await page.locator('.work-archive-form').waitFor({state:'hidden'});
      await waitUntil(async()=>!(await state()).projects.some(project=>project.id===secondProjectId),'프로젝트가 보관되지 않았습니다.');
      const moved=await task(taskId);assert.equal(moved.project_id,null);assert.equal(moved.kind,'inbox');
      await press('a');await page.locator(`[data-restore-project="${secondProjectId}"]`).waitFor();await press('Home');await waitWithin(`[data-work-project-row="${secondProjectId}"]`);await press('Enter');
      await waitUntil(async()=>(await state()).projects.some(project=>project.id===secondProjectId),'보관함에서 프로젝트를 복원하지 못했습니다.');
      const restored=await task(taskId);assert.equal(restored.project_id,secondProjectId,'같은 실행에서 보관했던 할 일이 프로젝트로 복귀하지 않았습니다.');assert.equal(restored.kind,'todo');
      await screenshot('05-work-project-restored');
    });

    await test('Work /·CtrlF 검색은 초성·본문·프로젝트·원본 필터를 지원하고 Tab 전환에도 검색어를 유지',async()=>{
      await gotoTab('todo');await press('Slash');await waitFocus('[data-work-search]');await text('ㅎㄱ ㄱㅅ');
      await waitUntil(async()=>{const ids=await page.locator('[data-task-row]').evaluateAll(rows=>rows.map(row=>row.dataset.taskRow));return ids.length===1&&ids[0]===fixture.todoA;},'초성 검색이 제목과 일치하지 않습니다.');
      await press('Enter');await waitWithin(`[data-task-row="${fixture.todoA}"]`);await press('Tab');await expectTab('waiting');assert.equal(await page.locator('[data-work-search]').inputValue(),'ㅎㄱ ㄱㅅ');
      await press('Shift+Tab');await expectTab('todo');await press('Control+f');await waitFocus('[data-work-search]');await replaceText('본문전용검색');
      await waitUntil(async()=>{const ids=await page.locator('[data-task-row]').evaluateAll(rows=>rows.map(row=>row.dataset.taskRow));return ids.length===1&&ids[0]===fixture.todoA;},'상세 내용 검색이 동작하지 않습니다.');
      await replaceText('#'+fixture.projectAName+' 마감있음 이름순');await waitUntil(async()=>{const ids=await page.locator('[data-task-row]').evaluateAll(rows=>rows.map(row=>row.dataset.taskRow));return ids.length===1&&ids[0]===fixture.todoA;},'프로젝트와 원본 검색 필터가 함께 적용되지 않습니다.');
      await press('Escape');await waitUntil(async()=>await page.locator('[data-work-search]').inputValue()==='','Esc로 Work 검색어를 해제하지 못했습니다.');assert.equal(await page.locator('#cf-dashboard-panel').isVisible(),true);await press('Escape');await waitFocus('.td-command input');assert.equal(await page.locator('#cf-dashboard-panel').isVisible(),false);
      await press('Tab');await page.locator('#cf-dashboard-panel').waitFor();await gotoTab('todo');await press('f');await waitUntil(()=>page.locator('[data-due-only]').isChecked(),'F로 마감 필터를 켜지 못했습니다.');assert.equal(await page.locator(`[data-task-row="${fixture.todoB}"]`).count(),0);
      await press('f');await waitUntil(async()=>!await page.locator('[data-due-only]').isChecked(),'F로 마감 필터를 해제하지 못했습니다.');await page.locator(`[data-task-row="${fixture.todoB}"]`).waitFor();await screenshot('06-work-search-and-filter');
    });

    await test('편집 초안·도움말·Command 왕복은 저장 내용과 화면 상태를 보존하고 숫자 키는 프로젝트를 바로 지정하고 U로 되돌림',async()=>{
      await focusTask(taskId);await press('n');await waitFocus('[data-field=note]');await text('Work 상세 초안 '+runId);await press('Control+s');await waitUntil(async()=>(await task(taskId))?.note==='Work 상세 초안 '+runId,'상세 초안이 저장되지 않았습니다.');
      await press('Home');await press('Shift+End');const selection=await page.locator('[data-field=note]').evaluate(element=>[element.selectionStart,element.selectionEnd]);
      await press('Control+Slash');await page.locator('.minimal-help-layer').waitFor();await press('Escape');await page.locator('.minimal-help-layer').waitFor({state:'hidden'});await waitFocus('[data-field=note]');assert.deepEqual(await page.locator('[data-field=note]').evaluate(element=>[element.selectionStart,element.selectionEnd]),selection);
      await press('Control+k');await waitFocus('.td-command input');await press('Tab');await waitFocus('[data-field=note]');assert.equal(await page.locator('[data-field=note]').inputValue(),'Work 상세 초안 '+runId);assert.deepEqual(await page.locator('[data-field=note]').evaluate(element=>[element.selectionStart,element.selectionEnd]),selection);
      await press('Control+Enter');await waitWithin(`[data-task-row="${taskId}"]`);const previous=(await task(taskId)).project_id;
      // 1~9는 활성 프로젝트 목록 순서로 바로 지정하고(원본 WHENWORK), U로 되돌린다.
      const projects=(await state()).projects,target=projects.findIndex(project=>project.id!==previous);assert.ok(target>=0&&target<9);
      await press(String(target+1));await waitUntil(async()=>(await task(taskId)).project_id===projects[target].id,'숫자 키가 프로젝트를 지정하지 않았습니다.');
      await waitUntil(()=>focusWithin('.td-main'),'숫자 지정 뒤 Work 포커스를 잃었습니다.');await press('u');await waitUntil(async()=>(await task(taskId)).project_id===previous,'숫자 지정을 U로 되돌리지 못했습니다.');
      assert.equal(await page.locator('.td-chrome').count(),0);assert.equal(errors.length,0);measurements.finalTask=await task(taskId);await screenshot('07-work-final');
    });

    await test('삭제·완료가 함께 설정된 항목은 Work 목록 밖 검색과 키보드 Enter로 두 상태를 모두 해제',async()=>{
      const before=(await call('state',{includeDeleted:true})).tasks.find(item=>item.id===fixture.deletedDoneId);assert.ok(before?.deleted&&before.done);assert.equal(await task(fixture.deletedDoneId),undefined);
      await gotoTab('todo');await press('Slash');await waitFocus('[data-work-search]');await text(fixture.deletedDoneTitle);
      await page.locator(`.work-archived[data-task-row="${fixture.deletedDoneId}"]`).waitFor();
      assert.deepEqual(await page.locator('[data-task-row]').evaluateAll(rows=>rows.map(row=>row.dataset.taskRow)),[fixture.deletedDoneId]);
      await press('Enter');await waitWithin(`[data-task-row="${fixture.deletedDoneId}"]`);await press('Enter');
      await waitUntil(async()=>{const restored=await task(fixture.deletedDoneId);return restored?.deleted===false&&restored.done===false;},'목록 밖 항목의 삭제·완료 상태를 함께 해제하지 못했습니다.');
      await expectTab('todo');await waitWithin(`[data-task-row="${fixture.deletedDoneId}"]`);assert.equal(await page.locator(`.work-archived[data-task-row="${fixture.deletedDoneId}"]`).count(),0);
      measurements.archiveRevive={id:fixture.deletedDoneId,deleted:false,done:false,kind:(await task(fixture.deletedDoneId)).kind};
      await screenshot('08-work-archive-revived');await press('Escape');await waitUntil(async()=>await page.locator('[data-work-search]').inputValue()==='','복원 후 검색어를 해제하지 못했습니다.');
    });

    await test('Done 기간 7일·30일·전체는 키보드 선택에 따라 과거 완료를 거르고 날짜별 최신 그룹을 표시',async()=>{
      // 앞의 빈 Done→Projects 회귀를 유지하려고 이 검사의 fixture는 여기서 준비한다.
      const dates=await page.evaluate(()=>[1,14,45].map(days=>{const d=new Date();d.setDate(d.getDate()-days);d.setHours(12,0,0,0);return {days,iso:d.toISOString(),key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};}));
      for(const entry of dates)entry.id=await createFixture('완료 기록 '+entry.days+'일 '+runId,{kind:'todo',done:true});
      setOwnedFixtureDoneDates(dates);
      for(const entry of dates)assert.equal((await task(entry.id)).doneAt,entry.iso);
      await gotoTab('done');
      assert.deepEqual(await page.locator('[data-work-range] option').evaluateAll(options=>options.map(option=>option.value)),['7','30','']);
      await focusTask(dates[0].id);await press('Enter');await waitFocus('[data-field=title]');
      // 열린 첫 행의 제목 → 완료 체크박스 → toolbar 기간 순서로 거꾸로 이동한다.
      await tabTo('[data-work-range]',{reverse:true,limit:12});
      const expectHistory=async(expected)=>{
        const expectedIds=expected.map(entry=>entry.id),expectedGroups=expected.map(entry=>entry.key);
        await waitUntil(async()=>JSON.stringify(await page.locator('[data-task-row]').evaluateAll(rows=>rows.map(row=>row.dataset.taskRow)))===JSON.stringify(expectedIds),'Done 기간에 맞는 완료 항목만 표시되지 않습니다.');
        assert.deepEqual(await page.locator('.td-body .work-group[data-work-group]').evaluateAll(groups=>groups.map(group=>group.dataset.workGroup)),expectedGroups,'완료 기록 날짜 그룹이 최신 날짜순이 아닙니다.');
        for(const entry of expected){const group=page.locator(`.work-group[data-work-group="${entry.key}"]`);assert.ok((await group.textContent()).includes(Number(entry.key.slice(5,7))+'/'+Number(entry.key.slice(8))),'날짜 그룹 제목이 원본 날짜 표기와 다릅니다.');}
      };
      await press('Home');await waitUntil(async()=>await page.locator('[data-work-range]').inputValue()==='7','최근 7일 기간을 키보드로 선택하지 못했습니다.');await expectHistory(dates.slice(0,1));
      await press('ArrowDown');await waitUntil(async()=>await page.locator('[data-work-range]').inputValue()==='30','최근 30일 기간을 키보드로 선택하지 못했습니다.');await expectHistory(dates.slice(0,2));
      await press('End');await waitUntil(async()=>await page.locator('[data-work-range]').inputValue()==='','전체 기록 기간을 키보드로 선택하지 못했습니다.');await expectHistory(dates);
      measurements.doneRanges={days:dates.map(entry=>entry.days),seven:dates.slice(0,1).map(entry=>entry.id),thirty:dates.slice(0,2).map(entry=>entry.id),all:dates.map(entry=>entry.id),dateGroups:dates.map(entry=>entry.key)};
      assert.equal(errors.length,0);await screenshot('09-work-done-history');
    });
  }catch(error){failure=error.stack||String(error);if(page&&!page.isClosed())await screenshot('failure').catch(()=>{});}
  finally{
    try{await closeApp();}catch(error){failure=[failure,error.stack||String(error)].filter(Boolean).join('\n');}
    const report={results,errors,failure,measurements,dataDir,packaged:false,actualMain:true,screenshots};
    fs.writeFileSync(path.join(output,'e2e-work.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(failure||errors.length)process.exitCode=1;
  }
})();
