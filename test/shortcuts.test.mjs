import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createShortcutManager,normalizeAccelerator,normalizeShortcutValues} from '../main/shortcuts.mjs';
import {createPreferences,DEFAULTS} from '../main/preferences.mjs';

function fixture(options={}) {
 const registered=new Map(),operations=[],occupied=new Set(options.occupied||[]),invoked=[];
 const api={
  register(key,callback){operations.push(['register',key]);if(registered.has(key)||occupied.has(key))return false;registered.set(key,callback);return true;},
  unregister(key){operations.push(['unregister',key]);registered.delete(key);},
 };
 const manager=createShortcutManager({globalShortcut:api,enabled:options.enabled??true,handlers:{hotkey:()=>invoked.push('command'),captureHotkey:()=>invoked.push('capture')}});
 return {manager,registered,operations,occupied,invoked,press:key=>registered.get(key)?.()};
}

test('단축키 표기·순서·플러스·슬래시를 정규화하고 비활성화를 허용한다',()=>{
 assert.equal(normalizeAccelerator(' ctrl + alt + space '),'Control+Alt+Space');
 assert.equal(normalizeAccelerator('Shift+Alt+Ctrl+F2'),'Control+Alt+Shift+F2');
 assert.equal(normalizeAccelerator('Ctrl+/'),'Control+/');
 assert.equal(normalizeAccelerator('Ctrl++'),'Control+Plus');
 assert.equal(normalizeAccelerator('CmdOrCtrl+F2',{platform:'win32'}),'Control+F2');
 assert.equal(normalizeAccelerator('CommandOrControl+F2',{platform:'darwin'}),'Command+F2');
 assert.equal(normalizeAccelerator('F12'),'F12');
 assert.equal(normalizeAccelerator('  '),'');
});

test('잘못된 키·동일 조합·앱 내부 예약 단축키는 필드별 오류로 거부한다',()=>{
 for(const value of ['a','Tab','Enter','Escape','Shift+A','Shift+Tab','AltGr+Q','Control+','Ctrl+Ctrl+A','Ctrl+F25','Ctrl+NotAKey',false])assert.throws(()=>normalizeAccelerator(value));
 assert.throws(()=>normalizeShortcutValues({hotkey:'Ctrl+Alt+Space',captureHotkey:'Alt+Control+Space'}),error=>Object.keys(error.fields).length===2);
 for(const value of ['Ctrl+K','Ctrl+/','Ctrl+Enter','Alt+Enter','Ctrl+N','Ctrl+S','Ctrl+F','Ctrl+P','Ctrl+Shift+I','Ctrl+Shift+A'])assert.throws(()=>normalizeShortcutValues({hotkey:value,captureHotkey:''}),error=>error.fields.hotkey.includes('앱 내부'));
 assert.equal(normalizeShortcutValues({hotkey:'Control+Shift+K',captureHotkey:''}).hotkey,'Control+Shift+K');
});

test('문자 화면 이동·메모 보기 키를 예약하고 해제된 숫자 조합의 사용자 설정은 허용한다',()=>{
 const reserved=['Alt+H','Alt+T','Alt+I','Alt+W','Alt+D','Alt+N','Alt+C','Alt+S','Ctrl+Shift+M','Ctrl+Shift+B','Ctrl+Shift+T'];
 for(const value of reserved){
  assert.throws(()=>normalizeShortcutValues({hotkey:value,captureHotkey:''}),error=>!!error.fields.hotkey&&error.fields.hotkey.includes('앱 내부'));
  assert.throws(()=>normalizeShortcutValues({hotkey:'',captureHotkey:value}),error=>!!error.fields.captureHotkey&&error.fields.captureHotkey.includes('앱 내부'));
 }
 for(const value of ['Ctrl+1','Ctrl+8','Alt+0','Alt+6','Alt+7','Ctrl+Shift+1','Ctrl+Shift+2','Ctrl+Shift+3']){
  assert.equal(normalizeShortcutValues({hotkey:value,captureHotkey:''}).hotkey,normalizeAccelerator(value));
 }
 for(const value of ['Command+Shift+M','Command+Shift+B','Command+Shift+T'])assert.throws(()=>normalizeShortcutValues({hotkey:value,captureHotkey:''}),error=>!!error.fields.hotkey);
});

