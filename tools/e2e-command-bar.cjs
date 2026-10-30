/* 실제 개발 렌더러의 한 줄 Command·조건부 미디어 UI 검사. 모든 OS 효과는 하네스에서 기록만 한다. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron:electron } = require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname,'..');
const runId = String(Date.now());
const output = path.join(root,'test-output');
const dataDir = path.join(output,'command-bar-profile-'+runId);
const shots = path.join(output,'command-bar-shots',runId);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const executable = process.env.WHENDESK_TEST_EXECUTABLE || 'D:/when630/whencommand/node_modules/electron/dist/electron.exe';
const results=[], errors=[], measurements={}, screenshots=[];
let app, page, identity, failure=null;
fs.mkdirSync(shots,{recursive:true});

const records = type => app.evaluate((_electron,type)=>globalThis.__commandTest.calls.filter(entry=>entry.type===type),type);
const emitMedia = value => app.evaluate((_electron,value)=>globalThis.__commandTest.emitMedia(value),value);
const input = () => page.locator('.td-command input');
async function waitUntil(predicate,message){const end=Date.now()+12000;while(Date.now()<end){if(await predicate())return;await page.waitForTimeout(30);}assert.fail(message);}
async function test(name,action){const started=Date.now();try{await action();results.push({name,ok:true,durationMs:Date.now()-started});}catch(error){results.push({name,ok:false,durationMs:Date.now()-started,error:error.message});throw error;}}
async function screenshot(name){const file=path.join(shots,name+'.png');await page.screenshot({path:file});screenshots.push(file);}
function normalize(value){return String(value).replace(/\\"/g,'"').replace(/"/g,'').replace(/\\/g,'/').toLowerCase();}
async function closeHarness(){
  if(!app)return;
  const child=app.process(),spawn=(child?.spawnargs||[]).map(normalize).join(' '),argv=(identity?.argv||[]).map(normalize);
  const harness=normalize(path.join(root,'tools','command-test-main.mjs')),dataArg=normalize('--data-dir='+dataDir);
  const owned=spawn.includes(harness)&&spawn.includes(dataArg)||child?.pid===identity?.childPid&&identity?.dataDir===dataDir&&argv.includes(harness)&&argv.includes(dataArg);
  let timer;
  try{await Promise.race([(async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__whendeskFlush?.()).catch(()=>{});await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);return true;}).catch(()=>{});await app.close().catch(()=>{});})(),new Promise(resolve=>{timer=setTimeout(resolve,4000);})]);}finally{clearTimeout(timer);}
  const alive=child&&child.exitCode===null&&child.signalCode===null;
  if(alive){if(!owned)throw new Error('이번 격리 하네스의 프로세스인지 확인하지 못했습니다.');child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);clearTimeout(timer);}
  measurements.cleanup={owned,forced:!!alive,exitCode:child?.exitCode??null};
}
async function layout(){
  return page.evaluate(()=>{
    const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,centerY:r.y+r.height/2};};
    const bar=document.querySelector('.td-command'),brand=bar.querySelector('.command-brand'),query=bar.querySelector('input'),media=bar.querySelector('.td-media');
    const queryStyle=getComputedStyle(query);
    return {bar:rect(bar),brand:rect(brand),input:rect(query),media:rect(media),mediaHidden:media.hidden,mediaCount:media.querySelectorAll('button').length,inputDecoration:{outlineStyle:queryStyle.outlineStyle,outlineWidth:queryStyle.outlineWidth,borderWidth:queryStyle.borderWidth,boxShadow:queryStyle.boxShadow},innerWidth,innerHeight,scrollWidth:document.documentElement.scrollWidth,barScrollWidth:bar.scrollWidth,barClientWidth:bar.clientWidth};
  });
}
function sameRow(measurement){
  assert.ok(Math.abs(measurement.brand.centerY-measurement.input.centerY)<=3,'아이콘과 입력이 다른 행입니다.');
  assert.ok(measurement.input.x>=measurement.brand.right-1,'입력이 아이콘 왼쪽과 겹칩니다.');
  assert.ok(measurement.input.x-measurement.brand.right<=24,'아이콘과 입력 사이가 너무 멉니다.');
  if(!measurement.mediaHidden){assert.ok(measurement.media.x>=measurement.input.right-1,'미디어가 입력의 오른쪽에 있지 않습니다.');assert.ok(Math.abs(measurement.media.centerY-measurement.input.centerY)<=3,'미디어가 검색 입력과 다른 행입니다.');}
}
function session(id,title,status){return {sourceAppId:id,appId:id,media:{title},playback:{playbackStatus:status}};}
const first=session('fixture-first','처음 연결된 노래',5);
const playing=session('fixture-playing','재생 중인 아주 긴 노래 제목 '.repeat(24),4);

(async()=>{
  try{
    assert.equal(path.basename(executable).toLowerCase(),'electron.exe','개발 Electron 런타임으로만 실행해야 합니다.');
    app=await electron.launch({executablePath:executable,args:[path.join(root,'tools','command-test-main.mjs'),'--data-dir='+dataDir],env,timeout:30000});
    page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>window.desk?.call&&document.querySelector('.td-command input')===document.activeElement);
    identity=await app.evaluate(()=>({mainPid:process.pid,argv:[...process.argv],dataDir:globalThis.__commandTest?.dataDir}));identity.childPid=app.process()?.pid;
    assert.equal(identity.dataDir,dataDir);

    await test('WHENCOMMAND와 같은 560×54 Command·포커스 테두리 없음·상단 창 버튼 제거',async()=>{
      const info=await page.evaluate(()=>window.desk.call('app.info'));assert.equal(info.isPackaged,false);
      assert.equal(await page.locator('.td-chrome,.native-window-controls,.cf-switch,.minimal-settings,[data-action=close-window],[data-action=minimize]').count(),0);
      assert.equal(await page.locator('.td-command .command-brand').count(),1);
      assert.equal(await page.locator('.td-command .td-media').count(),1,'미디어 영역이 검색 입력과 같은 바 안에 있어야 합니다.');
      assert.equal(await page.locator('.td-footer .td-media').count(),0);
      await waitUntil(async()=>(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds())).height===54,'빈 Command가 원본 입력줄 높이 54px로 줄지 않았습니다.');
      const measurement=await layout();sameRow(measurement);assert.equal(measurement.bar.height,54);assert.equal(measurement.innerHeight,54);assert.equal(measurement.innerWidth,560);
      assert.equal(measurement.inputDecoration.outlineStyle,'none');assert.equal(measurement.inputDecoration.outlineWidth,'0px');assert.equal(measurement.inputDecoration.borderWidth,'0px');assert.equal(measurement.inputDecoration.boxShadow,'none');
      measurements.empty=measurement;await screenshot('01-command-empty');
    });

    await test('미디어 대상이 없으면 공간과 하단 컨트롤을 남기지 않음',async()=>{
      await emitMedia({available:true,sessions:[]});
      await page.locator('.td-media').waitFor({state:'hidden'});
      const measurement=await layout();assert.equal(measurement.media.width,0);assert.equal(measurement.media.height,0);
      assert.equal(await page.locator('.td-footer').isVisible(),false);sameRow(measurement);
      measurements.noMedia=measurement;
    });

    await test('연결 대상의 선택과 재생 상태가 검색창 오른쪽 세 컨트롤에 반영',async()=>{
      await emitMedia({available:true,sessions:[first]});await page.locator('.td-media [data-media=play]').waitFor();
      assert.equal(await page.locator('.td-media [data-media=play]').getAttribute('data-app-id'),first.sourceAppId);
      let measurement=await layout();sameRow(measurement);assert.equal(measurement.mediaCount,3);
      assert.ok(measurements.noMedia.input.width-measurement.input.width>=60,'미디어가 표시돼도 입력과 겹치지 않고 우측 폭을 나눠야 합니다.');
      assert.ok(Math.abs(measurement.bar.height-measurements.noMedia.bar.height)<=2,'미디어 때문에 검색 바가 두 줄로 늘었습니다.');
      await emitMedia({available:true,sessions:[first,playing]});await page.locator('.td-media [data-media=pause]').waitFor();
      assert.equal(await page.locator('.td-media [data-media=pause]').getAttribute('data-app-id'),playing.sourceAppId,'현재 지정 대상이 없으면 재생 중인 세션을 선택해야 합니다.');
      await emitMedia({available:true,currentId:first.sourceAppId,sessions:[first,playing]});await page.locator('.td-media [data-media=play]').waitFor();
      assert.equal(await page.locator('.td-media [data-media=play]').getAttribute('data-app-id'),first.sourceAppId,'currentId가 재생 중인 세션보다 우선해야 합니다.');
      measurement=await layout();sameRow(measurement);assert.ok(measurement.input.width>=250);assert.ok(measurement.scrollWidth<=measurement.innerWidth+1);
      measurements.withMedia=measurement;await screenshot('02-command-media');
    });

    await test('미디어 갱신 중 입력·커서·결과 선택 보존과 Shift Tab 키보드 컨트롤',async()=>{
      await input().fill('ListSpec');await page.waitForFunction(()=>document.querySelectorAll('.td-command-results [role=option]').length===12);
      await waitUntil(async()=>(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds())).height===390,'12개 검색 결과의 Command 창 높이가 390px로 제한되지 않았습니다.');
      const resultHeights=await page.locator('.td-command-results [role=option]').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().height));
      assert.ok(resultHeights.every(height=>height===40),'검색 결과는 원본과 같은 40px 한 줄 높이여야 합니다.');measurements.resultHeights=resultHeights;
      await input().press('ArrowDown');await input().press('ArrowDown');
      await input().evaluate(element=>{window.__commandBarInput=element;element.setSelectionRange(1,6);});
      const selected=await page.locator('.td-command-results [aria-selected=true]').getAttribute('data-result-key');
      await emitMedia({available:true,sessions:[playing]});await page.locator('.td-media [data-media=pause]').waitFor();
      assert.equal(await input().evaluate(element=>element===window.__commandBarInput&&element===document.activeElement),true);
      assert.equal(await input().inputValue(),'ListSpec');assert.deepEqual(await input().evaluate(element=>[element.selectionStart,element.selectionEnd]),[1,6]);
      assert.equal(await page.locator('.td-command-results [aria-selected=true]').getAttribute('data-result-key'),selected);
      await page.keyboard.press('Shift+Tab');await page.waitForFunction(()=>document.activeElement?.matches('.td-media [data-media=next]'));
      await page.keyboard.press('Space');await waitUntil(async()=>(await records('media.control')).some(entry=>entry.action==='next'&&entry.appId===playing.sourceAppId),'다음 곡 키보드 동작이 전달되지 않았습니다.');
      await page.keyboard.press('Shift+Tab');await page.waitForFunction(()=>document.activeElement?.matches('.td-media [data-media=pause]'));
      const toggle=await page.locator('.td-media [data-media=pause]').evaluate(element=>{window.__commandBarToggle=element;return element.dataset.appId;});assert.equal(toggle,playing.sourceAppId);
      await page.keyboard.press('Space');await waitUntil(async()=>(await records('media.control')).some(entry=>entry.action==='pause'),'일시정지 키보드 동작이 전달되지 않았습니다.');
      const paused={...playing,playback:{playbackStatus:5}};await emitMedia({available:true,sessions:[paused]});
      await page.waitForFunction(()=>document.activeElement===window.__commandBarToggle&&document.activeElement.dataset.media==='play');
      await page.keyboard.press('Space');await waitUntil(async()=>(await records('media.control')).some(entry=>entry.action==='play'),'재생 키보드 동작이 전달되지 않았습니다.');
      await page.keyboard.press('Shift+Tab');await page.waitForFunction(()=>document.activeElement?.matches('.td-media [data-media=prev]'));await page.keyboard.press('Space');
      await waitUntil(async()=>(await records('media.control')).some(entry=>entry.action==='prev'),'이전 곡 키보드 동작이 전달되지 않았습니다.');
      assert.ok((await records('media.control')).every(entry=>entry.appId===playing.sourceAppId));
      measurements.mediaActions=await records('media.control');await screenshot('03-keyboard-media');
    });

    await test('대상이 사라지면 컨트롤 숨김과 검색 입력 포커스 복원',async()=>{
      await page.locator('.td-media [data-media=next]').focus();
      await emitMedia({available:false,sessions:[]});await page.locator('.td-media').waitFor({state:'hidden'});
      await page.waitForFunction(()=>document.querySelector('.td-command input')===document.activeElement);
      assert.equal(await input().inputValue(),'ListSpec');assert.deepEqual(await input().evaluate(element=>[element.selectionStart,element.selectionEnd]),[1,6]);
      assert.equal(await page.locator('.td-footer').isVisible(),false);sameRow(await layout());
      await screenshot('04-target-removed');
    });

    await test('최상위 네 메뉴·Work 화면 내부 다섯 탭과 키보드·외관 유지',async()=>{
      await input().press('Tab');await page.locator('#cf-dashboard-panel').waitFor();assert.equal(await page.locator('.td-chrome').count(),0);
      assert.deepEqual((await page.locator('.td-nav > button').allTextContents()).map(text=>text.trim()),['Dashboard','Work','Note','Calendar']);
      assert.equal(await page.locator('.td-sidebar [data-tab]').count(),0,'Work 분류가 왼쪽 주 메뉴에 남아 있습니다.');
      assert.equal(await page.locator('.td-main > .td-work-nav').isVisible(),false,'Dashboard에서 Work 탭이 표시됩니다.');
      await screenshot('05-dashboard-no-header');
      await page.keyboard.press('Alt+i');await page.locator('.td-main h1').filter({hasText:'Work · InBox'}).waitFor();
      assert.equal(await page.locator('.td-main > .td-work-nav[role=tablist]').isVisible(),true);
      assert.deepEqual((await page.locator('.td-main > .td-work-nav [data-tab] > span').allTextContents()).map(text=>text.trim()),['InBox','ToDo','Waiting','Done','Projects']);
      assert.equal(await page.locator('.td-work-nav [role=tab]').count(),5);
      assert.equal(await page.locator('.td-work-nav [aria-selected=true]').getAttribute('data-tab'),'inbox');
      assert.equal(await page.locator('.td-work-nav [tabindex="0"]').count(),1,'현재 Work 탭만 기본 포커스 순서에 있어야 합니다.');
      assert.equal(await page.locator('.td-nav > [data-action=work]').getAttribute('aria-current'),'page');
      await page.keyboard.press('Alt+n');await page.locator('.td-main h1').filter({hasText:'Note'}).waitFor();
      assert.equal(await page.locator('.td-main > .td-work-nav').isVisible(),false,'Note에서 Work 탭이 표시됩니다.');
      await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('.td-command input')===document.activeElement);assert.equal(await input().inputValue(),'ListSpec');
      await page.keyboard.press('Alt+s');await page.locator('.td-main h1').filter({hasText:'Settings'}).waitFor();await page.locator('[data-look=skin]').selectOption('paper');await page.locator('[data-look=mode]').selectOption('dark');
      await waitUntil(async()=>{const preferences=await page.evaluate(()=>window.desk.call('preferences.get'));return preferences.skin==='paper'&&preferences.mode==='dark';},'설정에서 외관 선택이 저장되지 않았습니다.');
      await page.keyboard.press('Alt+n');await page.locator('.td-main h1').filter({hasText:'Note'}).waitFor();await page.locator('.desk-notes').waitFor();
      await page.keyboard.press('Control+k');await page.waitForFunction(()=>document.querySelector('.td-command input')===document.activeElement);
      assert.equal(await input().inputValue(),'ListSpec');assert.equal(await page.locator('.td-app').getAttribute('data-skin'),'paper');assert.equal(await page.locator('.td-app').evaluate(element=>element.style.colorScheme),'dark');
      await screenshot('06-command-dark');
    });

    await test('360px에서도 긴 제목은 컨트롤 폭을 늘리지 않고 입력 공간 유지',async()=>{
      await input().fill('');await emitMedia({available:true,sessions:[playing]});await page.locator('.td-media [data-media=pause]').waitFor();
      await app.evaluate(()=>globalThis.__commandTest.setCommandWidth(360));await page.waitForFunction(()=>innerWidth===360);
      const narrow=await layout();sameRow(narrow);assert.ok(narrow.input.width>=130,'좁은 창에서 입력 폭이 너무 작습니다.');assert.ok(narrow.scrollWidth<=narrow.innerWidth+1,'페이지가 가로로 넘칩니다.');assert.ok(narrow.barScrollWidth<=narrow.barClientWidth+1,'검색 바 안에서 가로 넘침이 발생했습니다.');assert.ok(narrow.media.right<=narrow.bar.right+1);
      assert.equal(await page.locator('.td-media button').count(),3);measurements.narrow=narrow;await screenshot('07-narrow-media');
      await app.evaluate(()=>globalThis.__commandTest.setCommandWidth(560));await page.waitForFunction(()=>innerWidth===560);
    });
    assert.deepEqual(errors,[],'처리되지 않은 renderer 오류가 발생했습니다.');
  }catch(error){failure=error.stack||String(error);process.exitCode=1;if(page)await screenshot('failure').catch(()=>{});console.error(error);}
  finally{
    try{await closeHarness();}catch(error){failure=failure||error.stack||String(error);process.exitCode=1;console.error(error);}
    const report={results,errors,failure,measurements,dataDir,developmentHarness:true,osEffects:'mock-recording-only',screenshots};
    fs.writeFileSync(path.join(output,'e2e-command-bar.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }
})();
