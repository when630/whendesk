import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import crypto from 'node:crypto';

const ALLOWED=/^(work\/store\.sqlite|(?:work|note)\/(?:queue|capture)(?:\.pending-\d+)?\.jsonl|note\/store\.sqlite|note\/attachments\/[a-f0-9-]{36}\.[a-z0-9]{1,5}|calendar\/store\.sqlite|command\/[a-zA-Z0-9_.-]+\.(?:db|sqlite))$/;
const LIMIT=160*1024*1024;
export function allowedFile(name){return typeof name==='string'&&ALLOWED.test(name)&&!name.includes('..');}
const isDatabase=name=>/^(?:work|note|calendar|command)\/[^/]+\.(?:sqlite|db)$/.test(name);
const suffixes=name=>isDatabase(name)?['','-wal','-shm']:[''];
const validBase64=value=>typeof value==='string'&&value.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(value);
function listDatabases(dir){const files=[];for(const folder of ['work','note','calendar','command']){const sub=path.join(dir,folder);if(!fs.existsSync(sub))continue;for(const entry of fs.readdirSync(sub,{withFileTypes:true})){const relative=folder+'/'+entry.name;if(entry.isFile()&&allowedFile(relative))files.push(relative);if(folder==='note'&&entry.name==='attachments'&&entry.isDirectory())for(const attachment of fs.readdirSync(path.join(sub,entry.name),{withFileTypes:true})){const name=relative+'/'+attachment.name;if(attachment.isFile()&&allowedFile(name))files.push(name);}}}return files;}
export async function snapshotDatabase(source,destination){
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 const db=new DatabaseSync(source,{readOnly:true});
 try{await backup(db,destination);}finally{db.close();}
}
export async function exportWorkspace(dataDir,preferences){
 const staging=path.join(dataDir,'staging','export-'+crypto.randomUUID());fs.mkdirSync(staging,{recursive:true});
 const files=[];let total=0;
 for(const relative of listDatabases(dataDir)){
  const dest=path.join(staging,relative);if(!isDatabase(relative)){fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(dataDir,relative),dest);}else await snapshotDatabase(path.join(dataDir,relative),dest);
  const bytes=fs.readFileSync(dest);total+=bytes.length;if(total>LIMIT)throw new Error('백업 크기가 허용 범위인 160MB를 초과했습니다.');files.push({path:relative,encoding:'base64',content:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }
 const bundle={app:'whendesk',version:1,exportedAt:new Date().toISOString(),preferences,files};
 // Export staging contains copies only; leave them recoverable until the next maintenance.
 return bundle;
}
export function prepareRestore(dataDir,bundle){
 if(bundle?.app!=='whendesk'||bundle.version!==1||!Array.isArray(bundle.files))throw new Error('지원하는 WHENDESK 백업 파일이 아닙니다.');
 const stage=path.join(dataDir,'staging','restore-'+crypto.randomUUID());fs.mkdirSync(stage,{recursive:true});
 const names=new Set();let total=0;
 for(const entry of bundle.files){
  if(!allowedFile(entry.path)||names.has(entry.path)||entry.encoding!=='base64'||!validBase64(entry.content))throw new Error('백업 파일의 경로나 형식이 올바르지 않습니다.');
  names.add(entry.path);const bytes=Buffer.from(entry.content,'base64');total+=bytes.length;if(total>LIMIT)throw new Error('백업 크기가 허용 범위를 초과했습니다.');
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('백업 파일의 체크섬이 일치하지 않습니다.');
  const file=path.join(stage,entry.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
  if(entry.path.endsWith('.jsonl')){for(const line of bytes.toString('utf8').split('\n'))if(line.trim())JSON.parse(line);}else if(isDatabase(entry.path)){const db=new DatabaseSync(file,{readOnly:true});try{if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('백업 데이터베이스 검사에 실패했습니다.');}finally{db.close();}}
 }
 if(!names.has('work/store.sqlite')||!names.has('calendar/store.sqlite'))throw new Error('할 일 또는 캘린더 데이터가 빠져 있습니다.');
 return {stage,files:[...names],preferences:bundle.preferences||{}};
}
export async function prepareLegacy(dataDir,sourceRoot){
 const stage=path.join(dataDir,'staging','legacy-'+crypto.randomUUID());fs.mkdirSync(stage,{recursive:true});const files=[];
 for(const [app,target,name] of [['whenwork','work','store.sqlite'],['whennote','note','store.sqlite'],['whencalendar','calendar','store.sqlite'],['whencommand','command','whencommand.db']]){
  const source=path.join(sourceRoot,app,name);if(!fs.existsSync(source))continue;
  const relative=target+'/'+name;await snapshotDatabase(source,path.join(stage,relative));files.push(relative);
  // Replay only copied captures. Original queues remain untouched.
  if(app==='whenwork'||app==='whennote')for(const file of fs.readdirSync(path.dirname(source))){if(/^(?:capture|queue)(?:\.pending-\d+)?\.jsonl$/.test(file)){const name=file.replace(/^queue/,'capture');const relative=target+'/'+name;const dest=path.join(stage,relative);if(fs.existsSync(dest))fs.appendFileSync(dest,'\n'+fs.readFileSync(path.join(path.dirname(source),file),'utf8'));else fs.copyFileSync(path.join(path.dirname(source),file),dest);if(!files.includes(relative))files.push(relative);}}
  if(app==='whennote'){
   const sourceAttachments=path.join(path.dirname(source),'attachments');
   if(fs.existsSync(sourceAttachments))for(const entry of fs.readdirSync(sourceAttachments,{withFileTypes:true})){const relative='note/attachments/'+entry.name;if(entry.isFile()&&allowedFile(relative)){const dest=path.join(stage,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(sourceAttachments,entry.name),dest);files.push(relative);}}
  }
 }
 if(!files.length)throw new Error('선택한 폴더에 whenwork, whennote, whencalendar 또는 whencommand 데이터가 없습니다.');
 return {stage,files};
}
export function installPrepared(dataDir,prepared){
 const archive=path.join(dataDir,'backups','before-import-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,6));fs.mkdirSync(archive,{recursive:true});
 const previous=listDatabases(dataDir);const moved=[],copied=[];
 const targets=new Set(prepared.files.filter(relative=>fs.existsSync(path.join(prepared.stage,relative))));
 for(const relative of targets)if(!allowedFile(relative))throw new Error('복원할 경로가 올바르지 않습니다.');
 if(targets.has('work/store.sqlite'))for(const relative of previous)if(/^work\/(?:queue|capture)(?:\.pending-\d+)?\.jsonl$/.test(relative))targets.add(relative);
 if(targets.has('note/store.sqlite'))for(const relative of previous)if(/^note\/(?:attachments\/|(?:queue|capture)(?:\.pending-\d+)?\.jsonl$)/.test(relative))targets.add(relative);
 const rollback=()=>{
  for(const relative of [...copied].reverse()){
   const target=path.join(dataDir,relative);for(const suffix of suffixes(relative))if(fs.existsSync(target+suffix)){const failed=path.join(archive,'failed',relative+suffix);fs.mkdirSync(path.dirname(failed),{recursive:true});fs.renameSync(target+suffix,failed);}
  }
  for(const receipt of [...moved].reverse()){fs.mkdirSync(path.dirname(receipt.target),{recursive:true});fs.copyFileSync(receipt.backup,receipt.target);}
 };
 try{
  // Move every old file first. Otherwise a newly restored capture queue could be
  // archived a second time when its store.sqlite entry comes later in the list.
  for(const relative of targets){
   const target=path.join(dataDir,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
   for(const suffix of suffixes(relative))if(fs.existsSync(target+suffix)){const backup=path.join(archive,relative+suffix);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.renameSync(target+suffix,backup);moved.push({target:target+suffix,backup});}
  }
  for(const relative of prepared.files){const source=path.join(prepared.stage,relative);if(!fs.existsSync(source)&&relative.endsWith('.jsonl'))continue;const target=path.join(dataDir,relative);fs.mkdirSync(path.dirname(target),{recursive:true});copied.push(relative);fs.copyFileSync(source,target);}
  return {archive,rollback,previous};
 }catch(error){
  try{rollback();}catch(restoreError){throw new Error(error.message+' · 자동 복구 실패, 백업 경로: '+archive+' · '+restoreError.message);}
  throw error;
 }
}
