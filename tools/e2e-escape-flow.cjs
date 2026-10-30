/* 키보드 재설계 1단계 검증: Esc는 한 단계씩만 물러나고, Command에서 담은 할 일은 Command에 머물며,
 * 메모의 Tab은 분류를 순환하고, 키보드 포커스와 목록 커서가 화면에 보인다.
 * 실제 개발 main·격리된 프로필에서 키보드 입력만 사용한다. 원본 앱·실제 데이터·OS 전역 단축키는 건드리지 않는다. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron:electron } = require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname,'..');
const runId = String(Date.now());
const output = path.join(root,'test-output');
const dataDir = path.join(output,'escape-flow-profile-'+runId);
const shots = path.join(output,'escape-flow-shots',runId);
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
const visible = selector => page.locator(selector).isVisible();
const commandInput = '.td-command input';
const windowVisible = () => app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible());
async function showCommand(){await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.show();win.focus();});await page.locator('#cf-command-panel').waitFor();await page.locator(commandInput).focus();}
async function commandQuery(value){await page.locator(commandInput).fill('');await text(value);await waitUntil(()=>page.evaluate(()=>!document.querySelector('#cf-command-panel').hasAttribute('aria-busy')&&!!document.querySelector('.td-command-results [data-result]')),'Command 검색 결과가 나오지 않았습니다: '+value);}
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
    assert.equal((await state()).tasks.length,0);

    await test('Command에서 담은 할 일은 Command에 머물고 입력을 비워 연달아 담으며 중복 추가하지 않는다',async()=>{
      for(const [index,title] of [['1','연속 담기 첫째 '+runId],['2','연속 담기 둘째 '+runId]]){
        await commandQuery('할 일 추가 '+title);await press('Enter');
        await waitUntil(async()=>(await state()).tasks.length===Number(index),'할 일이 저장되지 않았습니다: '+title);
        await waitUntil(async()=>await page.locator(commandInput).inputValue()==='','추가한 뒤 입력이 비워지지 않았습니다.');
        assert.equal(await visible('#cf-command-panel'),true,'추가한 뒤 Command를 떠났습니다.');
        assert.equal(await focused(commandInput),true,'추가한 뒤 입력 포커스를 잃었습니다.');
        assert.match(await page.locator(commandInput).getAttribute('placeholder'),/인박스에 담았습니다/);
      }
      assert.equal(await page.locator('.td-command-results [data-result]').count(),0,'담은 뒤 이전 검색 결과가 남아 있습니다.');
      await waitUntil(async()=>(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds().height))===54,'담은 뒤 Command 창이 한 줄 높이로 돌아오지 않았습니다.');
      measurements.commandAfterCapture=await page.evaluate(()=>[...document.querySelectorAll('#cf-command-panel *, .td-feedback, .td-footer')].filter(element=>element.getClientRects().length&&element.children.length===0&&element.textContent.trim()).map(element=>element.className+':'+element.textContent.trim().slice(0,40)));
      await screenshot('01-command-capture-notice');
      await press('Enter');await page.waitForTimeout(400);
      assert.equal((await state()).tasks.length,2,'빈 입력의 Enter가 직전 항목을 다시 추가했습니다.');
      assert.deepEqual((await state()).tasks.map(task=>task.title).sort(),['연속 담기 둘째 '+runId,'연속 담기 첫째 '+runId].sort());
    });

    await test('Ctrl+Enter는 담고 InBox 편집으로 연다',async()=>{
      const title='담고 열기 '+runId;
      await commandQuery('할 일 추가 '+title);await press('Control+Enter');
      await page.locator('#cf-dashboard-panel').waitFor();
      await waitUntil(()=>focused('[data-editor] [data-field=title]'),'담고 열기 뒤 제목 편집으로 가지 않았습니다.');
      assert.equal(await page.locator('[data-editor] [data-field=title]').inputValue(),title);
    });

    await test('Work의 Esc는 편집 → 검색 → 목록 → Command 순서로 한 단계씩 물러난다',async()=>{
      await press('Escape');
      await waitUntil(()=>focused('[data-task-row]'),'편집기 Esc가 목록 행으로 돌아가지 않았습니다.');
      assert.equal(await page.locator('[data-editor]').count(),0,'편집기가 접히지 않았습니다.');
      assert.equal(await visible('#cf-dashboard-panel'),true);
      measurements.rowFocusShadow=await page.evaluate(()=>getComputedStyle(document.activeElement).boxShadow);
      assert.match(measurements.rowFocusShadow,/inset/,'키보드 포커스 행에 왼쪽 막대가 없습니다.');
      await press('/');await waitUntil(()=>focused('[data-work-search]'),'/로 검색에 가지 않았습니다.');
      await text('둘째');await press('Enter');await waitUntil(()=>focused('[data-task-row]'),'검색 Enter가 목록으로 가지 않았습니다.');
      assert.equal(await page.locator('[data-task-row]').count(),1,'검색이 적용되지 않았습니다.');
      await press('Escape');
      await waitUntil(async()=>await page.locator('[data-work-search]').inputValue()==='','Esc가 검색을 풀지 않았습니다.');
      assert.equal(await visible('#cf-dashboard-panel'),true,'검색을 푸는 Esc가 대시보드까지 접었습니다.');
      await waitUntil(()=>focused('[data-task-row]'),'검색을 푼 뒤 목록 포커스를 잃었습니다.');
      await press('/');await waitUntil(()=>focused('[data-work-search]'),'/로 검색에 가지 않았습니다.');
      measurements.cursorShadow=await page.evaluate(()=>getComputedStyle(document.querySelector('[data-task-row].keyboard-current')).boxShadow);
      assert.match(measurements.cursorShadow,/inset/,'포커스가 목록 밖에 있을 때 목록 커서가 보이지 않습니다.');
      await press('Escape');await waitUntil(()=>focused('[data-task-row]'),'빈 검색의 Esc가 목록으로 돌아가지 않았습니다.');
      assert.equal(await visible('#cf-dashboard-panel'),true);
      await screenshot('02-work-list-home');
      await press('Escape');await page.locator('#cf-command-panel').waitFor();
      assert.equal(await focused(commandInput),true);
    });

    await test('Command의 Esc는 입력을 먼저 지우고 빈 입력에서 창을 숨긴다',async()=>{
      await text('지울 검색어');await press('Escape');
      await waitUntil(async()=>await page.locator(commandInput).inputValue()==='','Esc가 입력을 지우지 않았습니다.');
      assert.equal(await windowVisible(),true,'입력이 있는데 창을 숨겼습니다.');
      await press('Escape');await waitUntil(async()=>!await windowVisible(),'빈 입력의 Esc가 창을 숨기지 않았습니다.');
      await showCommand();
    });

    await test('메모의 Tab은 메모·보관함·휴지통을 순환하고 Esc는 메모로 돌아온 뒤 Command로 간다',async()=>{
      await press('Tab');await page.locator('#cf-dashboard-panel').waitFor();
      await press('Alt+n');await waitUntil(()=>within('.desk-notes-browser'),'메모 목록에 포커스가 없습니다.');
      const scope=page.locator('[data-note-scope]');
      assert.equal(await scope.inputValue(),'active');
      await press('Tab');await waitUntil(async()=>await scope.inputValue()==='archived','Tab이 보관함으로 가지 않았습니다.');
      await waitUntil(()=>within('.desk-notes-browser'),'분류를 바꾼 뒤 목록 포커스를 잃었습니다.');
      await press('Tab');await waitUntil(async()=>await scope.inputValue()==='trash','Tab이 휴지통으로 가지 않았습니다.');
      await press('Shift+Tab');await waitUntil(async()=>await scope.inputValue()==='archived','Shift+Tab이 이전 분류로 가지 않았습니다.');
      await press('Escape');await waitUntil(async()=>await scope.inputValue()==='active','Esc가 하위 분류에서 메모로 돌아오지 않았습니다.');
      assert.equal(await visible('#cf-dashboard-panel'),true,'분류를 푸는 Esc가 대시보드까지 접었습니다.');
      await waitUntil(()=>within('.desk-notes-browser'),'메모로 돌아온 뒤 목록 포커스를 잃었습니다.');
      await press('Escape');await page.locator('#cf-command-panel').waitFor();
    });

    await test('입력한 대화상자는 Esc 한 번에 버리지 않고, 입력이 없으면 한 번에 닫는다',async()=>{
      await press('Tab');await page.locator('#cf-dashboard-panel').waitFor();
      await press('Alt+c');await waitUntil(()=>focused('.td-main [data-date]'),'캘린더 날짜에 포커스가 없습니다.');
      await press('n');await page.locator('.event-form').waitFor();
      await press('Escape');await page.locator('.event-form').waitFor({state:'hidden'});
      await waitUntil(()=>focused('.td-main [data-date]'),'빈 대화상자를 닫은 뒤 날짜로 돌아가지 않았습니다.');
      await press('n');await page.locator('.event-form').waitFor();await text('버릴 초안');
      await press('Escape');assert.equal(await visible('.event-form'),true,'입력한 초안을 Esc 한 번에 버렸습니다.');
      assert.match(await page.locator('.td-feedback').innerText(),/한 번 더/);
      await press('Escape');await page.locator('.event-form').waitFor({state:'hidden'});
      assert.equal((await state()).events.length,0);
      await screenshot('03-calendar-home');
      assert.equal(errors.length,0,errors.join('\n'));
    });
  }catch(error){failure=error.stack||String(error);if(page&&!page.isClosed())await screenshot('failure').catch(()=>{});}
  finally{
    try{await closeApp();}catch(error){failure=[failure,error.stack||String(error)].filter(Boolean).join('\n');}
    const report={results,errors,failure,measurements,dataDir,packaged:false,actualMain:true,screenshots};
    fs.writeFileSync(path.join(output,'e2e-escape-flow.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(failure||errors.length)process.exitCode=1;
  }
})();
