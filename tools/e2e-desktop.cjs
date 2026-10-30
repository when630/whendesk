const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {_electron:electron}=require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const dataDir=path.join(root,'test-output','e2e-profile-'+Date.now());
const shots=path.join(root,'test-output','desktop-shots');fs.mkdirSync(shots,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const results=[],errors=[];
let app,page,clipboardSnapshot;
const packaged=process.env.WHENDESK_TEST_PACKAGED==='1';
const mockClipboard=process.env.WHENDESK_TEST_MOCK_CLIPBOARD==='1';
async function launch(){
 app=await electron.launch({executablePath:process.env.WHENDESK_TEST_EXECUTABLE||'D:/when630/whencommand/node_modules/electron/dist/electron.exe',args:[...(packaged?[]:[root]),'--test','--no-media','--data-dir='+dataDir],env,timeout:30000});
 page=await app.firstWindow();page.setDefaultTimeout(12000);
 if(mockClipboard)await app.evaluate(({clipboard})=>{let value='';clipboard.writeText=text=>{value=String(text);};clipboard.readText=()=>value;});
 page.on('pageerror',error=>errors.push(error.message));
 await page.waitForFunction(()=>window.desk&&document.querySelector('.cf-entry-name')?.textContent==='WHENCOMMAND');
 await page.waitForFunction(()=>document.querySelector('.td-command input')===document.activeElement);
}
async function call(method,payload){return page.evaluate(async({method,payload})=>window.desk.call(method,payload),{method,payload});}
async function test(name,fn){await fn();results.push({name,ok:true});}
(async()=>{
 try{
  await launch();
  if(!mockClipboard)clipboardSnapshot=await app.evaluate(({clipboard})=>({text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF(),image:clipboard.readImage().toPNG().toString('base64')}));
  await test('빈 DB·실제 preload·Command 기본 진입',async()=>{
   const state=await call('state',{});assert.equal(state.tasks.length,0);assert.equal(state.events.length,0);
   assert.equal(await page.locator('#cf-dashboard-panel').isVisible(),false);
   assert.equal(await page.locator('[role=tab]:visible').count(),0);
   const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());assert.equal(bounds.width,560);
   await page.waitForTimeout(200);const compact=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());assert.equal(compact.height,54,'빈 Command는 WHENCOMMAND와 같은 54px 높이여야 합니다.');
  });
  await test('Tab native확장·Esc 축소 및 검색어 선택복원',async()=>{
   const input=page.locator('.td-command input');await input.fill('123+456');await page.waitForFunction(()=>document.querySelector('.td-command-results')?.textContent.includes('579'));
   await input.evaluate(el=>el.setSelectionRange(1,4));await input.press('Tab');await page.locator('.td-main h1').filter({hasText:'Dashboard'}).waitFor();
   const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());assert.ok(bounds.width>=800);
   await page.keyboard.press('Escape');assert.equal(await input.inputValue(),'123+456');assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd]),[1,4]);
   const small=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());assert.equal(small.width,560);
  });
  await test(mockClipboard?'실제 Command 계산과 격리 클립보드':'실제 Command 계산과 클립보드',async()=>{
   const input=page.locator('.td-command input');await input.fill('123+456');await input.press('Enter');
   let copied='';for(let attempt=0;attempt<20;attempt++){copied=await app.evaluate(({clipboard})=>clipboard.readText());if(copied.includes('579'))break;await page.waitForTimeout(100);}assert.ok(copied.includes('579'),'계산 결과 클립보드: '+copied);
  });
  let taskId,projectId;
  await test('실제 인박스 생성·할 일 분류·프로젝트',async()=>{
   await page.locator('.td-command input').press('Tab');await page.locator('.td-nav > [data-action=work]').click();await page.locator('.td-main > .td-work-nav [data-tab=inbox]').click();
   await page.locator('.td-quick input').fill('E2E 실제 할 일');await page.locator('.td-quick input').press('Enter');
   await page.locator('.td-task-open').filter({hasText:'E2E 실제 할 일'}).waitFor();await page.locator('.td-task-open').filter({hasText:'E2E 실제 할 일'}).click();
   await page.locator('[data-field=kind]').selectOption('todo');await page.waitForTimeout(200);
   const project=await call('mutate',{type:'project.create',payload:{name:'E2E 프로젝트'}});projectId=project.id??project;
   await page.waitForTimeout(200);const task=(await call('state',{})).tasks.find(t=>t.title==='E2E 실제 할 일');taskId=task.id;
   await page.locator('[data-field=project_id]').selectOption(String(projectId));
   await page.locator('[data-field=note]').fill('다시 실행해도 남는 실제 상세 내용');
   await page.locator('[data-field=title]').fill('E2E 저장 확인');
   await page.waitForTimeout(800);const saved=(await call('state',{})).tasks.find(t=>t.id===taskId);assert.equal(saved.title,'E2E 저장 확인');assert.equal(saved.note,'다시 실행해도 남는 실제 상세 내용');assert.equal(saved.project_id,projectId);
  });
  await test('Command왕복 커서·설정 외관 변경에서 내용 유지',async()=>{
   const note=page.locator('[data-field=note]');await note.evaluate(el=>{window.__editor=el;el.focus();el.setSelectionRange(2,7);});
   await note.press('Control+k');await page.locator('.td-command input').press('Tab');
   assert.equal(await note.evaluate(el=>el===window.__editor),true);assert.deepEqual(await note.evaluate(el=>[el.selectionStart,el.selectionEnd]),[2,7]);
   await page.locator('[data-field=title]').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('#cf-dashboard-panel').isVisible(),true);
   await page.keyboard.press('Alt+s');await page.locator('[data-look=skin]').selectOption('paper');await page.locator('[data-look=mode]').selectOption('dark');
   await page.locator('.td-nav > [data-action=work]').click();await page.locator('.td-main > .td-work-nav [data-tab=todo]').click();await page.locator('[data-task]').filter({hasText:'E2E 저장 확인'}).click();
   assert.equal(await note.inputValue(),'다시 실행해도 남는 실제 상세 내용');
  });
  let eventId;
  await test('실제 Calendar 생성·수정·삭제·복원',async()=>{
   await page.locator('.td-nav [data-action=calendar]').click();await page.locator('.td-main-head [data-action=new-event]').click();
   await page.locator('.event-form [name=title]').fill('E2E 개인 일정');await page.locator('.event-form [type=submit]').click();
   await page.locator('.event-form').waitFor({state:'hidden'});let state=await call('state',{});let event=state.events.find(e=>e.title==='E2E 개인 일정');assert.ok(event);eventId=event.id;
   await page.locator('.td-main-calendar-agenda [data-event]').filter({hasText:'E2E 개인 일정'}).click();await page.locator('.event-form [name=title]').fill('E2E 일정 수정');await page.locator('.event-form [type=submit]').click();await page.locator('.event-form').waitFor({state:'hidden'});
   event=(await call('state',{})).events.find(e=>e.id===eventId);assert.equal(event.title,'E2E 일정 수정');
   await page.locator('.td-main-calendar-agenda [data-event]').filter({hasText:'E2E 일정 수정'}).click();await page.locator('[data-action=delete-event]').click();await page.locator('.event-form').waitFor({state:'hidden'});assert.equal((await call('state',{})).events.some(e=>e.id===eventId),false);
   await page.locator('[data-action=undo]').click();await page.waitForTimeout(200);assert.ok((await call('state',{})).events.some(e=>e.id===eventId));
  });
  await test('설정 IPC와 실제 검색 결과',async()=>{
   await page.locator('.td-sidebar-bottom [data-action=settings]').click();await page.locator('[aria-label="Command 단축키"]').waitFor();assert.ok((await page.locator('.settings-path').textContent()).includes('e2e-profile'));
   const prefs=await call('preferences.get');assert.equal(prefs.skin,'paper');assert.equal(prefs.mode,'dark');
   await page.waitForFunction(async()=>{const info=await window.desk.call('app.info');return info.commandReady||info.commandFailure;},null,{timeout:30000});
   const query=await call('command.query',{q:'계산기',seq:100});assert.ok(Array.isArray(query.items));assert.ok(query.items.some(i=>i.source==='apps'),query.notice||'설치된 계산기 앱 검색 결과 없음');
  });
  await page.screenshot({path:path.join(shots,'dashboard.png')});
  await test('재시작 이후 실제 데이터와 외관 지속',async()=>{
   await app.close();await launch();const state=await call('state',{});const task=state.tasks.find(t=>t.id===taskId);assert.equal(task.title,'E2E 저장 확인');assert.equal(task.note,'다시 실행해도 남는 실제 상세 내용');assert.equal(task.project_id,projectId);assert.ok(state.events.some(e=>e.id===eventId));
   const prefs=await call('preferences.get');assert.equal(prefs.skin,'paper');assert.equal(prefs.mode,'dark');assert.equal(await page.locator('#cf-dashboard-panel').isVisible(),false);
  });
  await page.screenshot({path:path.join(shots,'command.png')});
  assert.deepEqual(errors,[]);
  const info=await call('app.info');if(packaged)assert.equal(info.isPackaged,true);
  const report={results,errors,dataDir,packaged,clipboard:mockClipboard?'isolated-mock':'system'};fs.writeFileSync(path.join(root,'test-output',packaged?'e2e-packaged.json':'e2e-desktop.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){if(page)await page.screenshot({path:path.join(shots,'failure.png')}).catch(()=>{});console.error(error);console.log(JSON.stringify({results,errors,dataDir}));process.exitCode=1;}finally{if(app){if(clipboardSnapshot)await app.evaluate(({clipboard,nativeImage},snapshot)=>{const data={text:snapshot.text,html:snapshot.html,rtf:snapshot.rtf};if(snapshot.image)data.image=nativeImage.createFromBuffer(Buffer.from(snapshot.image,'base64'));clipboard.write(data);},clipboardSnapshot).catch(()=>{});await app.close().catch(()=>{});}}
})();
