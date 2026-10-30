import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDomain } from '../main/domain.mjs';
import { exportWorkspace,prepareRestore,prepareLegacy,installPrepared,allowedFile } from '../main/data.mjs';

const root = fileURLToPath(new URL('./.tmp/',import.meta.url));fs.mkdirSync(root,{recursive:true});
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6V0AAAAASUVORK5CYII=';
const folder = () => fs.mkdtempSync(path.join(root,'whendesk-notes-data-'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function fixture(body) {
 const dataDir=folder(),domain=createDomain({dataDir});
 const note=await domain.mutate('note.create',{body});const attachment=await domain.mutate('note.attach',{id:note.id,base64:png});
 await domain.mutate('note.update',{id:note.id,body:body+'\n'+attachment.markdown});
 return {dataDir,domain,note,attachment};
}

test('메모 WAL·태그·상태와 이미지 바이트를 전체 백업에 포함하고 복원한다',async()=>{
 const original=await fixture('보존할 메모 #백업');
 try {
  await original.domain.mutate('note.pin',{id:original.note.id,on:true});
  const bundle=await exportWorkspace(original.dataDir,{});
  assert.ok(bundle.files.some(file=>file.path==='note/store.sqlite'));assert.ok(bundle.files.some(file=>file.path==='note/attachments/'+original.attachment.file));
  const prepared=prepareRestore(folder(),bundle),copy=createDomain({dataDir:prepared.stage});
  try {const saved=await copy.mutate('note.get',{id:original.note.id});assert.equal(saved.pinned,true);assert.deepEqual(saved.tags,['백업']);assert.equal((await copy.mutate('note.attachment',{id:saved.id,file:original.attachment.file})).base64,png);}
  finally {copy.close();}
 } finally {original.domain.close();}
});

test('메모 복원은 이전 큐·첨부를 보관하고 롤백에서 모두 복구한다',async()=>{
 const source=await fixture('새 메모'),target=await fixture('기존 메모');const bundle=await exportWorkspace(source.dataDir,{});source.domain.close();target.domain.close();
 const oldQueue=fs.readFileSync(path.join(target.dataDir,'note','capture.jsonl'),'utf8');
 const prepared=prepareRestore(target.dataDir,bundle),probe=createDomain({dataDir:prepared.stage});probe.close();
 const receipt=installPrepared(target.dataDir,prepared);
 assert.ok(fs.existsSync(path.join(receipt.archive,'note','attachments',target.attachment.file)));
 assert.ok(fs.existsSync(path.join(receipt.archive,'note','capture.jsonl')));
 const restored=createDomain({dataDir:target.dataDir});try{assert.deepEqual(restored.state().notes.map(note=>note.id),[source.note.id]);}finally{restored.close();}
 receipt.rollback();
 assert.equal(fs.readFileSync(path.join(target.dataDir,'note','capture.jsonl'),'utf8'),oldQueue);
 const previous=createDomain({dataDir:target.dataDir});try{assert.deepEqual(previous.state().notes.map(note=>note.id),[target.note.id]);assert.equal((await previous.mutate('note.attachment',{id:target.note.id,file:target.attachment.file})).base64,png);}finally{previous.close();}
});

test('메모가 없던 구형 전체 백업을 복원해도 현재 메모와 첨부는 지우지 않는다',async()=>{
 const source=await fixture('구형 백업에서 생략될 메모'),target=await fixture('지금의 메모');const bundle=await exportWorkspace(source.dataDir,{});source.domain.close();target.domain.close();
 bundle.files=bundle.files.filter(file=>!file.path.startsWith('note/'));
 const prepared=prepareRestore(target.dataDir,bundle),probe=createDomain({dataDir:prepared.stage});probe.close();installPrepared(target.dataDir,prepared);
 const restored=createDomain({dataDir:target.dataDir});try{assert.ok(restored.state().notes.some(note=>note.id===target.note.id));assert.equal((await restored.mutate('note.attachment',{id:target.note.id,file:target.attachment.file})).base64,png);}finally{restored.close();}
});

test('WHENNOTE DB·캡처 큐·이미지 원본을 변경하지 않고 복사본에서만 재생한다',async()=>{
 const original=await fixture('원본 WHENNOTE 메모');original.domain.close();const legacy=folder(),noteDir=path.join(legacy,'whennote');fs.mkdirSync(path.join(noteDir,'attachments'),{recursive:true});
 fs.copyFileSync(path.join(original.dataDir,'note','store.sqlite'),path.join(noteDir,'store.sqlite'));
 fs.copyFileSync(path.join(original.dataDir,'note','attachments',original.attachment.file),path.join(noteDir,'attachments',original.attachment.file));
 const queue=path.join(noteDir,'queue.jsonl');fs.writeFileSync(queue,JSON.stringify({id:'legacy-note-pending',body:'아직 저장되지 않은 메모 #대기',captured_at:new Date().toISOString()})+'\n');
 const originals=[path.join(noteDir,'store.sqlite'),queue,path.join(noteDir,'attachments',original.attachment.file)];const hashes=originals.map(hash);
 const prepared=await prepareLegacy(folder(),legacy);const copy=createDomain({dataDir:prepared.stage});
 try {assert.equal(copy.state().notes.length,2);assert.ok(copy.state().notes.some(note=>note.id==='legacy-note-pending'));assert.equal((await copy.mutate('note.attachment',{id:original.note.id,file:original.attachment.file})).base64,png);}finally{copy.close();}
 assert.deepEqual(originals.map(hash),hashes);
});

test('메모 첨부 백업은 안전한 UUID 경로만 허용하고 변조 바이트를 거부한다',async()=>{
 assert.equal(allowedFile('note/attachments/../../../outside.png'),false);assert.equal(allowedFile('note/attachments/file.png'),false);assert.equal(allowedFile('note/store.sqlite'),true);
 const original=await fixture('첨부 검사');
 try {const bundle=await exportWorkspace(original.dataDir,{});const attachment=bundle.files.find(file=>file.path.startsWith('note/attachments/'));attachment.content=Buffer.from('tampered').toString('base64');assert.throws(()=>prepareRestore(folder(),bundle),/체크섬/);}
 finally {original.domain.close();}
});
