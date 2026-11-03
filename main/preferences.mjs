import fs from 'node:fs';
import path from 'node:path';
import {normalizeShortcutValues,SHORTCUT_FIELDS} from './shortcuts.mjs';
/** 색 테마. 테마가 밝기를 정하므로 mode(nativeTheme)는 테마에서 파생한다. */
export const THEMES=Object.freeze({sage:'light',paper:'light',ink:'dark',stone:'light',snow:'light',kraft:'light',night:'dark',moss:'dark',dim:'dark'});
/** 테마 없는 옛 설정(skin·mode)은 다크면 INK, 아니면 SAGE로 옮긴다. */
function withTheme(base,data){const {skin,...rest}={...base,...data};const theme=Object.hasOwn(THEMES,data?.theme)?data.theme:data?.mode==='dark'?'ink':base.theme;return {...rest,theme,mode:THEMES[theme]};}
export const DEFAULTS=Object.freeze({theme:'sage',mode:'light',hotkey:'Alt+Space',captureHotkey:'Control+Alt+Space',noteCaptureHotkey:'Control+Alt+M',mediaPlayHotkey:'Control+Alt+P',mediaRewindHotkey:'Control+Alt+Left',mediaForwardHotkey:'Control+Alt+Right',media:true,launchAtLogin:false,briefEnabled:true,briefAt:'09:00',lastBriefing:null,commandPosition:null,dashboardBounds:null,clipboardRow:true});
export function createPreferences(file){
 let values={...DEFAULTS};
 if(fs.existsSync(file)){
  try{values=withTheme(values,JSON.parse(fs.readFileSync(file,'utf8')));}
  catch(error){const copy=file+'.unreadable-'+Date.now();fs.copyFileSync(file,copy);throw new Error('설정 파일을 읽을 수 없습니다. 원본 사본을 보존했습니다. '+error.message);}
 }
 function write(next){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next,null,2));fs.renameSync(tmp,file);values=next;}
 function prepare(patch={}){
   const next={...values};
   for(const [key,value] of Object.entries(patch||{})){
    if(key==='theme'&&Object.hasOwn(THEMES,value)){next.theme=value;next.mode=THEMES[value];}
    else if(SHORTCUT_FIELDS.includes(key))next[key]=value;
    else if(['media','launchAtLogin','briefEnabled'].includes(key)&&typeof value==='boolean')next[key]=value;
    else if(key==='briefAt'&&typeof value==='string'&&/^([01]?\d|2[0-3]):[0-5]\d$/.test(value))next.briefAt=value.padStart(5,'0');
    else if(key==='commandPosition'&&(value===null||value&&Number.isFinite(value.x)&&Number.isFinite(value.y)))next.commandPosition=value?{x:Math.round(value.x),y:Math.round(value.y)}:null;
    else if(key==='clipboardRow'&&typeof value==='boolean')next.clipboardRow=value;
    else if(key==='dashboardBounds'&&(value===null||value&&['x','y','width','height'].every(field=>Number.isFinite(value[field]))))next.dashboardBounds=value?{x:Math.round(value.x),y:Math.round(value.y),width:Math.round(value.width),height:Math.round(value.height)}:null;
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
  replace(data){write(withTheme(DEFAULTS,data));},
 };
}
