const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{
 const application=await _electron.launch({executablePath:path.join(root,'dist','WHENDESK-0.1.0-win-x64','WHENDESK.exe'),args:['--no-shortcuts','--data-dir='+path.join(root,'test-output','native-readonly-'+Date.now())],env,timeout:30000});
 try{
  const page=await application.firstWindow();await page.waitForFunction(()=>window.desk&&document.querySelector('.cf-entry-name')?.textContent==='WHENCOMMAND');
  const result=await page.evaluate(async()=>{let info,media;for(let i=0;i<30;i++){info=await window.desk.call('app.info');media=await window.desk.call('media.state');if(info.commandReady&&(media.available||media.failure))break;await new Promise(r=>setTimeout(r,200));}const query=await window.desk.call('command.query',{q:'계산기',seq:200});return {packaged:info.isPackaged,commandReady:info.commandReady,appsFound:query.items.filter(i=>i.source==='apps').length,mediaAvailable:media.available,mediaSessions:media.sessions.length,mediaFailure:media.failure||null};});
  assert.equal(result.packaged,true);assert.equal(result.commandReady,true);assert.ok(result.appsFound>0);assert.equal(result.mediaFailure,null);
  fs.writeFileSync(path.join(root,'test-output','native-readonly.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await application.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
