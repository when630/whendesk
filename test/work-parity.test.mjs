import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDomain } from '../main/domain.mjs';
import { parseDue } from '../modules/work/main/parse.mjs';

const range = { year:2026, month:9 };
function setup(t) {
  const temporaryRoot = fileURLToPath(new URL('./.tmp/',import.meta.url));
  fs.mkdirSync(temporaryRoot,{ recursive:true });
  const dataDir = fs.mkdtempSync(path.join(temporaryRoot,'whendesk-work-parity-'));
  const domain = createDomain({ dataDir });
  const handles = [domain];
  t.after(() => { for (const handle of handles) handle.close(); fs.rmSync(dataDir,{ recursive:true, force:true }); });
  return { domain,dataDir,reopen:() => { const handle = createDomain({ dataDir }); handles.push(handle); return handle; } };
}
const taskById = (domain,id) => domain.state(range).tasks.find(task => task.id === id);

test('원본 Work 마감 해석으로 자연어·상대일·월일·해제를 저장하고 잘못된 입력은 기존 값을 보존한다',async t => {
  const { domain } = setup(t);
  const task = await domain.mutate('task.create',{ title:'원본 마감 입력' });
  for (const input of ['오늘','내일','모레','+3','3일','8-12','2027-02-28','']) {
    const expected = parseDue(input);
    assert.equal(expected.ok,true);
    const result = await domain.mutate('task.setDue',{ id:task.id,text:input });
    assert.equal(result.due,expected.value || '');
    assert.equal(taskById(domain,task.id).due,expected.value || '');
  }
  await domain.mutate('task.setDue',{ id:task.id,text:'2028-02-29' });
  for (const input of ['2027-02-29','13-1','언젠가',7]) {
    await assert.rejects(domain.mutate('task.setDue',{ id:task.id,text:input }),/마감/);
    assert.equal(taskById(domain,task.id).due,'2028-02-29');
  }
});

test('프로젝트 지정은 InBox를 ToDo로 분류하고 Waiting 상태와 대기 상대는 유지한다',async t => {
  const { domain } = setup(t);
  const first = await domain.mutate('project.create',{ name:'첫 프로젝트' });
  const second = await domain.mutate('project.create',{ name:'다른 프로젝트' });
  const task = await domain.mutate('task.create',{ title:'분류할 항목' });
  let result = await domain.mutate('task.update',{ id:task.id,project_id:first.id });
  assert.equal(result.kind,'todo');
  assert.equal(result.project,first.name);
  await domain.mutate('task.update',{ id:task.id,kind:'waiting',waitingFor:'담당자' });
  result = await domain.mutate('task.update',{ id:task.id,project_id:second.id });
  assert.equal(result.kind,'waiting');
  assert.equal(result.waitingFor,'담당자');
  assert.equal(result.project_name,second.name);
  await assert.rejects(domain.mutate('task.update',{ id:task.id,title:'바뀌면 안 됨',project_id:999999 }),/프로젝트/);
  assert.equal(taskById(domain,task.id).title,'분류할 항목');
});

test('대기 재촉은 30분 중복을 합치고 직전 시각과 횟수로 되돌릴 수 있다',async t => {
  const { domain } = setup(t);
  const task = await domain.mutate('task.create',{ title:'답변 대기' });
  await assert.rejects(domain.mutate('task.nudge',{ id:task.id }),/대기/);
  await domain.mutate('task.update',{ id:task.id,kind:'waiting',waitingFor:'담당자' });
  const first = await domain.mutate('task.nudge',{ id:task.id });
  assert.equal(first.count,1);
  assert.equal(first.repeated,false);
  assert.deepEqual(first.prev,{ at:null,count:0 });
  const firstState = taskById(domain,task.id);
  const second = await domain.mutate('task.nudge',{ id:task.id });
  assert.equal(second.count,1);
  assert.equal(second.repeated,true);
  assert.equal(second.prev.at,firstState.nudgedAt);
  const revertedSecond = await domain.mutate('task.nudgeUndo',{ id:task.id,...second.prev });
  assert.equal(revertedSecond.nudgedAt,firstState.nudgedAt);
  const revertedFirst = await domain.mutate('task.nudgeUndo',{ id:task.id,...first.prev });
  assert.equal(revertedFirst.nudgedAt,null);
  assert.equal(revertedFirst.nudgeCount,0);
  await assert.rejects(domain.mutate('task.nudgeUndo',{ id:task.id,at:'invalid',count:0 }),/시각/);
  await assert.rejects(domain.mutate('task.nudgeUndo',{ id:task.id,at:null,count:-1 }),/횟수/);
});

