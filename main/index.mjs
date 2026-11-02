import {app,BrowserWindow,ipcMain,Menu,Tray,nativeImage,globalShortcut,screen,dialog,shell,nativeTheme,Notification,clipboard} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createPreferences} from './preferences.mjs';
import {createShortcutManager,SHORTCUT_FIELDS} from './shortcuts.mjs';
import {createPositionTracker} from './media-position.mjs';
import {createUpdateState,updateLine} from './update-text.mjs';
import {pickPosition,visibleOnAnyDisplay} from './place.mjs';
import {createToast} from './toast.mjs';
import {briefDecision,briefingLines,dayKey,STALE_WAITING_DAYS} from '../modules/work/main/brief.mjs';
import {exportWorkspace,prepareRestore,prepareLegacy,installPrepared} from './data.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const argv=process.argv.slice(1);
function option(name){const eq=argv.find(a=>a.startsWith(name+'='));if(eq)return eq.slice(name.length+1);const i=argv.indexOf(name);return i>=0?argv[i+1]:null;}
const testMode=argv.includes('--smoke')||argv.includes('--test');
app.setName('whendesk');
const dataDir=path.resolve(option('--data-dir')||(app.isPackaged?path.join(app.getPath('appData'),'whendesk'):path.join(ROOT,'.local')));
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(dataDir,'electron'),{recursive:true});
app.setPath('userData',path.join(dataDir,'electron'));app.setPath('sessionData',path.join(dataDir,'electron','session'));
if(process.platform==='win32')app.setAppUserModelId('com.when630.whendesk');
if(!app.requestSingleInstanceLock()){app.quit();}else{bootstrap().catch(error=>{console.error(error);dialog.showErrorBox('WHENDESK를 시작할 수 없습니다',String(error.stack||error));app.exit(1);});}

