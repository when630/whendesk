import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createDomain} from '../main/domain.mjs';
import {exportWorkspace,prepareRestore,prepareLegacy,installPrepared,allowedFile} from '../main/data.mjs';
const temp=path.join(path.dirname(fileURLToPath(import.meta.url)),'.tmp');fs.mkdirSync(temp,{recursive:true});
function folder(){const p=path.join(temp,'data-'+crypto.randomUUID());fs.mkdirSync(p,{recursive:true});return p;}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function fixture(title){const dir=folder();const domain=createDomain({dataDir:dir});await domain.mutate('task.create',{title});return {dir,domain};}

test('WAL 데이터까지 SQLite 백업에 포함하고 체크섬과 전체 스키마를 보존한다',async()=>{
 const {dir,domain}=await fixture('WAL 안의 캡처');
 try{const exported=await exportWorkspace(dir,{skin:'paper',mode:'dark'});assert.ok(exported.files.some(f=>f.path==='work/capture.jsonl'));const prepared=prepareRestore(dir,exported);const restored=createDomain({dataDir:prepared.stage});try{assert.equal(restored.state().tasks[0].title,'WAL 안의 캡처');}finally{restored.close();}}finally{domain.close();}
});
test('변조·경로 이탈·중복·상위 백업 버전은 활성 저장소를 건드리지 않고 거부한다',async()=>{
 const {dir,domain}=await fixture('원래 내용');try{const bundle=await exportWorkspace(dir,{});assert.equal(allowedFile('../outside.sqlite'),false);assert.equal(allowedFile('work/../store.sqlite'),false);const corrupt=structuredClone(bundle);corrupt.files[0].sha256='bad';assert.throws(()=>prepareRestore(dir,corrupt),/체크섬/);const traversal=structuredClone(bundle);traversal.files[0].path='../outside.sqlite';assert.throws(()=>prepareRestore(dir,traversal),/경로/);assert.throws(()=>prepareRestore(dir,{...bundle,version:2}),/지원/);assert.equal(domain.state().tasks[0].title,'원래 내용');}finally{domain.close();}
});
test('백업 큐를 먼저 재생한 후 복원해도 이전 활성 큐가 재주입되지 않는다',async()=>{
 const source=await fixture('가져올 캡처');const target=await fixture('이전 WHENDESK 캡처');
 const bundle=await exportWorkspace(source.dir,{});source.domain.close();target.domain.close();
 const prepared=prepareRestore(target.dir,bundle);const probe=createDomain({dataDir:prepared.stage});probe.close();
 const receipt=installPrepared(target.dir,prepared);assert.ok(fs.existsSync(path.join(receipt.archive,'work','capture.jsonl')));
 const domain=createDomain({dataDir:target.dir});try{assert.deepEqual(domain.state().tasks.map(t=>t.title),['가져올 캡처']);}finally{domain.close();}
});
test('복원 후 롤백은 Work와 Calendar 및 캡처 큐를 함께 되살린다',async()=>{
 const source=await fixture('새 데이터');const target=await fixture('이전 데이터');const bundle=await exportWorkspace(source.dir,{});source.domain.close();target.domain.close();
 const oldHash=hash(path.join(target.dir,'work','store.sqlite'));const queue=fs.readFileSync(path.join(target.dir,'work','capture.jsonl'),'utf8');
 const prepared=prepareRestore(target.dir,bundle);const receipt=installPrepared(target.dir,prepared);receipt.rollback();
 assert.equal(hash(path.join(target.dir,'work','store.sqlite')),oldHash);assert.equal(fs.readFileSync(path.join(target.dir,'work','capture.jsonl'),'utf8'),queue);
 const restored=createDomain({dataDir:target.dir});try{assert.equal(restored.state().tasks[0].title,'이전 데이터');}finally{restored.close();}
});
test('파일 설치 도중 실패하면 이동 영수증으로 이전 파일과 큐를 복구한다',async()=>{
 const source=await fixture('실패할 새 데이터');const target=await fixture('보존할 기존 데이터');const bundle=await exportWorkspace(source.dir,{});source.domain.close();target.domain.close();const prepared=prepareRestore(target.dir,bundle);
 const expected=hash(path.join(target.dir,'work','store.sqlite'));const original=fs.copyFileSync;
 try{fs.copyFileSync=(from,to,...args)=>{if(String(from).startsWith(prepared.stage)&&String(from).includes('calendar'))throw new Error('injected-copy-failure');return original(from,to,...args);};assert.throws(()=>installPrepared(target.dir,prepared),/injected-copy-failure/);}finally{fs.copyFileSync=original;}
 assert.equal(hash(path.join(target.dir,'work','store.sqlite')),expected);assert.ok(fs.existsSync(path.join(target.dir,'work','capture.jsonl')));
 const restored=createDomain({dataDir:target.dir});try{assert.equal(restored.state().tasks[0].title,'보존할 기존 데이터');}finally{restored.close();}
});
test('기존 앱 DB와 queue.jsonl 원본을 보존하면서 복사본에서만 큐를 재생한다',async()=>{
 const origin=await fixture('기존 앱의 항목');origin.domain.close();const legacy=folder();fs.mkdirSync(path.join(legacy,'whenwork'));fs.mkdirSync(path.join(legacy,'whencalendar'));fs.copyFileSync(path.join(origin.dir,'work','store.sqlite'),path.join(legacy,'whenwork','store.sqlite'));fs.copyFileSync(path.join(origin.dir,'calendar','store.sqlite'),path.join(legacy,'whencalendar','store.sqlite'));
 const queue=path.join(legacy,'whenwork','queue.jsonl');fs.writeFileSync(queue,JSON.stringify({id:'pending-legacy',title:'아직 DB에 없는 캡처',captured_at:new Date().toISOString()})+'\n');const originalHash=hash(path.join(legacy,'whenwork','store.sqlite'));const queueHash=hash(queue);
 const prepared=await prepareLegacy(folder(),legacy);const copied=createDomain({dataDir:prepared.stage});try{assert.ok(copied.state().tasks.some(t=>t.title==='아직 DB에 없는 캡처'));}finally{copied.close();}
 assert.equal(hash(path.join(legacy,'whenwork','store.sqlite')),originalHash);assert.equal(hash(queue),queueHash);
});
test('더 최신인 Work DB는 복사본에서도 거부한다',async()=>{
 const {dir,domain}=await fixture('새 스키마');domain.close();const file=path.join(dir,'work','store.sqlite');const db=new DatabaseSync(file);db.exec('PRAGMA user_version=999');db.close();assert.throws(()=>createDomain({dataDir:dir}),/최신|새로|새 버전|schema|저장소/);
});