test('프로젝트 순서·삭제 기록·복원은 재시작을 보존하며 이미 재분류한 항목은 되돌리지 않는다',async t => {
  const { domain,reopen } = setup(t);
  const alpha = await domain.mutate('project.create',{ name:'프로젝트 A' });
  const beta = await domain.mutate('project.create',{ name:'프로젝트 B' });
  await domain.mutate('project.move',{ id:beta.id,direction:'up' });
  assert.deepEqual(domain.state(range).projects.map(project => project.id),[beta.id,alpha.id]);
  const movable = await domain.mutate('task.create',{ title:'되돌릴 할 일' });
  const reclassified = await domain.mutate('task.create',{ title:'별도로 재분류한 할 일' });
  const completed = await domain.mutate('task.create',{ title:'보존할 완료 기록' });
  for (const task of [movable,reclassified,completed]) await domain.mutate('task.update',{ id:task.id,project_id:alpha.id });
  await domain.mutate('task.complete',{ id:completed.id,done:true });
  const archived = await domain.mutate('project.archive',{ id:alpha.id });
  assert.deepEqual(new Set(archived.movedItemIds),new Set([movable.id,reclassified.id]));
  assert.equal(taskById(domain,movable.id).project_id,null);
  assert.equal(taskById(domain,movable.id).kind,'inbox');
  assert.equal(taskById(domain,completed.id).project,'프로젝트 A');
  const deleted = domain.state(range).deletedProjects.find(project => project.id === alpha.id);
  assert.equal(deleted.itemCount,1);
  assert.equal(deleted.item_count,1);
  assert.ok(deleted.deletedAt);
  await domain.mutate('task.update',{ id:reclassified.id,project_id:beta.id });
  domain.close();
  const reopened = reopen();
  await reopened.mutate('project.restore',archived);
  assert.deepEqual(reopened.state(range).projects.map(project => project.id),[beta.id,alpha.id]);
  assert.equal(taskById(reopened,movable.id).project_id,alpha.id);
  assert.equal(taskById(reopened,movable.id).kind,'todo');
  assert.equal(taskById(reopened,reclassified.id).project_id,beta.id);
  assert.equal(reopened.state(range).deletedProjects.length,0);
  await assert.rejects(reopened.mutate('project.move',{ id:alpha.id,direction:'sideways' }),/방향/);
  await assert.rejects(reopened.mutate('project.restore',{ id:999999 }),/프로젝트/);
  await assert.rejects(reopened.mutate('project.restore',{ id:alpha.id,movedItemIds:'not-an-array' }),/목록/);
  await assert.rejects(reopened.mutate('project.update',{ id:alpha.id,name:beta.name }),/같은 이름/);
});

test('완료 기록 기간과 목록 밖 검색은 원본 기준을 사용하고 지난 완료·삭제 항목을 정규화해 돌려준다',async t => {
  const { domain } = setup(t);
  const project = await domain.mutate('project.create',{ name:'기록 프로젝트' });
  const recent = await domain.mutate('task.create',{ title:'최근 완료' });
  const old = await domain.mutate('task.create',{ title:'지난 완료' });
  const deleted = await domain.mutate('task.create',{ title:'삭제한 항목' });
  await domain.mutate('task.update',{ id:recent.id,project_id:project.id,note:'완료 메모' });
  await domain.mutate('task.complete',{ id:recent.id });
  await domain.mutate('task.complete',{ id:old.id });
  domain.work.patchItem(old.id,{ done_at:'2000-01-01T00:00:00.000Z' });
  await domain.mutate('task.delete',{ id:deleted.id });
  const weekly = await domain.mutate('work.history',{ days:7 });
  const monthly = await domain.mutate('work.history',{ days:30 });
  const all = await domain.mutate('work.history',{ days:null });
  assert.deepEqual(weekly.items.map(item => item.id),[recent.id]);
  assert.deepEqual(monthly.items.map(item => item.id),[recent.id]);
  assert.deepEqual(all.items.map(item => item.id),[recent.id,old.id]);
  assert.deepEqual(all.commits,[]);
  assert.equal(weekly.items[0].project_name,'기록 프로젝트');
  assert.equal(weekly.items[0].note,'완료 메모');
  assert.ok(weekly.items[0].doneAt);
  assert.equal(weekly.items[0].doneAt,weekly.items[0].done_at);
  const archive = await domain.mutate('work.archive');
  assert.deepEqual(new Set(archive.map(item => item.id)),new Set([old.id,deleted.id]));
  assert.equal(archive.find(item => item.id === old.id).done,true);
  assert.equal(archive.find(item => item.id === deleted.id).deleted,true);
  await assert.rejects(domain.mutate('work.history',{ days:0 }),/기간/);
  assert.equal(domain.state(range).tasks.some(item => item.id === deleted.id),false);
});
