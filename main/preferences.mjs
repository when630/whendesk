import fs from 'node:fs';
import path from 'node:path';
import {normalizeShortcutValues} from './shortcuts.mjs';
export const DEFAULTS=Object.freeze({skin:'base',mode:'system',hotkey:'Alt+Space',captureHotkey:'Control+Alt+Space',media:true,launchAtLogin:false});
export function createPreferences(file){
 let values={...DEFAULTS};
 if(fs.existsSync(file)){
  try{values={...values,...JSON.parse(fs.readFileSync(file,'utf8'))};}
  catch(error){const copy=file+'.unreadable-'+Date.now();fs.copyFileSync(file,copy);throw new Error('설정 파일을 읽을 수 없습니다. 원본 사본을 보존했습니다. '+error.message);}
 }
 function write(next){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next,null,2));fs.renameSync(tmp,file);values=next;}
 function prepare(patch={}){
   const next={...values};
   for(const [key,value] of Object.entries(patch||{})){
    if(key==='skin'&&['base','ink','paper'].includes(value))next.skin=value;
    else if(key==='mode'&&['system','light','dark'].includes(value))next.mode=value;
    else if(['hotkey','captureHotkey'].includes(key))next[key]=value;
    else if(['media','launchAtLogin'].includes(key)&&typeof value==='boolean')next[key]=value;
   }
   if(Object.hasOwn(patch||{},'hotkey')||Object.hasOwn(patch||{},'captureHotkey'))Object.assign(next,normalizeShortcutValues(next));
   return next;
 }
 return {
  get:()=>({...values}),
  prepare,
  set(patch){
   write(prepare(patch));return {...values};
  },
  replace(data){write({...DEFAULTS,...data});},
 };
}
