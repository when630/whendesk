import fs from 'node:fs';
import path from 'node:path';
import {normalizeShortcutValues,SHORTCUT_FIELDS} from './shortcuts.mjs';
export const DEFAULTS=Object.freeze({skin:'base',mode:'system',hotkey:'Alt+Space',captureHotkey:'Control+Alt+Space',noteCaptureHotkey:'Control+Alt+M',mediaPlayHotkey:'Control+Alt+P',mediaRewindHotkey:'Control+Alt+Left',mediaForwardHotkey:'Control+Alt+Right',media:true,launchAtLogin:false,briefEnabled:true,briefAt:'09:00',lastBriefing:null});
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
    else if(SHORTCUT_FIELDS.includes(key))next[key]=value;
    else if(['media','launchAtLogin','briefEnabled'].includes(key)&&typeof value==='boolean')next[key]=value;
    else if(key==='briefAt'&&typeof value==='string'&&/^([01]?\d|2[0-3]):[0-5]\d$/.test(value))next.briefAt=value.padStart(5,'0');
    else if(key==='lastBriefing'&&(value===null||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)))next.lastBriefing=value;
   }
   if(SHORTCUT_FIELDS.some(field=>Object.hasOwn(patch||{},field)))Object.assign(next,normalizeShortcutValues(next));
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
