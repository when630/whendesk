import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createDomain } from '../main/domain.mjs';

const temporaryRoot = fileURLToPath(new URL('./.tmp/',import.meta.url));
fs.mkdirSync(temporaryRoot,{recursive:true});
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6V0AAAAASUVORK5CYII=';
function folder() { return fs.mkdtempSync(path.join(temporaryRoot,'whendesk-notes-')); }
function fixture(t) { const dataDir=folder(); const domain=createDomain({dataDir}); t.after(()=>domain.close()); return {dataDir,domain}; }

test('빈 메모 작성·자동 저장·첫 줄 제목·태그·초성·본문 검색과 재시작을 보존한다',async t=>{
 const {dataDir,domain}=fixture(t);
 const empty=await domain.mutate('note.create',{body:''}); assert.equal(empty.body,''); assert.ok(empty.id);
 const body='# 구매 목록\n우유와 식빵을 구입한다. #생활 #장보기\n한글과 emoji 📝';
 await domain.mutate('note.update',{id:empty.id,body});
 assert.equal((await domain.mutate('note.get',{id:empty.id})).title,'구매 목록');
 assert.equal(domain.searchNotes({q:'ㄱㅁ'}).items[0].id,empty.id);
 assert.equal(domain.searchNotes({q:'식빵 #생활'}).items[0].body,body);
 assert.deepEqual(domain.state().noteTags.map(item=>item.tag).sort(),['생활','장보기'].sort());
 domain.close(); const reopened=createDomain({dataDir});
 try { assert.equal(reopened.state().notes.length,1); assert.equal((await reopened.mutate('note.get',{id:empty.id})).body,body); }
 finally { reopened.close(); }
});

test('메모 링크·백링크와 고정 순서·보관함·휴지통 복원을 원본 규칙대로 연결한다',async t=>{
 const {domain}=fixture(t);
 const source=await domain.mutate('note.create',{body:'참고 메모\n[[대상 메모]] #연결'});
 const target=await domain.mutate('note.create',{body:'대상 메모\n세부 내용'});
 assert.equal((await domain.mutate('note.get',{id:source.id})).links[0].to_id,target.id);
 assert.equal((await domain.mutate('note.get',{id:target.id})).backlinks[0].id,source.id);
 await domain.mutate('note.pin',{id:source.id,on:true}); await domain.mutate('note.pin',{id:target.id,on:true});
 await domain.mutate('note.reorder',{id:target.id,direction:-1});
 assert.deepEqual(domain.searchNotes({}).items.map(item=>item.id),[target.id,source.id]);
 await domain.mutate('note.archive',{id:target.id,on:true});
 assert.equal(domain.searchNotes({q:'대상'}).items.length,1,'링크에 제목이 있는 활성 메모만 검색한다');
 assert.equal(domain.searchNotes({q:'대상',scope:'archived'}).items[0].id,target.id);
 await domain.mutate('note.delete',{id:target.id});
 assert.equal(domain.searchNotes({scope:'archived'}).items.length,0);
 assert.equal(domain.searchNotes({scope:'trash',q:'대상'}).items[0].id,target.id);
 await assert.rejects(domain.mutate('note.update',{id:target.id,body:'삭제된 메모 덮기'}),/찾을/);
 const restored=await domain.mutate('note.restore',{id:target.id}); assert.equal(restored.archived,true); assert.equal(restored.deleted,false);
 assert.equal(domain.state().notes.length,2);
});

test('메모 캡처 큐는 복사본 저장소 재시작에서 한 번만 재생되고 최신 본문을 되돌리지 않는다',async t=>{
 const {dataDir,domain}=fixture(t); const note=await domain.mutate('note.create',{body:'처음 내용'});
 await domain.mutate('note.update',{id:note.id,body:'수정한 최신 내용'}); domain.close();
 const queue=path.join(dataDir,'note','capture.jsonl');
 fs.appendFileSync(queue,JSON.stringify({id:'pending-note',body:'대기 중인 내용',captured_at:new Date().toISOString()})+'\n');
 const reopened=createDomain({dataDir});
 try { assert.equal(reopened.state().notes.length,2); assert.equal((await reopened.mutate('note.get',{id:note.id})).body,'수정한 최신 내용'); }
 finally { reopened.close(); }
 const again=createDomain({dataDir}); try { assert.equal(again.state().notes.length,2); } finally { again.close(); }
});

test('이미지 첨부는 UUID로 저장하고 다른 메모·경로 이탈·실행 파일과 잘못된 형식을 거부한다',async t=>{
 const {dataDir,domain}=fixture(t); const a=await domain.mutate('note.create',{body:'첨부 메모'}); const b=await domain.mutate('note.create',{body:'다른 메모'});
 const image=await domain.mutate('note.attach',{id:a.id,name:'이미지.png',base64:png});
 assert.match(image.file,/^[a-f0-9-]{36}\.png$/); assert.match(image.markdown,/attachments\//);
 await domain.mutate('note.update',{id:a.id,body:'첨부 메모\n'+image.markdown});
 const read=await domain.mutate('note.attachment',{id:a.id,file:image.file}); assert.equal(read.base64,png); assert.equal(read.mime,'image/png');
 assert.equal((await domain.mutate('note.get',{id:a.id})).attachments[0].file,image.file);
 await assert.rejects(domain.mutate('note.attachment',{id:b.id,file:image.file}),/이 메모/);
 await assert.rejects(domain.mutate('note.attachment',{id:a.id,file:'../store.sqlite'}),/이 메모/);
 await assert.rejects(domain.mutate('note.attach',{id:a.id,base64:'not base64'}),/형식/);
 await assert.rejects(domain.mutate('note.attach',{id:a.id,base64:Buffer.from('not an image').toString('base64')}),/이미지/);
 const executable=crypto.randomUUID()+'.exe'; fs.writeFileSync(path.join(dataDir,'note','attachments',executable),'MZ executable');domain.note.addAttachment(a.id,executable);
 assert.throws(()=>domain.noteAttachmentPath(a.id,executable),/이 메모/);
 await domain.mutate('note.update',{id:a.id,body:'이미지 참조를 지워도 되돌리기에 필요한 파일 보존'});
 assert.ok(fs.existsSync(domain.noteAttachmentPath(a.id,image.file)));
});

test('Markdown 내보내기는 첫 줄·본문·태그·고정 상태와 이미지 참조를 보존한다',async t=>{
 const {domain}=fixture(t); const note=await domain.mutate('note.create',{body:'# 기억할 것\n#개인 [[다른 메모]]'});
 await domain.mutate('note.pin',{id:note.id,on:true}); const image=await domain.mutate('note.attach',{id:note.id,base64:png});
 await domain.mutate('note.update',{id:note.id,body:note.body+'\n'+image.markdown});
 const exported=await domain.mutate('note.export',{id:note.id}); assert.match(exported.filename,/\.md$/); assert.match(exported.text,/pinned: true/); assert.match(exported.text,/# 기억할 것/); assert.match(exported.text,/#개인/); assert.deepEqual(exported.attachments,[{id:note.id,file:image.file}]);
});

test('더 새로운 메모 스키마를 임의로 초기화하지 않고 원본 파일을 보존한다',()=>{
 const dataDir=folder(),domain=createDomain({dataDir}); domain.close();const file=path.join(dataDir,'note','store.sqlite');
 const db=new DatabaseSync(file);db.exec('PRAGMA user_version=999');db.close();const before=fs.readFileSync(file);
 assert.throws(()=>createDomain({dataDir}),/새 버전/);assert.deepEqual(fs.readFileSync(file),before);
});