test('다른 앱과 충돌하면 신규 키만 되돌리고 기존 키와 설정을 유지한다',()=>{
 const f=fixture({occupied:['Alt+F3']});f.manager.initialize(DEFAULTS);
 let saved=false;
 assert.throws(()=>f.manager.update({hotkey:'Alt+F2',captureHotkey:'Alt+F3'},()=>{saved=true;}),error=>!!error.fields.captureHotkey);
 assert.equal(saved,false);assert.deepEqual([...f.registered.keys()],['Alt+Space','Control+Alt+Space','Control+Alt+M']);
 f.press('Alt+Space');f.press('Control+Alt+Space');assert.deepEqual(f.invoked,['command','capture']);
 assert.equal(f.operations.some(([op,key])=>op==='unregister'&&key==='Alt+Space'),false);
 assert.ok(f.manager.status().shortcutErrors.captureHotkey);f.manager.dispose();
});

test('단축키 설정 저장 실패도 기존 등록을 유지하고 신규 등록을 취소한다',()=>{
 const f=fixture();f.manager.initialize(DEFAULTS);
 assert.throws(()=>f.manager.update({hotkey:'Alt+F2',captureHotkey:'Alt+F3'},()=>{throw new Error('디스크 저장 실패');}),/디스크 저장 실패/);
 assert.deepEqual([...f.registered.keys()],['Alt+Space','Control+Alt+Space','Control+Alt+M']);
 f.press('Alt+Space');assert.deepEqual(f.invoked,['command']);f.manager.dispose();
});

test('두 키를 맞바꿔도 해제·재등록 없이 각 동작을 바꾸고 빈 값으로 해제한다',()=>{
 const f=fixture();f.manager.initialize(DEFAULTS);f.operations.length=0;
 let committed;
 f.manager.update({hotkey:'Ctrl+Alt+Space',captureHotkey:'Alt+Space',noteCaptureHotkey:'Control+Alt+M'},value=>{committed=value;return value;});
 assert.deepEqual(f.operations,[]);assert.equal(committed.hotkey,'Control+Alt+Space');
 f.press('Alt+Space');f.press('Control+Alt+Space');assert.deepEqual(f.invoked,['capture','command']);
 f.manager.update({hotkey:'',captureHotkey:'Alt+Space'});
 assert.deepEqual([...f.registered.keys()],['Alt+Space']);assert.equal(f.manager.status().hotkeyOk,false);assert.equal(f.manager.status().captureHotkeyOk,true);f.manager.dispose();
});

test('시작 시 하나가 충돌해도 나머지 키를 등록하고 실패 필드를 구분한다',()=>{
 const f=fixture({occupied:['Alt+Space']});const state=f.manager.initialize(DEFAULTS);
 assert.equal(state.hotkeyOk,false);assert.equal(state.captureHotkeyOk,true);assert.ok(state.shortcutErrors.hotkey);assert.equal(state.shortcutErrors.captureHotkey,undefined);
 f.occupied.clear();f.manager.update(DEFAULTS);assert.equal(f.manager.status().hotkeyOk,true);assert.deepEqual(f.manager.status().shortcutErrors,{});f.manager.dispose();
});

test('테스트·단축키 비활성 모드에서도 검증과 저장을 수행하며 OS는 건드리지 않는다',()=>{
 const f=fixture({enabled:false});f.manager.initialize(DEFAULTS);
 assert.throws(()=>f.manager.update({hotkey:'Alt+F2',captureHotkey:'Alt+F2'}));
 let saved;
 f.manager.update({hotkey:'Ctrl+Alt+F2',captureHotkey:''},value=>{saved=value;});
 assert.equal(saved.hotkey,'Control+Alt+F2');assert.deepEqual(f.operations,[]);assert.equal(f.manager.status().shortcutsEnabled,false);assert.deepEqual(f.manager.status().shortcutErrors,{});
});

test('잘못된 단축키 설정은 기존 JSON을 변경하지 않고 유효한 표기만 저장한다',()=>{
 const temp=path.join(path.dirname(fileURLToPath(import.meta.url)),'.tmp');fs.mkdirSync(temp,{recursive:true});
 const dir=fs.mkdtempSync(path.join(temp,'shortcuts-'));
 try{
  const file=path.join(dir,'preferences.json'),prefs=createPreferences(file);prefs.set({skin:'paper'});
  const before=fs.readFileSync(file,'utf8');
  assert.throws(()=>prefs.set({hotkey:'Alt+Space',captureHotkey:'Alt+Space'}));
  assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(prefs.get().skin,'paper');
  prefs.set({hotkey:'ctrl+alt+f2',captureHotkey:''});
  const restarted=createPreferences(file);assert.equal(restarted.get().hotkey,'Control+Alt+F2');assert.equal(restarted.get().captureHotkey,'');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
