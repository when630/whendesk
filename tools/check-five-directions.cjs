const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const source='C:/Users/forcs/.codex/visualizations/2026/10/29/01a1860c-0520-7d53-936d-87f34eb0196d/whendesk-five-directions.html';
const dir=path.resolve(__dirname,'../docs/five-directions');
fs.mkdirSync(dir,{recursive:true});
const lucide=fs.readFileSync('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/lucide/dist/umd/lucide.js','utf8');
const fragment=fs.readFileSync(source,'utf8');
const wrapper=path.join(dir,'preview.html');
fs.writeFileSync(wrapper,'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WHENDESK 다섯 방향</title><style>body{margin:0} [hidden]{display:none!important}</style><body><script>'+lucide+'</script>'+fragment+'</body></html>');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1024,height:1000}});
  page.setDefaultTimeout(8000); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const layouts=[],interactions=[];
  try{
    await page.goto(pathToFileURL(wrapper).href);
    for(const id of ['overview','focus','paper','timeline','launcher']){
      await page.evaluate(id=>{document.querySelectorAll('[data-variant]').forEach(el=>el.hidden=!el.querySelector('[data-concept="'+id+'"]'));},id);
      const app=page.locator('[data-concept="'+id+'"]');
      for(const width of [1024,736,390,320]){
        await page.setViewportSize({width,height:1500});
        for(const mode of ['light','dark']){
          await app.locator('[data-mode]').selectOption(mode);
          const metrics=await app.evaluate(el=>({height:Math.round(el.getBoundingClientRect().height),overflow:document.documentElement.scrollWidth>innerWidth+1,ownOverflow:el.scrollWidth>el.clientWidth+1}));
          assert.equal(metrics.overflow,false,id+' overflow at '+width);
          assert.equal(metrics.ownOverflow,false,id+' own overflow at '+width);
          layouts.push({id,width,mode,...metrics});
        }
      }
      await page.setViewportSize({width:1024,height:1000});
      await app.locator('[data-mode]').selectOption('light');
      await app.screenshot({path:path.join(dir,id+'.png')});
      await app.locator('[data-mode]').selectOption('dark');
      await app.screenshot({path:path.join(dir,id+'-dark.png')});
      await app.locator('[data-mode]').selectOption('light');
      if(id==='paper'){
        await app.locator('.wc-editor').fill('내용을 이어가는 테스트');
        await app.locator('[data-mode]').selectOption('dark');
        assert.equal(await app.locator('.wc-editor').inputValue(),'내용을 이어가는 테스트');
        await app.locator('[data-action=note-task]').click();
        interactions.push('페이퍼: 편집·모드 변경·할 일 연결');
      }else if(id==='launcher'){
        await app.locator('[data-launch-search]').fill('새로운 작업');
        await app.locator('[data-launch-search]').press('ArrowDown');
        await app.locator('[data-launch-search]').press('Enter');
        assert.ok((await app.locator('.wc-stage').textContent()).includes('새로운 작업'));
        interactions.push('런처: 검색·키보드·새 작업');
      }else{
        await app.locator('[data-check]').first().click();
        if(id==='focus')await app.locator('[data-view=calendar]').first().click(); await app.locator('[data-action=meeting]').first().click();
        assert.equal(await app.locator('.wc-editor-title').inputValue(),'디자인 방향 회의록');
        interactions.push(id+': 완료 처리·일정→회의록');
      }
      await app.locator('[data-action=back]').count();
      const paletteButton=app.locator('[data-action=palette]').first();
      if(await paletteButton.count())await paletteButton.click();
      else await app.locator('.wc-editor').press('Control+k');
      await app.locator('[data-palette-input]').fill('시안 검증 작업');
      await app.locator('[data-palette-input]').press('Enter');
      assert.ok((await app.locator('.wc-stage').textContent()).includes('시안 검증 작업'));
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(dir,'validation.json'),JSON.stringify({layouts,interactions,errors},null,2));
    console.log(JSON.stringify({layoutChecks:layouts.length,heights:layouts.filter(r=>r.width===1024&&r.mode==='light').map(r=>({id:r.id,height:r.height})),interactions,errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
