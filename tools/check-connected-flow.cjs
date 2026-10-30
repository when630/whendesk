const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir=path.resolve(__dirname,'../docs/connected-flow');fs.mkdirSync(dir,{recursive:true});
const source='C:/Users/forcs/.codex/visualizations/2026/10/29/01a1860c-0520-7d53-936d-87f34eb0196d/whendesk-connected-flow.html';
let fragment=fs.readFileSync(source,'utf8').replace('s={...s,...next};render();','Object.assign(s,next);render();');fs.writeFileSync(source,fragment);
const lucide=fs.readFileSync('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/lucide/dist/umd/lucide.js','utf8');
const preview=path.join(dir,'preview.html');fs.writeFileSync(preview,'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WHENDESK 연결 흐름</title><style>body{margin:0}[hidden]{display:none!important}</style><body><script>'+lucide+'</script>'+fragment+'</body></html>');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1024,height:1100}});page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const root=page.locator('#whendesk-connected-flow');
 const layouts=[];
 try{
  await page.goto(pathToFileURL(preview).href);
  await root.locator('.flow-note').fill('회의 내용\n선택한 문장으로 후속 할 일 만들기');
  await root.locator('[data-look]').selectOption('dark');
  assert.equal(await root.locator('.flow-note').inputValue(),'회의 내용\n선택한 문장으로 후속 할 일 만들기');
  await root.locator('.flow-note').evaluate(el=>{el.focus();el.setSelectionRange(6,el.value.length);el.dispatchEvent(new Event('select',{bubbles:true}));});
  await root.locator('.flow-note-tools [data-action=create-task]').click();
  assert.equal(await root.locator('.flow-queue-items .flow-item').count(),4);
  await root.locator('[data-task=design]').first().dragTo(root.locator('[data-slot="15:00"]'));
  assert.ok((await root.locator('[data-slot="15:00"]').textContent()).includes('통합 앱 화면 구성 정리'));
  assert.equal(await root.locator('.flow-queue-items .flow-item').count(),4);
  await root.locator('[data-check=design]').click();
  assert.ok((await root.locator('[data-task=design]').first().getAttribute('class')).includes('is-done'));
  await root.locator('[data-task=personal]').first().click();
  await root.locator('[data-action=start]').click();
  assert.equal(await root.locator('.flow-focus h1').textContent(),'다음 주 일정 확인');
  const body=await root.locator('.flow-note').inputValue();
  await root.locator('.flow-capture input').fill('나중에 확인할 아이디어');
  await root.locator('.flow-capture input').press('Enter');
  assert.equal(await root.locator('.flow-note').inputValue(),body);
  await root.locator('[data-action=complete]').click();
  assert.notEqual(await root.locator('.flow-focus h1').textContent(),'다음 주 일정 확인');
  await root.locator('.flow-chrome [data-mode=plan]').click();
  assert.ok((await root.locator('.flow-queue').textContent()).includes('나중에 확인할 아이디어'));
  await root.locator('.flow-inbox-item').last().locator('[data-convert-task]').click();
  assert.equal(await root.locator('.flow-desk h1').textContent(),'나중에 확인할 아이디어');
  await root.locator('.flow-chrome [data-mode=review]').click();
  assert.ok((await root.locator('.flow-review').textContent()).includes('완료한 일 2개'));
  await root.locator('[data-tomorrow=followup]').click();
  assert.ok((await root.locator('.flow-review').textContent()).includes('내일로 옮겨두었어요'));
  for(const width of [1024,736,390,320]){
   await page.setViewportSize({width,height:1500});
   for(const mode of ['plan','focus','review']){
    await root.locator(`.flow-chrome [data-mode=${mode}]`).click();
    for(const look of ['light','dark']){
     await root.locator('[data-look]').selectOption(look);
     const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
     assert.equal(overflow,false,mode+' overflow at '+width);
     layouts.push({width,mode,look});
    }
   }
  }
  await page.reload();await page.setViewportSize({width:1024,height:1100});
  await root.locator('[data-look]').selectOption('light');
  await root.screenshot({path:path.join(dir,'plan.png')});
  await root.locator('[data-task=design]').first().click();
  await root.locator('[data-action=start]').click();
  await root.screenshot({path:path.join(dir,'focus.png')});
  assert.deepEqual(errors,[]);
  const report={layoutChecks:layouts.length,interactions:['메모 유지','선택 문장→할 일','드래그 시간 배치·중복 없음','완료 상태 동기화','실행 중 캡처·메모 유지','완료 후 다음 작업','인박스 분류','마무리·내일로 이동'],errors};
  fs.writeFileSync(path.join(dir,'validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
