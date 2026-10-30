/* 실제 개발 main에서 모든 조작을 키보드로 수행한다. locator는 조회·assert에만 사용한다. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron:electron } = require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname,'..');
const runId = String(Date.now());
const output = path.join(root,'test-output');
const dataDir = path.join(output,'keyboard-notes-profile-'+runId);
const shots = path.join(output,'keyboard-notes-shots',runId);
const fixtureFile = path.join(shots,'fixture.png');
const exportFile = path.join(shots,'exported-note.md');
fs.mkdirSync(shots,{recursive:true});
const env = {...process.env};delete env.ELECTRON_RUN_AS_NODE;
const results=[],errors=[],measurements={inputMethods:['page.keyboard.press','page.keyboard.insertText'],pointerActions:0};
let app,page,identity,failure=null,taskId,projectId,noteId,trashNoteId,eventId;
const projectName='키보드 프로젝트 '+runId;
const taskTitle='키보드 할 일 '+runId;
const editedTaskTitle='키보드 할 일 수정 '+runId;
const noteTitle='키보드 메모 '+runId;
const noteBody=noteTitle+'\n키보드만 사용해 작성한 본문입니다. #검증\n- [ ] 확인할 내용';
const trashNoteTitle='휴지통 범위 검증 '+runId;
const trashNoteBody=trashNoteTitle+'\n다른 메모로 이동할 때 이 메모의 휴지통 범위를 가져가면 안 됩니다.';
const eventTitle='키보드 일정 '+runId;
const editedEventTitle='키보드 일정 수정 '+runId;
const state=()=>page.evaluate(()=>window.desk.call('state',{}));
const preferences=()=>page.evaluate(()=>window.desk.call('preferences.get'));
const press=key=>page.keyboard.press(key);
const text=value=>page.keyboard.insertText(value);
async function replaceText(value){await press('Control+a');await text(value);}
async function waitUntil(predicate,message){const end=Date.now()+12000;while(Date.now()<end){if(await predicate())return;await page.waitForTimeout(35);}assert.fail(message);}
async function focused(selector){return page.evaluate(selector=>!!document.activeElement?.matches(selector),selector);}
async function waitFocus(selector){await waitUntil(()=>focused(selector),'키보드 포커스가 도착하지 않았습니다: '+selector);}
async function tabTo(selector,{reverse=false,limit=100}={}){
 for(let count=0;count<limit;count++){if(await focused(selector))return;await press(reverse?'Shift+Tab':'Tab');}
 const actual=await page.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label'),html:document.activeElement?.outerHTML?.slice(0,300)}));
 assert.fail('Tab으로 도착할 수 없습니다: '+selector+' / '+JSON.stringify(actual));
}
const sections={home:{key:'h',title:'Dashboard'},todo:{key:'t',title:'Work · ToDo'},inbox:{key:'i',title:'Work · InBox'},waiting:{key:'w',title:'Work · Waiting'},done:{key:'d',title:'Work · Done'},notes:{key:'n',title:'Note'},calendar:{key:'c',title:'Calendar'},settings:{key:'s',title:'Settings'}};
async function section(name){const target=sections[name];assert.ok(target,'알 수 없는 화면: '+name);await press('Alt+'+target.key);await page.locator('.td-main h1').filter({hasText:target.title}).waitFor();await page.locator('#cf-dashboard-panel').waitFor();}
async function screenshot(name){await page.screenshot({path:path.join(shots,name+'.png')});}
async function test(name,action){const started=Date.now();try{await action();results.push({name,ok:true,durationMs:Date.now()-started});}catch(error){results.push({name,ok:false,durationMs:Date.now()-started,error:error.message});throw error;}}
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

(async()=>{
 try{
  app=await electron.launch({executablePath:process.env.WHENDESK_TEST_EXECUTABLE||'D:/when630/whencommand/node_modules/electron/dist/electron.exe',args:[root,'--test','--no-media','--data-dir='+dataDir],env,timeout:30000});
  page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>window.desk?.call&&document.querySelector('.td-command input')===document.activeElement);
  identity=await app.evaluate(({app})=>({argv:[...process.argv],mainPid:process.pid,appPath:app.getAppPath()}));identity.childPid=app.process()?.pid;identity.dataDir=(await page.evaluate(()=>window.desk.call('app.info'))).dataDir;
  assert.equal(identity.dataDir,dataDir);assert.equal(normalize(identity.appPath),normalize(root));

  await test('Command Tab과 Alt 문자로 모든 작업 화면 이동·이전 숫자 화면키 제거',async()=>{
   const info=await page.evaluate(()=>window.desk.call('app.info'));assert.equal(info.isPackaged,false);assert.equal(info.shortcutsEnabled,false);
   const initial=await state();assert.equal(initial.tasks.length,0);assert.equal(initial.notes.length,0);assert.equal(initial.events.length,0);
   await press('Tab');await page.locator('.td-main h1').filter({hasText:'Dashboard'}).waitFor();
   for(const name of ['todo','inbox','waiting','done','notes','calendar','settings','home'])await section(name);
   await press('Alt+6');await page.waitForTimeout(100);assert.equal(await page.locator('.td-main h1').textContent(),'Dashboard','이전 Alt+6 숫자 키가 메모 화면으로 이동했습니다.');
   measurements.sectionKeys=Object.fromEntries(Object.entries(sections).map(([name,target])=>[name,'Alt+'+target.key.toUpperCase()]));
   await screenshot('01-dashboard-keyboard');
  });

  await test('Ctrl Shift N 프로젝트와 Ctrl N 인박스 입력을 키보드로 생성',async()=>{
   await press('Control+Shift+n');await page.locator('.project-form').waitFor();await waitFocus('.project-form [name=name]');await text(projectName);await press('Control+s');await page.locator('.project-form').waitFor({state:'hidden'});
   await waitUntil(async()=>{const project=(await state()).projects.find(project=>project.name===projectName);projectId=project?.id;return !!projectId;},'프로젝트가 저장되지 않았습니다.');
   await press('Control+n');await waitFocus('.td-quick input');await text(taskTitle);await press('Enter');
   await waitUntil(async()=>{const task=(await state()).tasks.find(task=>task.title===taskTitle);taskId=task?.id;return !!taskId;},'할 일이 인박스에 저장되지 않았습니다.');
   await section('inbox');await waitFocus(`article[data-task-row="${taskId}"]`);
  });

  await test('할 일 제목·분류·마감·프로젝트·상세 편집과 완료·삭제·복원을 키보드로 처리',async()=>{
   await press('Enter');await waitFocus('[data-field=title]');await replaceText(editedTaskTitle);
   await tabTo('[data-field=kind]');await press('Home');await press('ArrowDown');await press('Tab');
   await waitUntil(async()=>(await state()).tasks.find(task=>task.id===taskId)?.kind==='todo','키보드 분류가 저장되지 않았습니다.');
   await page.locator('.td-main h1').filter({hasText:'Work · ToDo'}).waitFor();
   await tabTo('[data-field=due]');for(const key of ['ArrowUp','ArrowRight','ArrowUp','ArrowRight','ArrowUp','Tab'])await press(key);
   await waitUntil(async()=>/^\d{4}-\d{2}-\d{2}$/.test((await state()).tasks.find(task=>task.id===taskId)?.due||''),'키보드로 입력한 마감이 저장되지 않았습니다.');
   await tabTo('[data-field=project_id]');await press('End');await press('Tab');
   await waitUntil(async()=>(await state()).tasks.find(task=>task.id===taskId)?.project_id===projectId,'키보드 프로젝트 선택이 저장되지 않았습니다.');
   await tabTo('[data-field=note]');await text('키보드로 입력한 할 일 상세 내용');await press('Control+s');
   await waitUntil(async()=>{const task=(await state()).tasks.find(task=>task.id===taskId);return task?.title===editedTaskTitle&&task.note==='키보드로 입력한 할 일 상세 내용';},'할 일 편집 내용이 저장되지 않았습니다.');
   await press('Control+Enter');await page.locator('[data-field=title]').waitFor({state:'hidden'});await waitFocus(`article[data-task-row="${taskId}"]`);
   await press('Space');await waitUntil(async()=>(await state()).tasks.find(task=>task.id===taskId)?.done===true,'완료되지 않았습니다.');
   await section('done');await waitFocus(`article[data-task-row="${taskId}"]`);await press('Space');
   await waitUntil(async()=>(await state()).tasks.find(task=>task.id===taskId)?.done===false,'완료 해제가 저장되지 않았습니다.');
   await section('todo');await waitFocus(`article[data-task-row="${taskId}"]`);await press('Delete');
   await waitUntil(async()=>!(await state()).tasks.some(task=>task.id===taskId),'할 일이 삭제되지 않았습니다.');
   await press('Control+z');
   await waitUntil(async()=>(await state()).tasks.some(task=>task.id===taskId),'삭제한 할 일을 키보드로 복원하지 못했습니다.');await screenshot('02-task-keyboard');
  });

  await test('메모 작성·저장과 도움말·스킨·모드 왕복에서 본문과 커서를 유지',async()=>{
   await section('notes');await press('Control+n');await waitFocus('[data-note-editor]');await text(noteBody);await press('Control+s');
   await waitUntil(async()=>{const note=(await state()).notes.find(note=>note.title===noteTitle);noteId=note?.id;return note?.body===noteBody;},'메모 본문이 저장되지 않았습니다.');
   await press('Control+Shift+3');await page.waitForTimeout(100);assert.equal(await page.locator('[data-note-scope]').inputValue(),'active','이전 Ctrl+Shift+3 숫자 키가 메모 범위를 바꿨습니다.');await waitFocus('[data-note-editor]');
   const editor=await page.$('[data-note-editor]');
   await press('Control+Home');await press('ArrowRight');await press('ArrowRight');for(let index=0;index<5;index++)await press('Shift+ArrowRight');
   const selection=await editor.evaluate(element=>[element.selectionStart,element.selectionEnd]);assert.deepEqual(selection,[2,7]);
   await press('Control+Slash');await page.locator('.minimal-help-layer').waitFor();await press('Escape');await page.locator('.minimal-help-layer').waitFor({state:'hidden'});
   assert.deepEqual(await editor.evaluate(element=>[element.selectionStart,element.selectionEnd]),selection);
   await section('settings');await tabTo('[data-look=skin]');await press('End');await press('Tab');await waitFocus('[data-look=mode]');await press('End');await press('Tab');
   await waitUntil(async()=>{const prefs=await preferences();return prefs.skin==='paper'&&prefs.mode==='dark';},'키보드 외관 선택이 저장되지 않았습니다.');
   await waitFocus('[data-shortcut=hotkey]');await section('notes');await waitFocus('[data-note-editor]');
   assert.equal(await editor.evaluate(element=>element===document.querySelector('[data-note-editor]')),true);assert.equal(await editor.inputValue(),noteBody);assert.deepEqual(await editor.evaluate(element=>[element.selectionStart,element.selectionEnd]),selection);
   await screenshot('03-note-editor-keyboard');
  });

  await test('메모 검색·고정·보관·휴지통·복원을 키보드로 처리',async()=>{
   await press('Escape');await waitFocus('[data-note-row]');await press('Control+f');await waitFocus('[data-note-search]');await replaceText(noteTitle);
   await page.locator('[data-note-row]').filter({hasText:noteTitle}).waitFor();await press('Control+Enter');await waitFocus('[data-note-editor]');
   await press('Control+p');await waitUntil(async()=>(await state()).notes.find(note=>note.id===noteId)?.pinned===true,'메모 고정이 저장되지 않았습니다.');
   await press('Control+Shift+a');await waitUntil(async()=>(await state()).notes.find(note=>note.id===noteId)?.archived===true,'메모가 보관되지 않았습니다.');
   await press('Control+Shift+b');await page.locator('[data-note-row]').filter({hasText:noteTitle}).waitFor();await waitFocus('[data-note-row]');await press('Delete');
   await waitUntil(async()=>(await state()).notes.find(note=>note.id===noteId)?.deleted===true,'보관 메모가 휴지통으로 이동하지 않았습니다.');
   await press('Control+Shift+t');await page.locator('[data-note-row]').filter({hasText:noteTitle}).waitFor();await waitFocus('[data-note-row]');await press('Control+Shift+z');
   await waitFocus('[data-note-editor]');await waitUntil(async()=>{const note=(await state()).notes.find(note=>note.id===noteId);return note?.deleted===false&&note.archived===true;},'메모를 보관 상태로 복원하지 못했습니다.');
   await press('Control+Shift+a');await waitUntil(async()=>(await state()).notes.find(note=>note.id===noteId)?.archived===false,'보관 해제되지 않았습니다.');
   await press('Control+Shift+m');await page.locator('[data-note-row]').filter({hasText:noteTitle}).waitFor();await press('Control+Enter');await waitFocus('[data-note-editor]');assert.equal(await page.locator('[data-note-editor]').inputValue(),noteBody);
  });

  await test('Command 검색에서 메모를 찾아 Enter로 보기, E로 편집',async()=>{
   await press('Control+k');await waitFocus('.td-command input');await replaceText(noteTitle);
   await page.locator('.td-command-result').filter({hasText:noteTitle}).waitFor();
   const keys=await page.locator('.td-command-result').evaluateAll(elements=>elements.map(element=>element.dataset.resultKey));const index=keys.indexOf('notes:'+noteId);assert.ok(index>=0,'Command 메모 결과가 없습니다.');
   for(let step=0;step<index;step++)await press('ArrowDown');await press('Enter');
   // 검색 결과로 연 메모는 보기 모드로 열리고, E로 편집한다(원본 WHENNOTE).
   await waitFocus('[data-note-preview]');assert.equal(await page.locator('[data-note-editor]').isVisible(),false);
   await press('e');await waitFocus('[data-note-editor]');assert.equal(await page.locator('[data-note-editor]').inputValue(),noteBody);
  });

  await test('휴지통 메모 미리보기에서 Command로 활성 메모를 열면 범위·선택·편집 권한을 복원',async()=>{
   await press('Control+n');await waitFocus('[data-note-editor]');await text(trashNoteBody);await press('Control+s');
   await waitUntil(async()=>{const note=(await state()).notes.find(note=>note.title===trashNoteTitle);trashNoteId=note?.id;return note?.body===trashNoteBody;},'휴지통 범위 검증용 메모 B가 저장되지 않았습니다.');
   await press('Escape');await waitFocus(`[data-note-row="${trashNoteId}"]`);await press('Delete');
   await waitUntil(async()=>(await state()).notes.find(note=>note.id===trashNoteId)?.deleted===true,'메모 B가 휴지통으로 이동하지 않았습니다.');
   await press('Control+Shift+t');await page.locator(`[data-note-row="${trashNoteId}"]`).waitFor();await waitFocus(`[data-note-row="${trashNoteId}"]`);await press('Enter');await waitFocus('[data-note-preview]');
   assert.equal(await page.locator('[data-note-scope]').inputValue(),'trash');assert.ok((await page.locator('[data-note-preview]').textContent()).includes(trashNoteTitle));
   await press('Control+k');await waitFocus('.td-command input');await replaceText(noteTitle);await page.locator('.td-command-result').filter({hasText:noteTitle}).waitFor();
   const keys=await page.locator('.td-command-result').evaluateAll(elements=>elements.map(element=>element.dataset.resultKey));const index=keys.indexOf('notes:'+noteId);assert.ok(index>=0,'활성 메모 A의 Command 결과가 없습니다.');
   for(let step=0;step<index;step++)await press('ArrowDown');await press('Enter');await waitFocus('[data-note-preview]');await press('e');await waitFocus('[data-note-editor]');
   assert.equal(await page.locator('[data-note-scope]').inputValue(),'active');assert.equal(await page.locator('[data-note-list] [aria-selected=true]').getAttribute('data-note-row'),noteId);assert.equal(await page.locator('[data-note-editor]').inputValue(),noteBody);assert.equal(await page.locator('[data-note-editor]').getAttribute('readonly'),null);
   const pinned=(await state()).notes.find(note=>note.id===noteId).pinned;await press('Control+p');
   await waitUntil(async()=>(await state()).notes.find(note=>note.id===noteId)?.pinned===!pinned,'휴지통에서 이동한 뒤 활성 메모 A의 고정 동작이 작동하지 않았습니다.');
   assert.equal((await state()).notes.find(note=>note.id===trashNoteId).deleted,true);measurements.noteScopeTransition={trashNoteId,activeNoteId:noteId,scope:'active',pinToggled:true};await screenshot('03b-trash-to-command-note');
  });

  await test('키보드 이미지 첨부·미리보기·Markdown 내보내기는 OS 효과만 모의 처리',async()=>{
   const fixtureBase64=await app.evaluate(({nativeImage})=>nativeImage.createFromBitmap(Buffer.from([0,0,0,0]),{width:1,height:1}).toPNG().toString('base64'));fs.writeFileSync(fixtureFile,Buffer.from(fixtureBase64,'base64'));
   await app.evaluate(({dialog,shell},{fixtureFile,exportFile})=>{
    globalThis.__keyboardNoteNativeCalls=[];
    dialog.showOpenDialog=async()=>{globalThis.__keyboardNoteNativeCalls.push({type:'open-dialog'});return {canceled:false,filePaths:[fixtureFile]};};
    dialog.showSaveDialog=async()=>{globalThis.__keyboardNoteNativeCalls.push({type:'save-dialog'});return {canceled:false,filePath:exportFile};};
    shell.openPath=async file=>{globalThis.__keyboardNoteNativeCalls.push({type:'open-path',file});return '';};
    shell.openExternal=async url=>{globalThis.__keyboardNoteNativeCalls.push({type:'open-external',url});};
   },{fixtureFile,exportFile});
   await press('Control+End');await press('Control+Shift+i');
   await waitUntil(async()=>(await state()).notes.find(note=>note.id===noteId)?.body.includes('attachments/'),'키보드 이미지 첨부가 본문에 저장되지 않았습니다.');
   const attached=(await state()).notes.find(note=>note.id===noteId).attachments[0].file;measurements.attachment=attached;
   await press('Control+e');await page.locator('[data-note-preview]').waitFor();
   await page.waitForFunction(()=>{const image=document.querySelector('[data-note-preview] img');return image?.src.startsWith('data:image/')&&image.complete&&image.naturalWidth===1;});
   await press('Control+Shift+e');await waitUntil(()=>fs.existsSync(exportFile),'Markdown 내보내기 파일이 없습니다.');
   assert.ok(fs.readFileSync(exportFile,'utf8').includes('attachments/'+attached));assert.deepEqual(fs.readFileSync(path.join(path.dirname(exportFile),'attachments',attached)),fs.readFileSync(fixtureFile));await screenshot('04-note-preview-image');
   await press('Control+e');await waitFocus('[data-note-editor]');
  });

  await test('캘린더 날짜·월 이동과 일정 생성·수정·삭제·복원을 키보드로 처리',async()=>{
   await section('calendar');await waitFocus('.td-body [data-date]');const before=await page.evaluate(()=>document.activeElement.dataset.date);
   await press('ArrowRight');await waitUntil(async()=>await page.evaluate(()=>document.activeElement.dataset.date)!==before,'방향키 날짜 이동이 되지 않았습니다.');
   const moved=await page.evaluate(()=>document.activeElement.dataset.date);await press('PageDown');await waitUntil(async()=>(await page.evaluate(()=>document.activeElement.dataset.date))?.slice(0,7)!==moved.slice(0,7),'PageDown 월 이동이 되지 않았습니다.');
   await press('t');await waitFocus('.td-body [data-date]');// Ctrl+N은 한 줄 입력을 열고, Ctrl+Enter로 자세히 편집한다.
   await press('Control+n');await page.locator('.quick-event-form').waitFor();await press('Control+Enter');await page.locator('.event-form').waitFor();await waitFocus('.event-form [name=title]');await text(eventTitle);await press('Control+s');await page.locator('.event-form').waitFor({state:'hidden'});
   await waitUntil(async()=>{const event=(await state()).events.find(event=>event.title===eventTitle);eventId=event?.id;return !!eventId;},'일정이 저장되지 않았습니다.');
   await section('calendar');await waitFocus('.td-body [data-date]');await press('Enter');await waitFocus('.td-main-calendar-agenda [data-event]');await press('Enter');await waitFocus('.event-form [name=title]');await replaceText(editedEventTitle);await press('Control+s');await page.locator('.event-form').waitFor({state:'hidden'});
   await waitUntil(async()=>(await state()).events.find(event=>event.id===eventId)?.title===editedEventTitle,'일정 수정이 저장되지 않았습니다.');
   await section('calendar');await waitFocus('.td-body [data-date]');await press('Enter');await waitFocus('.td-main-calendar-agenda [data-event]');await press('Delete');
   // 반복 없는 일정은 확인 없이 바로 지우고 되돌리기를 남긴다(원본 WHENCALENDAR X·U).
   await waitUntil(async()=>!(await state()).events.some(event=>event.id===eventId),'일정이 삭제되지 않았습니다.');assert.equal(await page.locator('.event-form').count(),0,'반복 없는 일정 삭제가 대화상자를 열었습니다.');
   await waitUntil(()=>page.evaluate(()=>!!document.activeElement?.closest('.td-main')),'일정을 지운 뒤 캘린더 포커스를 잃었습니다.');await press('u');await waitUntil(async()=>(await state()).events.some(event=>event.id===eventId),'U로 일정 삭제를 되돌리지 못했습니다.');
   await waitFocus('.td-body [data-date]');await press('Enter');await waitFocus('.td-main-calendar-agenda [data-event]');await press('Delete');await waitUntil(async()=>!(await state()).events.some(event=>event.id===eventId),'일정을 다시 삭제하지 못했습니다.');// 캘린더의 Tab은 보기 전환이라 사이드바로 나가지 않는다. Ctrl+Z는 어디서나 공용 되돌리기다.
   await press('Control+z');await waitUntil(async()=>(await state()).events.some(event=>event.id===eventId),'일정 삭제를 키보드로 복원하지 못했습니다.');await screenshot('05-calendar-keyboard');
  });

  await test('최종 데이터·도움말과 Command 복귀 확인',async()=>{
   const final=await state();assert.ok(final.tasks.some(task=>task.id===taskId&&task.title===editedTaskTitle));assert.ok(final.notes.some(note=>note.id===noteId&&note.body.includes('attachments/')));assert.ok(final.events.some(event=>event.id===eventId&&event.title===editedEventTitle));
   assert.equal(final.notes.length,2);assert.equal(final.notes.filter(note=>!note.deleted&&!note.archived).length,1);assert.ok(final.notes.some(note=>note.id===trashNoteId&&note.deleted));
   await press('Control+Slash');await page.locator('.minimal-help-layer').waitFor();assert.ok(await page.locator('.minimal-help-layer kbd').count()>0);assert.deepEqual(await page.locator('.minimal-help-layer kbd').allTextContents().then(keys=>keys.filter(key=>/\d/.test(key)&&key!=='1 ~ 9'/* 원본 WHENWORK 프로젝트 바로 지정만 허용 */)),[],'단축키 안내에 숫자 할당이 남아 있습니다.');await press('Escape');await page.locator('.minimal-help-layer').waitFor({state:'hidden'});await press('Control+k');await waitFocus('.td-command input');
   assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('kbd')].filter(element=>!element.closest('.minimal-help-layer,.td-hints'/* 하단 상황 힌트는 상시 표시 */)&&element.getClientRects().length).map(element=>element.textContent)),[]);assert.deepEqual(errors,[]);
   measurements.final={tasks:final.tasks.length,notes:final.notes.length,activeNotes:final.notes.filter(note=>!note.deleted&&!note.archived).length,trashNotes:final.notes.filter(note=>note.deleted).length,events:final.events.length,projectId,taskId,noteId,trashNoteId,eventId};
  });
 }catch(error){failure=error.stack||String(error);process.exitCode=1;if(page)await screenshot('failure').catch(()=>{});console.error(error);}
 finally{
  try{await closeApp();}catch(error){failure=failure||error.stack||String(error);process.exitCode=1;console.error(error);}
  const report={results,errors,failure,measurements,dataDir,development:true,nativeDialogs:'fixture-paths-only',screenshots:shots};fs.writeFileSync(path.join(output,'e2e-keyboard-notes.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
})();
