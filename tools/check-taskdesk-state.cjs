const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1024,height:1100}});
  await page.addInitScript(()=>{window.openai={setWidgetState:async snapshot=>{window.taskdeskSnapshot=JSON.parse(JSON.stringify(snapshot));window.dispatchEvent(new CustomEvent('openai:set_globals',{detail:{globals:{widgetState:window.taskdeskSnapshot}}}));}};});
  const file=path.resolve(__dirname,'../docs/taskdesk/state-preview.html');
  const source=fs.readFileSync('C:/Users/forcs/.codex/visualizations/2026/10/29/01a1860c-0520-7d53-936d-87f34eb0196d/whendesk-taskdesk.html','utf8');
  fs.writeFileSync(file,'<!doctype html><meta charset="utf-8"><style>body{margin:0}</style>'+source);
  await page.goto(pathToFileURL(file).href);
  const editor=page.locator('[data-field=note]');
  await editor.evaluate(el=>window.taskdeskEditor=el);
  await editor.fill('입력 상태가 다시 전달돼도 편집을 계속합니다.');
  assert.equal(await editor.evaluate(el=>el===window.taskdeskEditor),true);
  await page.locator('[data-look=skin]').selectOption('paper');
  assert.equal(await editor.evaluate(el=>el===window.taskdeskEditor),true);
  assert.equal(await editor.inputValue(),'입력 상태가 다시 전달돼도 편집을 계속합니다.');
  const result={stateEchoPreservesEditor:true,skinChangePreservesEditor:true};
  fs.writeFileSync(path.resolve(__dirname,'../docs/taskdesk/state-validation.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
