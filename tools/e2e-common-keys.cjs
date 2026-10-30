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
async function waitWithin(selector){await waitUntil(()=>within(selector),'포커스가 영역 안에 없습니다: '+selector);}
const selectedNote = () => page.locator('[data-note-list] [aria-selected=true]').getAttribute('data-note-row');
const note = async id => (await state()).notes.find(item=>item.id===id);
const task = async id => (await state()).tasks.find(item=>item.id===id);
async function screenshot(name){const file=path.join(shots,name+'.png');await page.screenshot({path:file});screenshots.push(file);}
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
      await press('Alt+n');await waitFocus('[data-note-search]');
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
      await press('e');await waitFocus('[data-note-editor]');
      await press('Escape');await waitWithin('[data-note-list]');
      await press('e');await waitFocus('[data-note-editor]');
      await press('Escape');await waitWithin('[data-note-list]');
      await press('/');await waitFocus('[data-note-search]');
      await press('ArrowDown');await waitWithin('[data-note-list]');
      const count=(await state()).notes.length;
      await press('n');await waitFocus('[data-note-editor]');await page.keyboard.insertText('공통키 새 메모 '+runId);await press('Control+s');
      await waitUntil(async()=>(await state()).notes.length===count+1,'N이 새 메모를 만들지 않았습니다.');
      await press('Escape');await waitWithin('[data-note-list]');
    });

    await test('되돌리기 기록은 화면을 넘나든다: 메모 X 삭제·할 일 완료를 Work의 U로 최근 것부터 되돌린다',async()=>{
      await press('Home');await waitWithin('[data-note-list]');
      const target=await selectedNote();
      await press('x');await waitUntil(async()=>(await note(target))?.deleted===true,'X가 메모를 삭제하지 않았습니다.');
      await press('Alt+i');await waitWithin(`[data-task-row="${inboxTask.id}"]`);
      await press('Space');await waitUntil(async()=>(await task(inboxTask.id)).done===true,'Space가 할 일을 완료하지 않았습니다.');
      await waitWithin('.td-main');
      await press('u');await waitUntil(async()=>(await task(inboxTask.id)).done===false,'첫 U가 가장 최근 작업(완료)을 되돌리지 않았습니다.');
      assert.equal((await note(target)).deleted,true,'첫 U가 더 오래된 메모 삭제까지 되돌렸습니다.');
      await waitWithin('.td-main');
      await press('u');await waitUntil(async()=>(await note(target))?.deleted===false,'두 번째 U가 다른 화면의 메모 삭제를 되돌리지 않았습니다.');
      measurements.crossScreenUndo={task:inboxTask.id,note:target};
    });

    await test('접힌 할 일 행의 Ctrl+Enter는 완료하지 않고, Projects의 A는 보관함 보기·U는 되돌리기다',async()=>{
      await press('Alt+i');await waitWithin(`[data-task-row="${inboxTask.id}"]`);
      await press('Control+Enter');await page.waitForTimeout(400);
      assert.equal((await task(inboxTask.id)).done,false,'접힌 행의 Ctrl+Enter가 할 일을 완료했습니다.');
      for(let step=0;step<4;step++)await press('Tab');
      await waitUntil(async()=>await page.locator('.td-work-nav [role=tab][aria-selected=true]').getAttribute('data-tab')==='projects','Projects 탭으로 가지 않았습니다.');
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
      await press('Alt+i');await waitWithin(`[data-task-row="${inboxTask.id}"]`);
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

    await test('하단 힌트는 포커스 자리에 맞는 키를 보여 준다',async()=>{
      const hints=()=>page.locator('.td-hints').innerText();
      await press('Alt+i');await waitWithin('.td-main');for(let step=0;step<4;step++)await press('Tab');
      await waitUntil(async()=>await page.locator('.td-work-nav [role=tab][aria-selected=true]').getAttribute('data-tab')==='projects','Projects 탭으로 가지 않았습니다.');
      await waitUntil(async()=>/보관함/.test(await hints()),'Projects 힌트가 아닙니다.');
      await press('Alt+i');await waitWithin(`[data-task-row="${inboxTask.id}"]`);
      await waitUntil(async()=>/Space\s*완료/.test(await hints())&&/1 ~ 9\s*프로젝트/.test(await hints()),'할 일 목록 힌트가 아닙니다.');
      await press('Enter');await waitFocus('[data-editor] [data-field=title]');
      await waitUntil(async()=>/접기/.test(await hints())&&/Esc\s*목록/.test(await hints()),'편집기 힌트가 아닙니다.');
      await screenshot('03-hints-editor');
      await press('Escape');await press('Alt+n');await waitFocus('[data-note-search]');
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