async function bootstrap(){
 await app.whenReady();
 const preferences=createPreferences(path.join(dataDir,'preferences.json'));
 nativeTheme.themeSource=preferences.get().mode;
 const {createDomain}=await import('./domain.mjs');
 const {createCommand}=await import('./command.mjs');
 let domain,command,win,tray,mediaControl,mediaTimer;
 let quitting=false,shellMode='command',dataBusy=false;
 let commandReady=false,commandFailure=null,mutationTail=Promise.resolve();
 let updater=null,toast=null,icons=null;const updateState=createUpdateState();
 /* 창이 숨어 있는 동안 조용히 업데이트했으면 표시를 남겨, 다시 뜰 때도 숨은 채로 시작하고 알림만 띄운다. */
 const UPDATED_MARK=path.join(dataDir,'updated-quietly');let updatedQuietly=false;try{updatedQuietly=fs.existsSync(UPDATED_MARK);if(updatedQuietly)fs.rmSync(UPDATED_MARK,{force:true});}catch{}
 const iconCache=async()=>{if(!icons){const {createIconCache}=await import('../modules/command/main/icons.mjs');icons=createIconCache();}return icons;};
 const updateView=()=>({...updateState,line:updateLine(updateState,{current:app.getVersion()}),supported:!!updater?.supported});
 let media={available:false,sessions:[],failure:null};const positions=createPositionTracker();
 let dashboardBounds=null,commandHeight=54,dashboardSaveTimer=null;
 /* 대시보드 자리·크기를 기억한다. 옮기거나 늘리는 동안은 잠깐 모았다가 한 번 쓴다. */
 function rememberDashboard(now=false){if(!win||win.isDestroyed()||shellMode!=='dashboard'||win.isMinimized()||win.isMaximized())return;dashboardBounds=win.getBounds();clearTimeout(dashboardSaveTimer);const save=()=>{if(!testMode)preferences.set({dashboardBounds});};if(now)save();else dashboardSaveTimer=setTimeout(save,400);}
 const rendererURL=pathToFileURL(path.join(ROOT,'renderer','index.html')).href;
 const send=(event,payload)=>{if(win&&!win.isDestroyed())win.webContents.send(event,payload);};
 const changed=()=>send('state.changed',{});
 async function requestQuit(){
  try{if(win&&!win.isDestroyed())await win.webContents.executeJavaScript('window.__whendeskFlush ? window.__whendeskFlush() : Promise.resolve()');}
  catch(error){await dialog.showMessageBox(win,{type:'error',message:'변경 내용을 저장하지 못해 종료를 취소했습니다.',detail:error.message});return;}
  await mutationTail;quitting=true;app.quit();
 }
 function enqueueMutation(fn){const pending=mutationTail.then(fn);mutationTail=pending.catch(()=>{});return pending;}
 function startServices(){
  domain=createDomain({dataDir});
  command=createCommand({dataDir,domain,onMore:payload=>send('command.more',payload),onLaunch:()=>hideWindow()});
  commandReady=false;commandFailure=null;
  Promise.resolve(command.ready()).then(()=>{commandReady=true;send('command.more',{ready:true});if(!testMode)iconCache().then(cache=>cache.warm(command.appPaths())).catch(error=>console.error('아이콘:',error.message));}).catch(error=>{commandFailure=error.message;console.error('Command 준비 실패:',error.message);send('command.more',{error:error.message});});
 }
 function stopServices(){command?.close?.();domain?.close?.();}
 startServices();
 function workArea(){return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;}
 /* 입력줄 창 동작(원본 WHENCOMMAND panel.mjs·platform/win32.mjs).
  * - 숨길 때 minimize를 거친다: 항상 위·작업표시줄 제외 창을 hide()만 하면 OS가 아무 창에나 포커스를 준다(원본 함정 #8).
  * - 다시 부르면 빈 입력줄로 시작한다. 직전 화면이 한 프레임 보이지 않게 투명하게 띄웠다가 렌더러가 그린 뒤 나타낸다(D-30).
  * - 자리는 끌어 둔 곳, 없으면 커서가 있는 디스플레이의 위 28%(D-08·D-19). 전체화면 앱 위에도 뜬다(PANEL-04).
  * - Command에서 포커스가 빠지면 숨는다(PANEL-05). 대시보드는 일반 창이라 숨지 않는다. */
 const COMMAND_PLACE_HEIGHT=390;let placeOnCommand=false,revealTimer=null;
 function commandBoundsFor(width,height){const saved=preferences.get().commandPosition;const pos=pickPosition({saved,size:{width,height:COMMAND_PLACE_HEIGHT},workAreas:screen.getAllDisplays().map(display=>display.workArea),cursorArea:workArea(),centerY:false});return {x:pos.x,y:pos.y,width,height};}
 function reveal(){clearTimeout(revealTimer);revealTimer=null;if(win&&!win.isDestroyed()&&win.isVisible()&&win.getOpacity()<1){win.setOpacity(1);win.focus();}}
 function installUpdate({quiet=false}={}){
  if(!updater)return {installing:false};
  return updater.install(async()=>{
   quitting=true;if(quiet){try{fs.writeFileSync(UPDATED_MARK,app.getVersion());}catch{}}
   try{await win.webContents.executeJavaScript('window.__whendeskFlush ? window.__whendeskFlush() : Promise.resolve()');}catch(error){console.error('업데이트 전 저장:',error.message);}
   await mutationTail;
  });
 }
 let idleSince=0;
 function installWhenIdle(){
  if(updateState.status!=='ready'||!win||win.isDestroyed())return;
  if(win.isVisible()){idleSince=0;return;}
  if(!idleSince)idleSince=Date.now();
  if(Date.now()-idleSince>=60_000&&!dataBusy)installUpdate({quiet:true});else setTimeout(installWhenIdle,61_000);
 }
 function hideWindow(){if(!win||win.isDestroyed()||!win.isVisible())return;clearTimeout(revealTimer);revealTimer=null;if(!testMode)win.minimize();win.hide();win.setOpacity(1);}
 function summon(payload){
  if(!win||win.isDestroyed())return;
  const fresh=!win.isVisible()||win.isMinimized();
  if(fresh&&!payload.capture&&command){try{command.setClipboard(preferences.get().clipboardRow!==false&&!testMode?clipboard.readText():'');}catch{command.setClipboard('');}}
  if(fresh){
   if(!testMode)win.setOpacity(0);
   if(win.isMinimized())win.restore();
   if(shellMode==='command'){const [width,height]=win.getSize();win.setBounds(commandBoundsFor(width,height));}else placeOnCommand=true;
   win.show();win.focus();
   if(!testMode)revealTimer=setTimeout(reveal,150);
  }else win.focus();
  send('navigate',{...payload,fresh});
 }
 function setShell(mode,height){
  if(!win||win.isDestroyed())return {mode:shellMode};
  const area=screen.getDisplayMatching(win.getBounds()).workArea;
  if(mode==='dashboard'){
   if(shellMode!=='dashboard'){
    // 대시보드는 자기 자리(옮기거나 크기를 바꾼 곳, 재시작 뒤에도)로 펼친다. 없거나 화면 밖이면 커서가 있는 디스플레이 가운데.
    const saved=preferences.get().dashboardBounds||dashboardBounds;const usable=saved&&visibleOnAnyDisplay(saved,screen.getAllDisplays().map(display=>display.workArea));
    const home=usable?screen.getDisplayMatching(saved).workArea:workArea();
    const width=Math.min(home.width,Math.max(800,usable?saved.width:1120));const h=Math.min(home.height,Math.max(580,usable?saved.height:820));
    win.setMinimumSize(Math.min(800,home.width),Math.min(560,home.height));
    win.setBounds(usable?{x:Math.max(home.x,Math.min(saved.x,home.x+home.width-width)),y:Math.max(home.y,Math.min(saved.y,home.y+home.height-h)),width,height:h}:{x:Math.round(home.x+(home.width-width)/2),y:Math.round(home.y+(home.height-h)/2),width,height:h});
    win.setAlwaysOnTop(false);win.setVisibleOnAllWorkspaces(false);win.setSkipTaskbar(true);
   }
  }else{
   const entering=shellMode!=='command';
   if(shellMode==='dashboard')rememberDashboard(true);
   shellMode='command'; // 축소 중 발생한 resize가 마지막 대시보드 크기를 덮어쓰지 않도록 한다.
   const width=Math.min(560,area.width);const h=Math.min(area.height,Math.max(54,Math.ceil(Number(height)||commandHeight)));commandHeight=h;
   win.setMinimumSize(Math.min(360,area.width),54);
   // 들어올 때는 Command 자기 자리로. 결과 수에 따라 높이만 바뀔 때는 자리를 옮기지 않는다.
   if(entering||placeOnCommand)win.setBounds(commandBoundsFor(width,h));else{const [x,y]=win.getPosition();win.setBounds({x,y,width,height:h});}placeOnCommand=false;
   win.setAlwaysOnTop(true,'screen-saver');win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});win.setSkipTaskbar(true);
  }
  shellMode=mode==='dashboard'?'dashboard':'command';return {mode:shellMode};
 }
 function showCommand(){summon({shell:'command'});}
 function showDashboard(route={}){if(!win||win.isDestroyed())return;if(win.isMinimized())win.restore();win.show();win.focus();setShell('dashboard');send('navigate',{shell:'dashboard',view:'dashboard',...route});}
 async function handleGlobalShortcut(field){
  if(win?.isVisible()&&win.isFocused()){
   try{if(await win.webContents.executeJavaScript(`window.__whendeskRecordShortcut?.(${JSON.stringify(preferences.get()[field])}) === true`))return;}
   catch(error){console.error('단축키 기록:',error.message);}
  }
  if(field==='hotkey'){if(win?.isVisible()&&win.isFocused()&&shellMode==='command')hideWindow();else showCommand();}
  else if(field==='mediaPlayHotkey')await toggleMedia();
  else if(field==='mediaRewindHotkey')await seekMedia(-SEEK_SEC);
  else if(field==='mediaForwardHotkey')await seekMedia(SEEK_SEC);
  else showCapture(field==='noteCaptureHotkey'?'note':'task');
 }
 /* 음악은 창을 열지 않고 전역 단축키로 조작한다(원본 WHENMUSIC D-28: Command를 여는 순간 이미 한 박자 늦다).
  * 미디어 키에 없는 되감기·앞으로가 핵심이다. 재생 중인 세션, 없으면 첫 세션을 다룬다. */
 const SEEK_SEC=10;
 function currentMedia(){return media.sessions.find(session=>session.playing)||media.sessions[0]||null;}
 async function toggleMedia(){const session=currentMedia();if(!mediaControl||!session)return;await mediaControl[session.playing?'pause':'play'](session.appId).catch(error=>console.error('미디어:',error.message));}
 async function seekMedia(delta){const session=currentMedia();if(!mediaControl||!session)return;const target=positions.target(session.appId,delta);positions.assumeSeek(session.appId,target);await mediaControl.seek(session.appId,target).catch(error=>console.error('미디어:',error.message));}
 /* 빠른 담기: Command 창을 한 줄 수집 모드로 연다. Enter로 담아도 창이 남아 연달아 담는다(원본 WHENWORK·WHENNOTE). */
 function showCapture(kind){summon({shell:'command',capture:kind});}
 const shortcutManager=createShortcutManager({globalShortcut,enabled:!testMode&&!argv.includes('--no-shortcuts'),handlers:{
  hotkey:()=>handleGlobalShortcut('hotkey'),
  captureHotkey:()=>handleGlobalShortcut('captureHotkey'),
  noteCaptureHotkey:()=>handleGlobalShortcut('noteCaptureHotkey'),
  mediaPlayHotkey:()=>handleGlobalShortcut('mediaPlayHotkey'),
  mediaRewindHotkey:()=>handleGlobalShortcut('mediaRewindHotkey'),
  mediaForwardHotkey:()=>handleGlobalShortcut('mediaForwardHotkey'),
 }});
 function registerShortcuts(values=preferences.get()){return shortcutManager.update(values);}
 const area=workArea();
 win=new BrowserWindow({width:560,height:54,x:Math.round(area.x+(area.width-560)/2),y:Math.round(area.y+area.height*.22),minWidth:360,minHeight:54,frame:false,thickFrame:false,skipTaskbar:true,hasShadow:false,show:false,resizable:true,backgroundColor:'#20252c',title:'WHENDESK',icon:path.join(ROOT,'assets','icon.png'),webPreferences:{preload:path.join(ROOT,'main','preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}});
 win.setMenu(null);
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(event,url)=>{if(url!==rendererURL)event.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 win.on('close',event=>{if(!quitting){event.preventDefault();hideWindow();}});
 win.on('hide',()=>{idleSince=Date.now();});win.on('show',()=>{idleSince=0;});win.on('blur',()=>{if(shellMode!=='command'||quitting||testMode||!win.isVisible()||win.getOpacity()<1)return;setTimeout(()=>{if(!win.isDestroyed()&&!win.isFocused()&&win.isVisible()&&shellMode==='command')hideWindow();},60);});
 win.on('moved',()=>{if(!win.isVisible()||win.getOpacity()<1)return;if(shellMode==='dashboard'){rememberDashboard();return;}if(!testMode){const [x,y]=win.getPosition();preferences.set({commandPosition:{x,y}});}});
 win.on('resize',()=>{if(shellMode==='dashboard'&&win.isVisible())rememberDashboard();});
 app.on('second-instance',()=>showCommand());
 app.on('activate',()=>showCommand());
 const trayImage=nativeImage.createFromPath(path.join(ROOT,'assets','tray.png'));
 tray=new Tray(trayImage.isEmpty()?nativeImage.createFromPath(path.join(ROOT,'assets','icon.png')).resize({width:24,height:24}):trayImage);
 tray.setToolTip(app.isPackaged?'WHENDESK':'WHENDESK 개발본');
 tray.setContextMenu(Menu.buildFromTemplate([{label:'WHENCOMMAND',click:showCommand},{label:'대시보드',click:()=>showDashboard()},{label:'인박스',click:()=>showDashboard({view:'tasks',tab:'inbox',focusCapture:true})},{type:'separator'},{label:'입력줄 위치 되돌리기',click:()=>{preferences.set({commandPosition:null});if(win?.isVisible()&&shellMode==='command'){const [width,height]=win.getSize();win.setBounds(commandBoundsFor(width,height));}}},{label:'대시보드 위치 되돌리기',click:()=>{dashboardBounds=null;preferences.set({dashboardBounds:null});}},{label:'앱 목록 새로고침',click:()=>command.refresh().catch(error=>dialog.showErrorBox('목록 새로고침',error.message))},{label:'설정',click:()=>showDashboard({settings:true})},{type:'separator'},{label:'종료',click:()=>requestQuit()}]));
 tray.on('click',()=>win.isVisible()&&win.isFocused()?win.hide():showCommand());
 shortcutManager.initialize(preferences.get());

 async function startMedia(){
  if(process.platform!=='win32'||argv.includes('--no-media')||testMode)return;
  const {createControl}=await import('./control.mjs');
  const update=list=>{positions.observe(list||[]);media={available:true,sessions:(list||[]).map(info=>({appId:info.sourceAppId,title:info.media?.title||'',artist:info.media?.artist||'',playing:info.playback?.playbackStatus===4,sourceAppId:info.sourceAppId,media:info.media,playback:info.playback})),failure:null};send('media.changed',media);};
  mediaControl=createControl({onReady:update,onEvent:event=>{if(event.name==='sessions')update(event.payload.sessions);else{positions.event(event);mediaControl?.poll();}},onFail:failure=>{media={available:false,sessions:[],failure:failure.message};send('media.changed',media);}});
  mediaControl.start();mediaTimer=setInterval(()=>mediaControl?.poll(),3000);
 }
 startMedia().catch(error=>{media.failure=error.message;console.error('미디어:',error.message);});

 async function dataOperation(kind,payload={}){
  if(dataBusy)throw new Error('데이터 작업 중입니다. 잠시 후 다시 시도해 주세요.');
  dataBusy=true;
  try{
   await mutationTail;
   if(kind==='export'){
    const chosen=await dialog.showSaveDialog(win,{title:'WHENDESK 백업 내보내기',defaultPath:'WHENDESK-'+new Date().toISOString().slice(0,10)+'.json',filters:[{name:'WHENDESK 백업',extensions:['json']}]});if(chosen.canceled)return {cancelled:true};
    const bundle=await exportWorkspace(dataDir,preferences.get());fs.writeFileSync(chosen.filePath,JSON.stringify(bundle,null,2));return {ok:true,file:chosen.filePath};
   }
   if(kind==='ics'){
    const chosen=await dialog.showSaveDialog(win,{title:'캘린더 내보내기',defaultPath:'WHENDESK-calendar.ics',filters:[{name:'iCalendar',extensions:['ics']}]});if(chosen.canceled)return {cancelled:true};
    const result=await domain.mutate('ics.export',payload);const text=typeof result==='string'?result:result.text;if(typeof text!=='string')throw new Error('캘린더 내용을 만들 수 없습니다.');fs.writeFileSync(chosen.filePath,text,'utf8');return {ok:true,file:chosen.filePath};
   }
   let prepared;
   if(kind==='restore'){
    const selected=await dialog.showOpenDialog(win,{title:'WHENDESK 백업 선택',properties:['openFile'],filters:[{name:'WHENDESK 백업',extensions:['json']}]});if(selected.canceled)return {cancelled:true};
    if(fs.statSync(selected.filePaths[0]).size>230*1024*1024)throw new Error('백업 파일이 너무 큽니다.');
    prepared=prepareRestore(dataDir,JSON.parse(fs.readFileSync(selected.filePaths[0],'utf8')));
    // Validate copied schemas before replacing active files.
    const probe=createDomain({dataDir:prepared.stage});probe.close();
   }else{
    const selected=await dialog.showOpenDialog(win,{title:'whenwork·whennote·whencalendar·whencommand 폴더가 있는 상위 폴더 선택',defaultPath:app.getPath('appData'),properties:['openDirectory']});if(selected.canceled)return {cancelled:true};
    prepared=await prepareLegacy(dataDir,selected.filePaths[0]);const probe=createDomain({dataDir:prepared.stage});probe.close();
   }
   const confirmation=await dialog.showMessageBox(win,{type:'question',buttons:['취소','백업 후 가져오기'],defaultId:0,cancelId:0,title:'WHENDESK 데이터 가져오기',message:'WHENDESK의 해당 데이터를 선택한 파일의 내용으로 교체합니다.',detail:'현재 WHENDESK 데이터는 backups 폴더에 먼저 보존합니다. 기존 개별 앱의 소스와 사용자 데이터는 변경하지 않습니다.'});if(confirmation.response!==1)return {cancelled:true};
   const bundle=await exportWorkspace(dataDir,preferences.get());const beforeFile=path.join(dataDir,'backups','before-import-'+Date.now()+'.json');fs.mkdirSync(path.dirname(beforeFile),{recursive:true});fs.writeFileSync(beforeFile,JSON.stringify(bundle));
   const oldPreferences=preferences.get();stopServices();let installation;
   try{installation=installPrepared(dataDir,prepared);if(prepared.preferences)preferences.set(prepared.preferences);startServices();nativeTheme.themeSource=preferences.get().mode;if(!testMode)registerShortcuts();}catch(error){try{stopServices();installation?.rollback();preferences.set(oldPreferences);nativeTheme.themeSource=oldPreferences.mode;startServices();if(!testMode)registerShortcuts();}catch(rollbackError){throw new Error('가져오기에 실패했습니다. 백업 경로: '+beforeFile+' · '+rollbackError.message);}throw error;}
   changed();return {ok:true,message:'데이터를 가져왔습니다. 원본과 이전 WHENDESK 데이터는 보존했습니다.',backup:beforeFile,preferences:preferences.get()};
  }finally{dataBusy=false;}
 }

 const methods={
  state:payload=>domain.state(payload),
  mutate:async payload=>{if(dataBusy)throw new Error('데이터 가져오기를 마친 후 다시 시도해 주세요.');const value=await enqueueMutation(()=>domain.mutate(payload?.type,payload?.payload||{}));if(!/^(?:note\.(?:get|open|search|tags|attachments?|export)|work\.(?:history|archive))$/.test(payload?.type||''))changed();return value;},
  'command.query':async payload=>{if(dataBusy)return {items:[],notice:'데이터를 가져오는 중입니다.'};const result=await command.query(payload?.q||'',payload?.seq||0);if(!commandReady&&!result.notice)result.notice=commandFailure||'앱 목록을 준비하고 있습니다.';return result;},
  'command.run':async payload=>{if(dataBusy)throw new Error('데이터 작업 중입니다.');const result=await enqueueMutation(()=>command.run(payload?.key,payload?.actionId,{query:payload?.query}));if(result?.route)changed();if(result?.toast&&!testMode)(toast??=createToast()).show(result.toast);if(result?.reshow&&win&&!win.isDestroyed()&&!win.isVisible()){if(win.isMinimized())win.restore();win.show();win.focus();}return result;},
  'command.copy':payload=>{clipboard.writeText(String(payload?.text??'').slice(0,100_000));return true;},
  'command.icons':async payload=>(await iconCache()).get(Array.isArray(payload?.paths)?payload.paths.filter(item=>typeof item==='string').slice(0,16):[]),
  'command.refresh':()=>command.refresh(),
  shell:payload=>setShell(payload?.mode,payload?.height),
  'preferences.get':()=>preferences.get(),
  'preferences.set':async payload=>{
   const patch=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload:{};
   const before=preferences.get(),changesShortcut=SHORTCUT_FIELDS.some(field=>Object.hasOwn(patch,field));
   const value=changesShortcut?shortcutManager.update({...before,...patch},next=>preferences.set({...patch,...Object.fromEntries(SHORTCUT_FIELDS.map(field=>[field,next[field]]))})):preferences.set(patch);
   nativeTheme.themeSource=value.mode;if('launchAtLogin'in patch&&!testMode&&app.isPackaged)app.setLoginItemSettings({openAtLogin:value.launchAtLogin,args:['--hidden']});return value;
  },
  'update.state':()=>updateView(),
  'update.check':async()=>{if(updater)await updater.check();return updateView();},
  'update.install':()=>installUpdate(),
  'app.info':()=>({name:'WHENDESK',version:app.getVersion(),dataDir,launchAtLoginSupported:app.isPackaged&&!testMode,...shortcutManager.status(),commandReady,commandFailure,platform:process.platform,isPackaged:app.isPackaged}),
  'data.export':()=>dataOperation('export'),
  'data.exportIcs':payload=>dataOperation('ics',payload),
  'data.restore':()=>dataOperation('restore'),
  'data.importLegacy':()=>dataOperation('legacy'),
  'data.openFolder':async()=>{const error=await shell.openPath(dataDir);if(error)throw new Error(error);return true;},
  'note.attachFile':async payload=>{
   if(dataBusy)throw new Error('데이터 작업 중입니다.');
   await domain.mutate('note.get',{id:payload?.id});
   const chosen=await dialog.showOpenDialog(win,{title:'메모에 이미지 첨부',properties:['openFile'],filters:[{name:'이미지',extensions:['png','jpg','jpeg','gif','webp','bmp']}]});
   if(chosen.canceled||!chosen.filePaths?.[0])return {cancelled:true};
   const file=chosen.filePaths[0];if(fs.statSync(file).size>16*1024*1024)throw new Error('첨부 이미지는 16MiB 이하로 선택해 주세요.');
   const result=await enqueueMutation(()=>{if(dataBusy)throw new Error('데이터 작업 중입니다.');return domain.mutate('note.attach',{id:payload.id,name:path.basename(file),base64:fs.readFileSync(file).toString('base64')});});changed();return result;
  },
  'note.openAttachment':async payload=>{if(dataBusy)throw new Error('데이터 작업 중입니다.');const file=domain.noteAttachmentPath(payload?.id,payload?.file);const error=await shell.openPath(file);if(error)throw new Error(error);return true;},
  'note.openExternal':async payload=>{let url;try{url=new URL(payload?.url);}catch{throw new Error('링크 주소가 올바르지 않습니다.');}if(!['http:','https:'].includes(url.protocol))throw new Error('웹 링크만 열 수 있습니다.');await shell.openExternal(url.href);return true;},
  'note.export':async payload=>{
   if(dataBusy)throw new Error('데이터 작업 중입니다.');
   const result=await domain.mutate('note.export',payload||{});
   const chosen=await dialog.showSaveDialog(win,{title:'메모 Markdown 내보내기',defaultPath:result.filename,filters:[{name:'Markdown',extensions:['md']}]});
   if(chosen.canceled||!chosen.filePath)return {cancelled:true};
   if(dataBusy)throw new Error('데이터 작업 중입니다. 다시 시도해 주세요.');
   const attachments=(result.attachments||[]).map(entry=>({file:entry.file,bytes:fs.readFileSync(domain.noteAttachmentPath(entry.id,entry.file))}));
   for(const entry of attachments){const dest=path.join(path.dirname(chosen.filePath),'attachments',entry.file);if(fs.existsSync(dest)&&!fs.readFileSync(dest).equals(entry.bytes))throw new Error('내보낼 위치에 다른 내용의 첨부 파일이 있습니다. 다른 폴더를 선택해 주세요.');}
   for(const entry of attachments){const dest=path.join(path.dirname(chosen.filePath),'attachments',entry.file);fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.writeFileSync(dest,entry.bytes,{flag:'wx'});}
   fs.writeFileSync(chosen.filePath,result.text,'utf8');return {ok:true,file:chosen.filePath,message:'메모를 내보냈어요.'};
  },
  'media.state':()=>media,
  'media.control':async payload=>{if(!mediaControl||!media.available)throw new Error('연결된 미디어를 제어할 수 없습니다.');if(!['play','pause','next','prev'].includes(payload?.action)||!media.sessions.some(s=>s.appId===payload?.appId))throw new Error('미디어 요청이 올바르지 않습니다.');const value=await mediaControl[payload.action](payload.appId);if(value===false)throw new Error('플레이어가 요청을 수락하지 않았습니다.');mediaControl.poll();return value;},
  'window.minimize':()=>win.minimize(),
  'window.close':()=>hideWindow(),
  'window.painted':()=>reveal(),
  'app.quit':()=>requestQuit(),
 };
 ipcMain.handle('desk:call',async(event,method,payload)=>{
  if(event.sender!==win.webContents||event.senderFrame?.url!==rendererURL)return {ok:false,error:'허용하지 않는 호출입니다.'};
  try{if(!Object.hasOwn(methods,method))throw new Error('허용하지 않는 요청입니다.');return {ok:true,value:await methods[method](payload)};}catch(error){console.error(method,error);return {ok:false,error:error.message||String(error),...(error.fields?{fields:error.fields}:{})};}
 });
 win.webContents.on('render-process-gone',(_event,details)=>{console.error('renderer stopped',details);});
 app.on('before-quit',()=>{quitting=true;toast?.dispose();shortcutManager.dispose();clearInterval(mediaTimer);mediaControl?.stop();stopServices();tray?.destroy();});
 await win.loadFile(path.join(ROOT,'renderer','index.html'));
 const hiddenStart=argv.includes('--hidden')||updatedQuietly;
 if(!argv.includes('--headless')&&!hiddenStart){win.show();win.focus();}
 else if(hiddenStart&&!testMode){win.setOpacity(0);win.showInactive();setTimeout(()=>{if(!win.isDestroyed()&&win.getOpacity()===0){win.hide();win.setOpacity(1);}},120);}
 if(updatedQuietly&&!testMode)setTimeout(()=>(toast??=createToast()).show({title:'업데이트했습니다',body:'WHENDESK '+app.getVersion()}),1500);
 /* 자동 업데이트: 설치본(NSIS)에서만. 폴더형 배포본에는 electron-updater가 없어 '설치본에서만'으로 남는다. */
 try{
  if(app.isPackaged&&!testMode){
   const {setupUpdater}=await import('./update.mjs');
   updater=setupUpdater({state:updateState,enabled:true,onChange:()=>{const view=updateView();send('update.changed',view);tray?.setToolTip('WHENDESK · '+view.line);if(updateState.status==='ready')installWhenIdle();}});
   // 받아 둔 업데이트는 창을 쓰지 않을 때 갈아끼운다. 숨긴 직후가 아니라 잠시 뒤에 본다(곧바로 다시 부르는 경우).
   setInterval(installWhenIdle,5*60_000);
  }else updateState.status='unsupported';
 }catch(error){updateState.status='unsupported';console.error('업데이트:',error.message);}
 /* 아침 브리핑(원본 WHENWORK jobs.mjs): 하루 한 번, 설정 시각이 지난 뒤, 그 창(3시간)을 놓친 날은 조용히 넘긴다.
  * WHENDESK에는 캘린더가 있으므로 오늘 일정도 함께 말한다. 알림을 누르면 대시보드를 연다. */
 function maybeBrief(){
  if(testMode||!domain)return;
  const prefs=preferences.get(),today=dayKey();
  const decision=briefDecision({at:prefs.briefAt,lastBriefing:prefs.lastBriefing,enabled:prefs.briefEnabled!==false});
  if(decision==='wait')return;
  if(decision==='skip'){preferences.set({lastBriefing:today});return;}
  try{
   const events=domain.state().events.filter(event=>event.date===today&&!event.allDay).sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt))).map(event=>({start:event.startsAt}));
   const parts=briefingLines(domain.work.briefing(STALE_WAITING_DAYS),{events});
   preferences.set({lastBriefing:today});
   if(!parts.length||!Notification.isSupported())return;
   const notice=new Notification({title:'오늘 WHENDESK',body:parts.join(' · '),icon:path.join(ROOT,'assets','icon.png')});
   notice.on('click',()=>showDashboard());notice.show();
  }catch(error){console.error('브리핑:',error.message);}
 }
 if(!testMode){setTimeout(maybeBrief,30_000);setInterval(maybeBrief,60_000);}
 if(argv.includes('--smoke')){
  const result=await win.webContents.executeJavaScript(`({ready:!!window.desk,title:document.title,errors:window.__whendeskErrors||[]})`);
  console.log('WHENDESK_SMOKE '+JSON.stringify({...result,dataDir}));quitting=true;app.quit();
 }
}
