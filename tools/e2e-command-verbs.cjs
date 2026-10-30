/* 키보드 재설계 3a 검증: Command에서 찾은 할 일·일정을 화면을 열지 않고 다루고, 일정 추가는 해석을 미리 보여 주며,
 * 전역 담기 단축키의 수집 모드는 Enter로 담아도 남아 연달아 담는다. 캘린더는 N 한 줄 입력과 오늘·주·월 보기를 쓴다.
 * 테스트 모드는 OS 전역 단축키를 등록하지 않으므로, 메인이 단축키에서 보내는 것과 같은 navigate 신호를 직접 보낸다.
 * 실제 개발 main·격리된 프로필에서 키보드 입력만 사용한다. fixture는 desk API로 만든다. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron:electron } = require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname,'..');
const runId = String(Date.now());
const output = path.join(root,'test-output');
const dataDir = path.join(output,'command-verbs-profile-'+runId);
const shots = path.join(output,'command-verbs-shots',runId);
fs.mkdirSync(shots,{recursive:true});
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const results = [], errors = [], screenshots = [], measurements = {inputMethods:['page.keyboard.press','page.keyboard.insertText'],pointerActions:0};
let app,page,identity,failure=null;
const call = (method,payload) => page.evaluate(({method,payload})=>window.desk.call(method,payload),{method,payload});
const state = () => call('state',{});
const press = key => page.keyboard.press(key);
const text = value => page.keyboard.insertText(value);
async function waitUntil(predicate,message){const deadline=Date.now()+12000;do{if(await predicate())return;await page.waitForTimeout(35);}while(Date.now()<deadline);assert.fail(message);}
const focused = selector => page.evaluate(selector=>!!document.activeElement?.matches(selector),selector);
const within = selector => page.evaluate(selector=>!!document.activeElement?.closest(selector),selector);
async function waitFocus(selector){await waitUntil(()=>focused(selector),'포커스가 도착하지 않았습니다: '+selector);}
async function waitWithin(selector){await waitUntil(()=>within(selector),'포커스가 영역 안에 없습니다: '+selector);}
const task = async id => (await state()).tasks.find(item=>item.id===id);
const commandInput = '.td-command input';
const windowVisible = () => app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible());
const signal = payload => app.evaluate(({BrowserWindow},payload)=>{const win=BrowserWindow.getAllWindows()[0];win.show();win.focus();win.webContents.send('navigate',payload);},payload);
async function commandQuery(value,expect){await page.locator(commandInput).fill('');await text(value);await waitUntil(async()=>page.evaluate(expect=>!document.querySelector('#cf-command-panel').hasAttribute('aria-busy')&&[...document.querySelectorAll('.td-command-results [data-result]')].some(row=>row.textContent.includes(expect)),expect),'Command 검색 결과가 나오지 않았습니다: '+value);}
async function selectResult(expect){
  const keys=await page.locator('.td-command-results [data-result]').evaluateAll((rows,expect)=>rows.map(row=>row.textContent.includes(expect)),expect);
  const index=keys.indexOf(true);assert.ok(index>=0,'선택할 결과가 없습니다: '+expect);
  for(let step=0;step<index;step++)await press('ArrowDown');
  return index;
}
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

(async()=>{
  try{
    app=await electron.launch({executablePath:process.env.WHENDESK_TEST_EXECUTABLE||'D:/when630/whencommand/node_modules/electron/dist/electron.exe',args:[root,'--test','--no-media','--data-dir='+dataDir],env,timeout:30000});
    page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>window.desk?.call&&document.querySelector('.td-command input')===document.activeElement);
    identity=await app.evaluate(({app})=>({argv:[...process.argv],mainPid:process.pid,appPath:app.getAppPath()}));identity.childPid=app.process()?.pid;identity.dataDir=(await call('app.info')).dataDir;
    assert.equal(identity.dataDir,dataDir);assert.equal(normalize(identity.appPath),normalize(root));
    const initial=await state();assert.equal(initial.tasks.length+initial.notes.length+initial.events.length,0);
    const target=await call('mutate',{type:'task.create',payload:{title:'커맨드동사 '+runId}});

    await test('Command에서 찾은 할 일은 Ctrl+Enter로 완료하고 동작 목록으로 내일 마감을 정하며, 화면의 U로 되돌린다',async()=>{
      await commandQuery('커맨드동사 '+runId,'커맨드동사 '+runId);await selectResult('커맨드동사 '+runId);
      await press('Control+Enter');await waitUntil(async()=>(await task(target.id)).done===true,'Ctrl+Enter가 할 일을 완료하지 않았습니다.');
      assert.equal(await page.locator('#cf-command-panel').isVisible(),true,'완료하면서 Command를 떠났습니다.');
      await waitUntil(async()=>await page.locator(commandInput).inputValue()==='','완료 뒤 입력이 비워지지 않았습니다.');
      assert.match(await page.locator(commandInput).getAttribute('placeholder'),/완료했습니다/);
      await commandQuery('커맨드동사 '+runId,'커맨드동사 '+runId);await selectResult('커맨드동사 '+runId);
      await press('Alt+Enter');await page.locator('#command-actions').waitFor();
      const labels=await page.locator('#command-actions [data-command-action]').evaluateAll(rows=>rows.map(row=>row.dataset.commandAction));
      assert.deepEqual(labels,['open','complete','delete'],'완료된 할 일의 동작 목록이 다릅니다.');
      await press('ArrowDown');await press('Enter');await waitUntil(async()=>(await task(target.id)).done===false,'동작 목록의 완료 해제가 실행되지 않았습니다.');
      await commandQuery('커맨드동사 '+runId,'커맨드동사 '+runId);await selectResult('커맨드동사 '+runId);
      await press('Alt+Enter');await page.locator('#command-actions').waitFor();
      const open=await page.locator('#command-actions [data-command-action]').evaluateAll(rows=>rows.map(row=>row.dataset.commandAction));
      assert.deepEqual(open,['open','complete','due-today','due-tomorrow','delete']);
      for(let step=0;step<open.indexOf('due-tomorrow');step++)await press('ArrowDown');
      await press('Enter');await waitUntil(async()=>!!(await task(target.id)).due,'내일 마감이 저장되지 않았습니다.');
      measurements.dueFromCommand=(await task(target.id)).due;
      await press('Tab');await page.locator('#cf-dashboard-panel').waitFor();await press('Alt+i');await waitWithin('.td-main');
      await press('u');await waitUntil(async()=>!(await task(target.id)).due,'Command에서 정한 마감을 화면의 U로 되돌리지 못했습니다.');
      await press('Control+k');await page.locator('#cf-command-panel').waitFor();
    });

    await test('Command 일정 추가는 해석 결과를 미리 보여 주고 Enter로 추가한 뒤 머물며, Ctrl+Enter는 캘린더에서 그 일정에 포커스를 둔다',async()=>{
      const title='치과 '+runId;
      await commandQuery('일정 추가 내일 오후 3시 '+title,title);
      const subtitle=await page.locator('.td-command-results [data-result-key="capture:event"]').innerText();
      measurements.eventPreview=subtitle;assert.match(subtitle,/오후 3:00/,'추가 전에 시각 해석을 보여 주지 않았습니다: '+subtitle);
      await screenshot('01-event-preview');
      await press('Enter');await waitUntil(async()=>(await state()).events.some(event=>event.title===title),'일정이 추가되지 않았습니다.');
      assert.equal(await page.locator('#cf-command-panel').isVisible(),true,'일정 추가가 Command를 떠났습니다.');
      await waitUntil(async()=>await page.locator(commandInput).inputValue()==='','일정 추가 뒤 입력이 비워지지 않았습니다.');
      const second='검진 '+runId;
      await commandQuery('일정 추가 모레 오전 10시 '+second,second);await press('Control+Enter');
      await page.locator('#cf-dashboard-panel').waitFor();
      await waitUntil(()=>page.evaluate(second=>document.activeElement?.matches('[data-event]')&&document.activeElement.textContent.includes(second),second),'Ctrl+Enter가 캘린더에서 새 일정에 포커스를 두지 않았습니다.');
      await press('Control+k');await page.locator('#cf-command-panel').waitFor();
    });

    await test('할 일 담기 모드는 검색하지 않고 Enter로 연달아 담으며, Esc는 입력을 지운 뒤 창을 숨긴다',async()=>{
      await signal({shell:'command',capture:'task'});
      await waitUntil(async()=>await page.locator(commandInput).getAttribute('placeholder')==='InBox에 담기','할 일 담기 모드로 열리지 않았습니다.');
      const before=(await state()).tasks.length;
      for(const name of ['하나','둘']){await text(`담기 ${name} ${runId}`);await press('Enter');await waitUntil(async()=>(await state()).tasks.some(item=>item.title===`담기 ${name} ${runId}`),'담기 모드에서 할 일이 저장되지 않았습니다.');await waitUntil(async()=>await page.locator(commandInput).inputValue()==='','담은 뒤 입력이 비워지지 않았습니다.');}
      assert.equal((await state()).tasks.length,before+2);
      assert.equal(await page.locator('.td-command-results [data-result]').count(),0,'담기 모드에서 검색 결과를 보였습니다.');
      await screenshot('02-capture-task');
      await text('지울 글');await press('Escape');await waitUntil(async()=>await page.locator(commandInput).inputValue()==='','Esc가 입력을 지우지 않았습니다.');
      assert.equal(await windowVisible(),true);
      await press('Escape');await waitUntil(async()=>!await windowVisible(),'빈 담기 모드의 Esc가 창을 숨기지 않았습니다.');
    });

    await test('메모 담기 모드는 Enter로 메모를 만들고, Tab은 메모 화면을 연다',async()=>{
      await signal({shell:'command',capture:'note'});
      await waitUntil(async()=>await page.locator(commandInput).getAttribute('placeholder')==='메모 담기','메모 담기 모드로 열리지 않았습니다.');
      await text('담은 메모 '+runId);await press('Enter');
      await waitUntil(async()=>(await state()).notes.some(item=>item.title==='담은 메모 '+runId),'메모가 저장되지 않았습니다.');
      await press('Tab');await page.locator('#cf-dashboard-panel').waitFor();await waitWithin('.desk-notes-browser');
      await signal({shell:'command'});await waitUntil(async()=>await page.locator(commandInput).getAttribute('placeholder')==='검색 또는 실행','일반 Command 단축키가 검색 모드로 돌아가지 않았습니다.');
      assert.equal(errors.length,0,errors.join('\n'));
    });

    await test('캘린더는 Tab으로 오늘·주·월을 순환하고, N 한 줄 입력은 해석을 미리 보여 주며 Enter로 추가·Ctrl+Enter로 자세히 편집한다',async()=>{
      const view=()=>page.locator('.cal-views [aria-selected=true]').getAttribute('data-cal-view');
      await press('Control+k');await page.locator('#cf-command-panel').waitFor();await press('Tab');await page.locator('#cf-dashboard-panel').waitFor();
      await press('Alt+c');await waitFocus('.td-main [data-date]');assert.equal(await view(),'month');
      await press('Tab');await waitUntil(async()=>await view()==='today','Tab이 오늘 보기로 가지 않았습니다.');
      await waitUntil(()=>within('.cal-list'),'오늘 보기의 기본 자리에 포커스가 없습니다.');
      // 앞 시나리오에서 모레 일정을 열어 선택 날짜가 옮겨져 있다. T로 오늘에 맞춘다.
      await press('t');await waitUntil(async()=>await page.locator('.cal-list [data-cal-day]').getAttribute('data-cal-day')===await page.evaluate(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}),'T가 오늘로 가지 않았습니다.');
      await waitUntil(()=>within('.cal-list'),'T 뒤 목록 포커스를 잃었습니다.');
      await press('ArrowRight');await waitUntil(()=>page.evaluate(()=>document.activeElement?.matches('[data-event]')&&document.activeElement.textContent.includes('치과')),'→가 다음 날 일정으로 가지 않았습니다.');
      await press('Tab');await waitUntil(async()=>await view()==='week','Tab이 주 보기로 가지 않았습니다.');
      const week=await page.locator('.cal-list [data-event]').allTextContents();
      assert.ok(week.some(item=>item.includes('치과'))&&week.some(item=>item.includes('검진')),'주 보기에 이번 주 일정이 모두 보이지 않습니다.');
      await waitFocus('[data-event]');const before=await page.evaluate(()=>document.activeElement.dataset.event);
      await press('j');await waitUntil(()=>page.evaluate(before=>document.activeElement?.matches('[data-event]')&&document.activeElement.dataset.event!==before,before),'J가 다음 일정으로 가지 않았습니다.');
      await screenshot('03-calendar-week');
      const title='정비 '+runId;
      await press('n');await page.locator('.quick-event-form').waitFor();await waitFocus('.quick-event-form [name=line]');
      await text('다음 주 월요일 오전 9시 '+title);
      await waitUntil(async()=>/오전 9:00/.test(await page.locator('.quick-event-preview').innerText()),'한 줄 입력이 해석을 미리 보여 주지 않았습니다.');
      measurements.quickPreview=await page.locator('.quick-event-preview').innerText();await screenshot('04-quick-event');
      await press('Enter');await page.locator('.quick-event-form').waitFor({state:'hidden'});
      await waitUntil(async()=>(await state()).events.some(event=>event.title===title),'한 줄 입력이 일정을 추가하지 않았습니다.');
      await waitUntil(()=>page.evaluate(title=>document.activeElement?.matches('[data-event]')&&document.activeElement.textContent.includes(title),title),'추가한 일정에 포커스가 가지 않았습니다.');
      await press('n');await page.locator('.quick-event-form').waitFor();await text('모레 오후 2시 회의 '+runId);
      await press('Control+Enter');await page.locator('.event-form').waitFor();
      assert.match(await page.locator('.event-form [name=title]').inputValue(),/회의/,'자세히 편집에 해석한 제목이 없습니다.');
      await press('Escape');await page.locator('.event-form').waitFor({state:'hidden'});
      assert.equal((await state()).events.some(event=>event.title==='회의 '+runId),false,'자세히 편집을 닫았는데 일정이 저장됐습니다.');
      await press('Shift+Tab');await waitUntil(async()=>await view()==='today','Shift+Tab이 이전 보기로 가지 않았습니다.');
      await press('Tab');await press('Tab');await waitUntil(async()=>await view()==='month','월 보기로 돌아오지 않았습니다.');await waitFocus('.td-main [data-date]');
    });

    await test('Command에서 캘린더 구독 관리를 연다',async()=>{
      await press('Control+k');await page.locator('#cf-command-panel').waitFor();
      await commandQuery('구독 관리','캘린더 구독 관리');await selectResult('캘린더 구독 관리');await press('Enter');
      await page.locator('.subscription-form').waitFor();
      await press('Escape');await page.locator('.subscription-form').waitFor({state:'hidden'});
      assert.equal(errors.length,0,errors.join('\n'));
    });
  }catch(error){failure=error.stack||String(error);if(page&&!page.isClosed())await screenshot('failure').catch(()=>{});}
  finally{
    try{await closeApp();}catch(error){failure=[failure,error.stack||String(error)].filter(Boolean).join('\n');}
    const report={results,errors,failure,measurements,dataDir,packaged:false,actualMain:true,screenshots};
    fs.writeFileSync(path.join(output,'e2e-command-verbs.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(failure||errors.length)process.exitCode=1;
  }
})();
