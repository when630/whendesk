/* 개발본 Command 키보드 회귀 검사. OS 효과는 별도 main 하네스에서 기록만 한다. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron:electron } = require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname,'..');
const runId = String(Date.now());
const output = path.join(root,'test-output');
const dataDir = path.join(output,'command-profile-' + runId);
const shots = path.join(output,'command-shots',runId);
fs.mkdirSync(shots,{ recursive:true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const results = [], errors = [], measurements = {};
let app, page, failure = null, launchIdentity = null;
const call = (method,payload) => page.evaluate(async ({method,payload}) => window.desk.call(method,payload),{method,payload});
const records = type => app.evaluate((_electron,type) => globalThis.__commandTest.calls.filter(call => call.type === type),type);
async function waitUntil(predicate,message) {
  const deadline = Date.now()+12000;
  while (Date.now()<deadline) { if (await predicate()) return; await page.waitForTimeout(30); }
  assert.fail(message);
}
async function test(name,action) {
  const started=Date.now();
  try { await action(); results.push({name,ok:true,durationMs:Date.now()-started}); }
  catch(error) { results.push({name,ok:false,durationMs:Date.now()-started,error:error.message}); throw error; }
}
async function query(text,{waitForFiles=true}={}) {
  const input=page.locator('.td-command input');
  if(await input.inputValue()===text)await input.fill('');
  const before=(await records('command.query')).length;
  await input.fill(text);
  let request;
  await waitUntil(async () => {request=(await records('command.query')).slice(before).findLast(call=>call.query===text);return !!request;},'새 검색 요청이 처리되지 않았습니다: '+text);
  if(waitForFiles && text.trim().length>=3) {
    await waitForMore(request);
  }
  await page.waitForTimeout(35);
  return input;
}
async function waitForMore(request) {
  await waitUntil(() => app.evaluate((_electron,request) => globalThis.__commandTest.messages.some(message=>message.seq===request.seq&&message.query===request.query.trim()),request),'이번 순번의 파일 검색 완료가 도착하지 않았습니다: '+request.query);
}
async function executionDone() {
  await page.waitForFunction(() => !document.querySelector('#cf-command-panel').hasAttribute('aria-busy'));
}
async function screenshot(name) { await page.screenshot({path:path.join(shots,name+'.png')}); }
async function noPersistentKeycaps() {
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('kbd')].filter(element=>!element.closest('.minimal-help-layer,.td-hints'/* 하단 상황 힌트는 상시 표시 */)&&element.getClientRects().length).map(element=>element.textContent)),[]);
}
async function noNumericBuiltInKeycaps() {
  const numeric=await page.evaluate(()=>[...document.querySelectorAll('.minimal-help-layer kbd')]
    .filter(element=>element.closest('dl')?.previousElementSibling?.textContent!=='어디서나')
    // 원본 WHENWORK의 1~9 프로젝트 바로 지정만 숫자 키를 쓴다.
    .filter(element=>element.closest('div')?.querySelector('dt')?.textContent!=='프로젝트 바로 지정 (목록 순서)')
    .map(element=>element.textContent).filter(value=>/\d/.test(value)));
  assert.deepEqual(numeric,[],'내장 단축키 안내에 숫자 할당이 남아 있습니다.');
}
function normalizedLaunchText(value) {
  return String(value).replace(/\\"/g,'"').replace(/"/g,'').replace(/\\/g,'/').replace(/\/{2,}/g,'/').toLowerCase();
}
function harnessOwnership(child) {
  const harness=normalizedLaunchText(path.join(root,'tools','command-test-main.mjs'));
  const dataArg=normalizedLaunchText('--data-dir='+dataDir);
  // Playwright가 Windows에서 cmd.exe의 단일 quoted command 인자로 감쌀 수 있다.
  const spawnCommand=(child?.spawnargs||[]).map(normalizedLaunchText).join(' ');
  const spawnContainsHarness=spawnCommand.includes(harness);
  const spawnContainsDataDir=spawnCommand.includes(dataArg);
  const argv=(launchIdentity?.argv||[]).map(normalizedLaunchText);
  const mainContainsHarness=argv.includes(harness);
  const mainContainsDataDir=argv.includes(dataArg);
  const sameChild=!!child&&child.pid===launchIdentity?.childPid;
  const verifiedMain=sameChild&&mainContainsHarness&&mainContainsDataDir&&launchIdentity?.dataDir===dataDir&&Number.isInteger(launchIdentity?.mainPid);
  measurements.cleanupOwnership={spawnContainsHarness,spawnContainsDataDir,mainContainsHarness,mainContainsDataDir,sameChild};
  return spawnContainsHarness&&spawnContainsDataDir || verifiedMain;
}
async function closeHarness() {
  if(!app)return;
  const child=app.process();
  const owned=harnessOwnership(child);
  let timer;
  try {
    await Promise.race([
      (async()=>{
        if(page&&!page.isClosed())await page.evaluate(()=>window.__whendeskFlush?.()).catch(()=>{});
        await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);return true;}).catch(()=>{});
        await app.close().catch(()=>{});
      })(),
      new Promise(resolve=>{timer=setTimeout(resolve,4000);}),
    ]);
  }finally{clearTimeout(timer);}
  const alive=child&&child.exitCode===null&&child.signalCode===null;
  if(alive){
    if(!owned)throw new Error('종료할 프로세스가 이 테스트의 격리 하네스인지 확인하지 못했습니다.');
    child.kill();
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);
    clearTimeout(timer);
  }
  measurements.cleanup={forced:!!alive,exitCode:child?.exitCode??null};
}

