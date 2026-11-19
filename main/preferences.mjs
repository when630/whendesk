import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {normalizeShortcutValues,SHORTCUT_FIELDS} from './shortcuts.mjs';
// 스킨·테마 목록은 렌더러와 같은 파일(renderer/themes.js)을 읽는다.
const themeContext={};
vm.runInNewContext(fs.readFileSync(new URL('../renderer/themes.js',import.meta.url),'utf8'),themeContext);
const {THEMES:THEME_LIST,APP_ICONS}=themeContext.WhendeskThemes;
const THEMES=new Map(THEME_LIST.map(theme=>[theme.id,theme]));
function legacyTheme(data){
 // 0.3.35부터 테마는 브랜드 FOG 하나다. 옛 테마(zen-ink·sage…, 걷어낸 스킨의 테마, 0.3.13 이전 값)는 모두 FOG로 옮긴다.
 return THEMES.has(data?.theme)?data.theme:null;
}
/** 테마가 스킨과 밝기를 정한다: skin은 테마의 스킨(지금은 늘 zen), mode(nativeTheme)는 테마의 밝기. */
function withTheme(next,theme){
 const value=THEMES.get(theme);
 const {skinThemes,...rest}=next;
 return {...rest,theme,skin:value.skin,mode:value.auto?'system':value.dark?'dark':'light'}; // auto(FOG)는 OS 밝기를 따른다
}
function normalize(base,data){
 const merged={...base,...data};
 if(!APP_ICONS.some(icon=>icon.id===merged.appIcon))merged.appIcon=base.appIcon;
 if(!['symbol','checkbox'].includes(merged.taskMarker))merged.taskMarker=base.taskMarker;
 return withTheme(merged,legacyTheme(data)||base.theme);
}
export const DEFAULTS=Object.freeze({skin:'zen',theme:'zen-fog',mode:'system',appIcon:'brand',hotkey:'Alt+Space',captureHotkey:'Control+Alt+Space',noteCaptureHotkey:'Control+Alt+M',mediaPlayHotkey:'Control+Alt+P',mediaRewindHotkey:'Control+Alt+Left',mediaForwardHotkey:'Control+Alt+Right',media:true,launchAtLogin:false,briefEnabled:true,briefAt:'09:00',lastBriefing:null,commandPosition:null,dashboardBounds:null,clipboardRow:true,taskMarker:'symbol'});
export function createPreferences(file){
 let values={...DEFAULTS};
 if(fs.existsSync(file)){
  try{values=normalize(values,JSON.parse(fs.readFileSync(file,'utf8')));}
  catch(error){const copy=file+'.unreadable-'+Date.now();fs.copyFileSync(file,copy);throw new Error('설정 파일을 읽을 수 없습니다. 원본 사본을 보존했습니다. '+error.message);}
 }
 function write(next){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next,null,2));fs.renameSync(tmp,file);values=next;}
 function prepare(patch={}){
   const next={...values};
   for(const [key,value] of Object.entries(patch||{})){
    if(key==='theme'&&THEMES.has(value))Object.assign(next,withTheme(next,value));
    else if(key==='appIcon'&&APP_ICONS.some(icon=>icon.id===value))next.appIcon=value;
    else if(SHORTCUT_FIELDS.includes(key))next[key]=value;
    else if(['media','launchAtLogin','briefEnabled'].includes(key)&&typeof value==='boolean')next[key]=value;
    else if(key==='briefAt'&&typeof value==='string'&&/^([01]?\d|2[0-3]):[0-5]\d$/.test(value))next.briefAt=value.padStart(5,'0');
    else if(key==='commandPosition'&&(value===null||value&&Number.isFinite(value.x)&&Number.isFinite(value.y)))next.commandPosition=value?{x:Math.round(value.x),y:Math.round(value.y)}:null;
    else if(key==='clipboardRow'&&typeof value==='boolean')next.clipboardRow=value;
    else if(key==='taskMarker'&&['symbol','checkbox'].includes(value))next.taskMarker=value;
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
  replace(data){write(normalize(DEFAULTS,data));},
 };
}
