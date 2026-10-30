const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const source='C:/Users/forcs/.codex/visualizations/2026/10/29/01a1860c-0520-7d53-936d-87f34eb0196d/whendesk-command-first.html';
const out=path.resolve(__dirname,'../docs/command-first');fs.mkdirSync(out,{recursive:true});
const preview=path.join(out,'preview.html');
const lucide=fs.readFileSync('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/lucide/dist/umd/lucide.js','utf8');
function prepare(){fs.writeFileSync(preview,'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WHENDESK Command 우선 검증</title><style>body{margin:0}[hidden]{display:none!important}</style><body><script>'+lucide+'</script><script>window.openai={setWidgetState:async function(v){window.__qaState=JSON.parse(JSON.stringify(v));}};</script>'+fs.readFileSync(source,'utf8')+'</body></html>');}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1024,height:1100}});page.setDefaultTimeout(8000);
 const root=page.locator('#whendesk-command-first'),command=root.locator('.td-command input'),dash=root.locator('#cf-dashboard-panel');
 const tests=[],layouts=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function reset(){prepare();await page.goto(pathToFileURL(preview).href);await page.setViewportSize({width:1024,height:1100});}
 async function test(name,fn){try{await reset();await fn();tests.push({name,ok:true});console.log('PASS '+name);}catch(e){tests.push({name,ok:false,error:e.message});console.log('FAIL '+name+': '+e.message);await page.screenshot({path:path.join(out,'failure-'+tests.length+'.png'),fullPage:true}).catch(()=>{});}}
 async function openDashboard(){await command.focus();await command.press('Tab');assert.equal(await dash.isVisible(),true);}
 async function openTasks(){await openDashboard();await root.locator('.td-nav [data-tab=todo]').click();await root.locator('[data-task=t1]').click();}
 try{
  await test('기본은 compact Command·자동 입력 포커스·실제 Tab으로 펼치기',async()=>{
   assert.equal(await root.locator('#cf-command-panel').isVisible(),true);assert.equal(await dash.isHidden(),true);
   assert.equal(await root.locator('[role=tab]').count(),0);
   assert.equal(await command.evaluate(el=>document.activeElement===el),true,'초기 입력 포커스 누락');
   const compact=await root.locator('.td-app').boundingBox();assert.ok(compact.width<=682&&compact.height<650,JSON.stringify(compact));
   await page.keyboard.press('Tab');assert.equal(await dash.isVisible(),true);assert.equal(await root.locator('.td-main-head h1').textContent(),'대시보드');
  });
  await test('Command 검색어·선택 결과·caret의 Tab/Esc 왕복 보존',async()=>{
   await command.fill('기');await command.press('ArrowDown');
   const selected=await root.locator('.td-command-result.selected').textContent();
   await command.evaluate(el=>el.setSelectionRange(0,1));
   await command.press('Tab');assert.equal(await dash.isVisible(),true);await page.keyboard.press('Escape');
   assert.equal(await command.inputValue(),'기');assert.equal(await root.locator('.td-command-result.selected').textContent(),selected);
   assert.deepEqual(await command.evaluate(el=>[el.selectionStart,el.selectionEnd]),[0,1]);
   assert.equal(await command.evaluate(el=>document.activeElement===el),true);
  });
  await test('할 일 편집 중 Ctrl K→Command→Tab 복귀 시 DOM·내용·caret 유지',async()=>{
   await openTasks();const title=root.locator('[data-field=title]'),note=root.locator('[data-field=note]');
   await title.fill('작성 중인 할 일 제목');await note.fill('첫 줄\n다시 돌아와 계속 편집할 내용\n마지막 줄');
   await note.evaluate(el=>{window.__qaNote=el;window.__qaTitle=document.querySelector('[data-field=title]');el.focus();el.setSelectionRange(7,12);});
   await note.press('Control+k');assert.equal(await dash.isHidden(),true);await command.press('Tab');
   assert.equal(await note.evaluate(el=>el===window.__qaNote),true);assert.equal(await title.evaluate(el=>el===window.__qaTitle),true);
   assert.equal(await note.inputValue(),'첫 줄\n다시 돌아와 계속 편집할 내용\n마지막 줄');
   assert.deepEqual(await note.evaluate(el=>[el.selectionStart,el.selectionEnd]),[7,12]);assert.equal(await note.evaluate(el=>document.activeElement===el),true);
  });
  await test('대시보드 입력 필드의 Tab은 정상 필드 이동',async()=>{
   await openTasks();const note=root.locator('[data-field=note]');await note.focus();await note.press('Tab');
   assert.equal(await dash.isVisible(),true);assert.equal(await note.evaluate(el=>document.activeElement!==el),true);
  });
  await test('일정 모달 Esc 닫기 다음 Esc Command로 복귀',async()=>{
   await openDashboard();await root.locator('.td-calendar-side [data-action=new-event]').click();
   assert.equal(await root.locator('.td-modal-layer').isVisible(),true);await page.keyboard.press('Escape');
   assert.equal(await root.locator('.td-modal-layer').isHidden(),true);assert.equal(await dash.isVisible(),true);
   await page.keyboard.press('Escape');assert.equal(await dash.isHidden(),true);assert.equal(await command.isVisible(),true);
  });
  await test('대시보드→할 일·인박스·대기·캘린더 기존 메뉴 이동',async()=>{
   await openDashboard();await root.locator('.cf-home-section [data-reveal=t1]').click();assert.equal(await root.locator('[data-editor=t1]').count(),1);
   await root.locator('.td-nav [data-action=home]').click();await root.locator('.cf-entry[data-tab=inbox]').click();
   assert.equal(await root.locator('.td-main-head h1').textContent(),'인박스');await root.locator('[data-task=t4]').click();
   await root.locator('[data-field=kind]').selectOption('waiting');await root.locator('[data-field=waitingFor]').fill('확인 담당자');
   assert.equal(await root.locator('.td-main-head h1').textContent(),'대기');
   await root.locator('.td-nav [data-action=calendar]').click();assert.equal(await root.locator('.td-main-head h1').textContent(),'캘린더');
   assert.equal(await root.locator('.td-calendar-side').isHidden(),true,'캘린더 전체 화면에서 보조 달력이 중복 노출');
  });
  await test('WHENCOMMAND 초성 검색·계산·추가·결과 키보드',async()=>{
   await command.fill('ㄱㅈ');assert.ok((await root.locator('.td-command-results').textContent()).includes('기존 앱의 저장 방식 확인'));
   await command.press('ArrowDown');await command.press('ArrowUp');await command.press('Enter');assert.equal(await root.locator('[data-editor=t2]').count(),1);
   await page.keyboard.press('Control+k');await command.fill('120 * 3');assert.ok((await root.locator('.td-command-result').first().textContent()).includes('360'));
   await command.press('Enter');assert.ok((await root.locator('.td-feedback').textContent()).includes('360'));
   await command.fill('할 일 추가 키보드 검증 작업');await command.press('Enter');assert.equal(await root.locator('[data-field=title]').inputValue(),'키보드 검증 작업');
   await page.keyboard.press('Control+k');await command.fill('계산기');await command.press('Enter');assert.ok((await root.locator('.td-feedback').textContent()).includes('실제 앱에서 계산기를 실행'));
  });
  await test('Command 일정 검색→modal→Esc 두 단계 복귀',async()=>{
   await command.fill('치과');await command.press('Enter');
   assert.equal(await root.locator('.td-modal-layer').isVisible(),true);await page.keyboard.press('Escape');
   assert.equal(await root.locator('.td-modal-layer').isHidden(),true);assert.equal(await dash.isVisible(),true);
   await page.keyboard.press('Escape');assert.equal(await dash.isHidden(),true);assert.equal(await command.isVisible(),true);
  });
  await test('스킨·모드와 캘린더 날짜 변경 시 편집 DOM 보존',async()=>{
   await openTasks();const note=root.locator('[data-field=note]');await note.fill('외관과 날짜 변경 중에도 계속 작성');await note.evaluate(el=>window.__qaNote=el);
   await root.locator('.td-calendar-side [data-date="2026-10-30"]').click();
   for(const skin of ['ink','paper','base'])for(const mode of ['dark','light']){await root.locator('[data-look=skin]').selectOption(skin);await root.locator('[data-look=mode]').selectOption(mode);assert.equal(await note.evaluate(el=>el===window.__qaNote),true);}
  });
  await test('반응형 4폭×4화면×3스킨×2모드 가로넘침 없음',async()=>{
   for(const width of [1024,736,390,320]){
    await page.setViewportSize({width,height:1600});
    for(const view of ['command','dashboard','tasks','calendar']){
     if(view==='command'){if(await dash.isVisible())await page.keyboard.press('Control+k');}
     else{if(await dash.isHidden())await openDashboard();if(view==='dashboard')await root.locator('.td-nav [data-action=home]').click();if(view==='tasks'){await root.locator('.td-nav [data-tab=todo]').click();await root.locator('[data-task=t1]').click();}if(view==='calendar')await root.locator('.td-nav [data-action=calendar]').click();}
     for(const mode of ['light','dark'])for(const skin of ['base','ink','paper']){
      await root.locator('[data-look=mode]').selectOption(mode);await root.locator('[data-look=skin]').selectOption(skin);
      const metric=await page.evaluate(()=>{const app=document.querySelector('.td-app');return{documentOverflow:document.documentElement.scrollWidth>innerWidth+1,appOverflow:app.scrollWidth>app.clientWidth+1};});
      assert.equal(metric.documentOverflow,false,JSON.stringify({width,view,mode,skin,metric}));assert.equal(metric.appOverflow,false,JSON.stringify({width,view,mode,skin,metric}));
      layouts.push({width,view,mode,skin,...metric});
     }
    }
   }
  });
  await test('범위·키보드 안내·화면 탭 없음',async()=>{
   assert.equal(await root.locator('[role=tab]').count(),0);assert.equal(await root.locator('.cf-tabs').count(),0);
   await openDashboard();const text=await dash.textContent();for(const word of ['회의록','집중','마무리','Note','Terminal','Mail'])assert.equal(text.includes(word),false,word);
   assert.ok((await root.locator('.cf-switch').textContent()).includes('Esc'));
  });
  await reset();
  for(const mode of ['light','dark']){
   await root.locator('[data-look=mode]').selectOption(mode);await root.screenshot({path:path.join(out,'command-default-'+mode+'.png')});
   await openDashboard();await root.locator('.td-nav [data-action=home]').click();await root.screenshot({path:path.join(out,'dashboard-home-'+mode+'.png')});
   await root.locator('.td-nav [data-tab=todo]').click();await root.locator('[data-task=t1]').click();await root.screenshot({path:path.join(out,'tasks-'+mode+'.png')});
   await root.locator('.td-nav [data-action=calendar]').click();await root.screenshot({path:path.join(out,'calendar-'+mode+'.png')});
   await page.keyboard.press('Control+k');
  }
 }finally{
  const report={source,tests,layouts,errors,failed:tests.filter(t=>!t.ok).length};fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({tests:tests.length,failed:report.failed,layoutChecks:layouts.length,errors,out}));await browser.close();
 }
 if(tests.some(t=>!t.ok)||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