(async()=>{
  try {
    app=await electron.launch({
      executablePath:process.env.WHENDESK_TEST_EXECUTABLE || 'D:/when630/whencommand/node_modules/electron/dist/electron.exe',
      args:[path.join(root,'tools','command-test-main.mjs'),'--data-dir='+dataDir],env,timeout:30000,
    });
    page=await app.firstWindow(); page.setDefaultTimeout(12000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>window.desk?.call&&document.querySelector('.td-command input')===document.activeElement);
    launchIdentity=await app.evaluate(()=>({mainPid:process.pid,argv:[...process.argv],dataDir:globalThis.__commandTest?.dataDir}));
    launchIdentity.childPid=app.process()?.pid;
    assert.equal(launchIdentity.dataDir,dataDir,'실행한 main이 이번 격리 테스트 저장소와 일치하지 않습니다.');
    await test('개발 renderer·실제 저장소 연결·OS와 미디어 격리',async()=>{
      const info=await call('app.info');assert.equal(info.isPackaged,false);assert.equal(info.commandReady,true);assert.equal(info.dataDir,dataDir);
      const state=await call('state',{});assert.equal(state.tasks.length,0);assert.equal(state.events.length,0);
      assert.equal(await page.locator('.td-footer').isVisible(),false);
      await noPersistentKeycaps();
    });

    await test('늦은 파일 통합 순위·선택 key 유지·Enter가 재검색 없이 파일 실행',async()=>{
      const input=await query('LateSpec',{waitForFiles:false});
      await page.locator('.td-command-results [data-result-key]').filter({hasText:'LateSpec Alpha'}).waitFor();
      await input.press('ArrowDown');
      const before=await page.locator('.td-command-results [aria-selected=true]').getAttribute('data-result-key');
      await page.locator('.td-command-results [data-result-key^="files:"]').waitFor();
      const after=await page.locator('.td-command-results [aria-selected=true]').getAttribute('data-result-key');
      assert.equal(after,before,'늦은 통합 결과가 선택한 앱을 바꿨습니다.');
      const ordered=await page.locator('.td-command-results [data-result-key]').evaluateAll(elements=>elements.map(element=>element.dataset.resultKey));
      assert.equal(ordered[0],'files:C:\\fixture\\LateSpec.txt','늦은 파일이 통합 점수대로 정렬되지 않았습니다.');
      const selectedIndex=ordered.indexOf(after);
      for(let index=0;index<selectedIndex;index++) await input.press('ArrowUp');
      assert.equal(await page.locator('.td-command-results [aria-selected=true]').getAttribute('data-result-key'),ordered[0]);
      const count=(await records('command.query')).length;
      await input.press('Enter');
      await waitUntil(async()=>!!(await records('path.open')).find(call=>call.file==='C:\\fixture\\LateSpec.txt'),'선택한 파일을 실행하지 않았습니다.');
      await executionDone();assert.equal((await records('command.query')).length,count,'Enter가 표시된 파일 결과를 버리고 재검색했습니다.');
      measurements.lateSearch={selectedBefore:before,selectedAfter:after,ordered};
    });

    await test('Alt+Enter 동작 메뉴·Esc 복귀·경로 복사·Ctrl+Enter 파일 위치',async()=>{
      const input=await query('ActionSpec');
      await input.press('Alt+Enter');await page.locator('#command-action-list').waitFor();
      assert.equal(await page.locator('[data-command-action]').count(),3);
      await page.waitForFunction(()=>{const last=document.querySelector('#command-action-list [role=option]:last-child');return last&&last.getBoundingClientRect().bottom<=innerHeight;});
      await screenshot('01-actions-menu');
      await input.press('Escape');assert.equal(await page.locator('#command-actions').isVisible(),false);assert.equal(await input.inputValue(),'ActionSpec');
      await input.press('Alt+Enter');await page.locator('#command-action-list').waitFor();
      await input.press('ArrowDown');await input.press('ArrowDown');await input.press('Enter');
      await waitUntil(async()=>!!(await records('clipboard.copy')).find(call=>call.text==='C:\\fixture\\ActionSpec.lnk'),'동작 메뉴의 경로 복사가 실행되지 않았습니다.');
      await executionDone();await input.press('Control+Enter');
      await waitUntil(async()=>!!(await records('path.reveal')).find(call=>call.file==='C:\\fixture\\ActionSpec.lnk'),'Ctrl+Enter가 실제 reveal 동작을 선택하지 않았습니다.');
      await executionDone();await noPersistentKeycaps();
      await screenshot('01-actions-complete');
    });

    await test('숫자 실행키 제거·방향키로 선택 후 Enter·중복 방지와 스크롤',async()=>{
      const input=await query('ListSpec');
      await waitUntil(async()=>await page.locator('.td-command-results [data-result-key]').count()===12,'12개 검색 결과가 표시되지 않았습니다.');
      const rows=await page.locator('.td-command-results [data-result-key]').evaluateAll(elements=>elements.map(element=>element.dataset.resultKey));
      const beforeNumber=(await records('command.run')).length;
      await input.press('Control+3');await page.waitForTimeout(100);
      assert.equal((await records('command.run')).length,beforeNumber,'이전 Ctrl+3 숫자 키가 결과를 실행했습니다.');
      await input.press('ArrowDown');await input.press('ArrowDown');await input.press('Enter');
      await waitUntil(async()=>!!(await records('command.run')).find(call=>call.key===rows[2]),'방향키와 Enter가 세 번째 결과를 실행하지 않았습니다.');
      await executionDone();
      await app.evaluate(()=>globalThis.__commandTest.setCommandHeightLimit(320));
      try{
        await page.waitForFunction(()=>window.innerHeight<=320);
        const selected=await page.locator('.td-command-results [aria-selected=true]').getAttribute('data-result-key');
        const distance=(rows.length-1-rows.indexOf(selected)+rows.length)%rows.length;
        for(let step=0;step<distance;step++)await input.press('ArrowDown');
        const position=await page.locator('.td-command-results [aria-selected=true]').evaluate(element=>{const panel=element.closest('#cf-command-panel');return {key:element.dataset.resultKey,bottom:element.getBoundingClientRect().bottom,panelBottom:panel.getBoundingClientRect().bottom,scrollTop:panel.scrollTop};});
        assert.equal(position.key,rows.at(-1));assert.ok(position.scrollTop>0);assert.ok(position.bottom<=position.panelBottom+1,'선택한 마지막 결과가 화면 밖에 남았습니다.');
        measurements.selectionScroll=position;await screenshot('02-selection-scroll');
      }finally{await app.evaluate(()=>globalThis.__commandTest.setCommandHeightLimit(700));}
      const before=(await records('command.run')).length;
      await input.evaluate(element=>{element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',repeat:true,bubbles:true,cancelable:true}));});
      await waitUntil(async()=>(await records('command.run')).length>before,'Enter 실행이 전달되지 않았습니다.');
      await executionDone();assert.equal((await records('command.run')).length,before+1,'빠르게 누른 Enter가 중복 실행됐습니다.');
    });

    await test('새 입력 즉시 이전 응답 무효화·한글 자판 Ctrl+K·IME 조합 보호',async()=>{
      const input=await query('OldSpec',{waitForFiles:false});
      const old=(await records('command.query')).at(-1);
      await input.fill('ListSpec');
      await app.evaluate((_electron,old)=>globalThis.__commandTest.emitMore({seq:old.seq,query:old.query,replace:true,pending:false,items:[{key:'files:stale',source:'files',title:'stale-result',actions:[]}]}),old);
      assert.equal(await page.locator('[data-result-key="files:stale"]').count(),0,'디바운스 중 이전 검색 결과가 새 입력에 합류했습니다.');
      await waitUntil(async()=>await page.locator('.td-command-results [data-result-key]').count()===12,'새 검색 결과가 표시되지 않았습니다.');
      await input.evaluate(element=>{element.setSelectionRange(2,4);element.dispatchEvent(new KeyboardEvent('keydown',{key:'ㅏ',code:'KeyK',ctrlKey:true,bubbles:true,cancelable:true}));});
      await page.waitForFunction(()=>{const input=document.querySelector('.td-command input');return input.selectionStart===0&&input.selectionEnd===input.value.length;});
      const before=(await records('command.run')).length;
      await input.evaluate(element=>{element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true,cancelable:true}));element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,bubbles:true,cancelable:true}));});
      await page.waitForTimeout(120);assert.equal((await records('command.run')).length,before);
      await input.evaluate(element=>element.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
      await page.waitForTimeout(150);assert.equal((await records('command.run')).length,before);
    });

    await test('파일 검색을 기다리는 Enter는 Ctrl+K 또는 IME 조합 시작으로 취소',async()=>{
      const before=(await records('command.run')).length;
      const keyQuery='PendingSpecCancelKey';
      let input=await query(keyQuery,{waitForFiles:false});
      const keyRequest=(await records('command.query')).findLast(call=>call.query===keyQuery);
      assert.equal(await page.locator('.td-command-results [data-result-key]').count(),0,'빠른 결과가 없는 파일 검색 fixture여야 합니다.');
      await input.press('Enter');await input.press('Control+k');
      await page.waitForFunction(()=>{const input=document.querySelector('.td-command input');return input.selectionStart===0&&input.selectionEnd===input.value.length;});
      await waitForMore(keyRequest);await page.waitForTimeout(100);
      assert.equal((await records('command.run')).length,before,'Ctrl+K 후 늦게 도착한 파일이 자동 실행됐습니다.');
      assert.equal((await records('path.open')).some(call=>call.file===`C:\\fixture\\${keyQuery}.txt`),false);

      const imeQuery='PendingSpecCancelIME';
      input=await query(imeQuery,{waitForFiles:false});
      const imeRequest=(await records('command.query')).findLast(call=>call.query===imeQuery);
      assert.equal(await page.locator('.td-command-results [data-result-key]').count(),0);
      await input.press('Enter');
      await input.evaluate(element=>{element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true,cancelable:true}));element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,bubbles:true,cancelable:true}));});
      await waitForMore(imeRequest);assert.equal((await records('command.run')).length,before,'IME 조합 중 늦게 도착한 파일이 실행됐습니다.');
      await input.evaluate(element=>element.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
      let afterComposition;
      await waitUntil(async()=>{afterComposition=(await records('command.query')).findLast(call=>call.query===imeQuery&&call.seq!==imeRequest.seq);return !!afterComposition;},'조합 종료 후 이번 검색을 다시 확인하지 않았습니다.');
      await waitForMore(afterComposition);await page.waitForTimeout(100);
      assert.equal((await records('command.run')).length,before,'IME 조합 종료 뒤 취소했던 Enter가 자동 실행됐습니다.');
      assert.equal((await records('path.open')).some(call=>call.file===`C:\\fixture\\${imeQuery}.txt`),false);
      assert.equal(await input.evaluate(element=>element.readOnly),false);
      measurements.pendingCancellation={keyQuery,imeQuery,runDelta:(await records('command.run')).length-before};
    });

    await test('단축키 직접 기록·정규화 저장·중복/예약/등록 실패에서 기존 설정 유지',async()=>{
      await page.keyboard.press('Alt+s');
      const hotkey=page.locator('[data-shortcut=hotkey]'),capture=page.locator('[data-shortcut=captureHotkey]');
      await hotkey.focus();assert.equal(await page.evaluate(()=>window.__whendeskRecordShortcut('Alt+Space')),true);assert.equal(await hotkey.inputValue(),'Alt+Space');
      await capture.focus();assert.equal(await page.evaluate(()=>window.__whendeskRecordShortcut('Control+Alt+Space')),true);assert.equal(await capture.inputValue(),'Control+Alt+Space');
      await page.locator('[data-action=help]').focus();assert.equal(await page.evaluate(()=>window.__whendeskRecordShortcut('Alt+Space')),false);
      await hotkey.focus();await page.keyboard.press('Control+Alt+F2');assert.equal(await hotkey.inputValue(),'Control+Alt+F2');
      await capture.fill(' ctrl + alt + f3 ');await page.locator('.preferences-form [type=submit]').click();
      await waitUntil(async()=>(await call('preferences.get')).captureHotkey==='Control+Alt+F3','단축키가 정규화되어 저장되지 않았습니다.');
      const saved=await call('preferences.get');
      await hotkey.fill('Control+Alt+F2');await capture.fill('Control+Alt+F2');await page.locator('.preferences-form [type=submit]').click();
      await page.locator('[data-shortcut=hotkey][aria-invalid=true]').waitFor();assert.equal(await capture.getAttribute('aria-invalid'),'true');assert.deepEqual(await call('preferences.get'),saved);
      await hotkey.fill('Ctrl+K');await capture.fill('Control+Alt+F3');await page.locator('.preferences-form [type=submit]').click();
      await page.locator('[data-shortcut-error=hotkey]').filter({hasText:'앱 내부'}).waitFor();assert.deepEqual(await call('preferences.get'),saved);
      await hotkey.fill('Control+Alt+F2');await capture.fill('Control+Alt+F4');await page.locator('.preferences-form [type=submit]').click();
      await page.locator('[data-shortcut-error=captureHotkey]').filter({hasText:'다른 앱'}).waitFor();assert.deepEqual(await call('preferences.get'),saved);
      const registered=await app.evaluate(()=>[...globalThis.__commandTest.registrations.keys()]);assert.deepEqual(registered.sort(),['Control+Alt+F2','Control+Alt+F3','Control+Alt+M','Control+Alt+P','Control+Alt+Left','Control+Alt+Right'].sort());
      measurements.shortcutBindings=registered;await screenshot('03-shortcut-validation');
    });

    await test('일정 모달 Ctrl+K 초안 보존·Tab 순환·Ctrl+/ 도움말 우선순위',async()=>{
      await page.locator('.td-nav [data-action=calendar]').click();await page.locator('.td-main-head [data-action=new-event]').click();
      const title=page.locator('.event-form [name=title]');await title.fill('저장하지 않은 키보드 검증 일정');
      await title.evaluate(element=>{window.__commandDraftNode=element;element.setSelectionRange(2,8);element.dispatchEvent(new KeyboardEvent('keydown',{key:'ㅏ',code:'KeyK',ctrlKey:true,bubbles:true,cancelable:true}));});
      assert.equal(await page.locator('.event-form').isVisible(),true);assert.equal(await title.inputValue(),'저장하지 않은 키보드 검증 일정');assert.equal(await title.evaluate(element=>element===window.__commandDraftNode),true);
      const first=page.locator('.event-form [data-action=close-modal]').first(),last=page.locator('.event-form [type=submit]');
      await last.focus();await page.keyboard.press('Tab');assert.equal(await first.evaluate(element=>element===document.activeElement),true);
      await page.keyboard.press('Shift+Tab');assert.equal(await last.evaluate(element=>element===document.activeElement),true);
      await title.focus();await title.evaluate(element=>element.setSelectionRange(2,8));await title.press('Control+Slash');await page.locator('.minimal-help-layer').waitFor();
      assert.ok(await page.locator('.minimal-help-layer kbd').count()>0);await noPersistentKeycaps();await noNumericBuiltInKeycaps();
      await page.keyboard.press('Escape');await page.locator('.minimal-help-layer').waitFor({state:'hidden'});assert.equal(await page.locator('.event-form').isVisible(),true);assert.deepEqual(await title.evaluate(element=>[element.selectionStart,element.selectionEnd]),[2,8]);
      assert.equal((await call('state',{})).events.length,0);await screenshot('04-modal-draft');
      await page.keyboard.press('Escape');assert.equal(await page.locator('.event-form').isVisible(),true,'입력한 초안을 Esc 한 번에 버렸습니다.');await page.keyboard.press('Escape');await page.locator('.event-form').waitFor({state:'hidden'});
      // 대화상자를 연 버튼에서 Esc는 먼저 화면의 기본 자리(선택 날짜)로, 한 번 더 누르면 Command로 간다.
      await page.keyboard.press('Escape');await waitUntil(()=>page.evaluate(()=>!!document.activeElement?.matches('.td-main [data-date]')),'Esc가 캘린더 기본 자리로 돌아가지 않았습니다.');assert.equal(await page.locator('#cf-dashboard-panel').isVisible(),true);
      await page.keyboard.press('Escape');await page.locator('#cf-command-panel').waitFor();
    });

    assert.deepEqual(errors,[]);
  }catch(error){failure=error.stack||String(error);process.exitCode=1;if(page)await screenshot('failure').catch(()=>{});console.error(error);}
  finally{
    try{await closeHarness();}catch(error){failure=failure||error.stack||String(error);process.exitCode=1;console.error(error);}
    const report={results,errors,failure,measurements,dataDir,developmentHarness:true,osEffects:'mock-recording-only',screenshots:shots};
    fs.writeFileSync(path.join(output,'e2e-command.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }
})();
