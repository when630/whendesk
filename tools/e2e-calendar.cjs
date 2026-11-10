/* 캘린더 일정 추가·수정·삭제를 실제 main·격리 프로필에서 키보드로 검증한다(원본 WHENCALENDAR 흐름).
 * - 한 줄 입력: 머리말·바닥 안내, 해석 요약(시작–종료·종일·여러 날), ＊ 짚은 점, 초안은 Esc 두 번에 닫힘
 * - 자정을 넘는 일정: 한 줄로 추가, 다음 날에도 보임, 폼에서 저장 가능
 * - Ctrl+Enter로 넘긴 여러 날 종일 일정이 폼에서 그대로 저장됨
 * - 폼에서 시작을 옮기면 종료가 길이를 지켜 따라옴
 * - E 제목 한 줄 · D 날짜·시각 한 줄(원본 dlgMode title·when), 반복 일정은 범위를 묻는다
 * - 반복 일정: 편집 범위 기본값 '이 회차만', X는 3지선다(1 이 회차만)
 * desk API는 조회와 날짜 계산에만 쓴다. 사용자 앱·실제 데이터·전역 단축키는 건드리지 않는다. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron:electron } = require('C:/Users/forcs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname,'..');
const runId = String(Date.now());
const output = path.join(root,'test-output');
const dataDir = path.join(output,'calendar-profile-'+runId);
const shots = path.join(output,'calendar-shots',runId);
fs.mkdirSync(shots,{recursive:true});
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.WHENDESK_TEST_PACKAGED === '1';
const results = [], errors = [], screenshots = [];
let app, page, failure = null;
const measurements = {};
const call = (method,payload) => page.evaluate(({method,payload})=>window.desk.call(method,payload),{method,payload});
const events = async () => (await call('state',{})).events;
const press = key => page.keyboard.press(key);
const text = value => page.keyboard.insertText(value);
const go = section => page.evaluate(section=>window.__whendeskGo(section),section);
async function waitUntil(predicate,message){const deadline=Date.now()+12000;do{if(await predicate())return;await page.waitForTimeout(35);}while(Date.now()<deadline);assert.fail(message);}
async function screenshot(name){const file=path.join(shots,name+'.png');await page.screenshot({path:file});screenshots.push(file);}
async function test(name,action){const start=Date.now();try{await action();results.push({name,ok:true,durationMs:Date.now()-start});}catch(error){results.push({name,ok:false,durationMs:Date.now()-start,error:error.message});throw error;}}
const preview = () => page.locator('.quick-event-preview').innerText();
const modalOpen = selector => page.evaluate(selector=>!document.querySelector('.td-modal-layer, [data-modal-layer]')?.hidden&&!!document.querySelector(selector),selector);
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const plusDays = days => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+days); return d; };
async function openQuick(){
  await go('calendar');
  await waitUntil(()=>page.evaluate(()=>!!document.activeElement?.closest('.td-main')),'캘린더에 포커스가 없습니다.');
  await press('n');await page.locator('.quick-event-form input').waitFor();
}

(async()=>{
  try{
    app=await electron.launch({executablePath:process.env.WHENDESK_TEST_EXECUTABLE||'D:/when630/whencommand/node_modules/electron/dist/electron.exe',args:[...(packaged?[]:[root]),'--test','--no-media','--data-dir='+dataDir],env,timeout:30000});
    page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>window.desk?.call&&typeof window.__whendeskGo==='function');

    await test('한 줄 입력: 원본 머리말·바닥 안내와 해석 요약, ＊ 짚은 점은 글로 보인다',async()=>{
      await openQuick();
      assert.match(await page.locator('.quick-event-label').innerText(),/한 줄로 적으세요/);
      assert.match(await page.locator('.quick-event-foot').innerText(),/Enter[\s\S]*등록[\s\S]*Esc[\s\S]*취소/);
      await text('9시 아침 점검');
      await waitUntil(async()=>/:00 – /.test(await preview()),'시작–종료 요약이 보이지 않습니다: '+await preview().catch(()=>''));
      const shown = await preview();
      assert.ok(!/object Object/.test(shown),'미리보기에 [object Object]가 보입니다: '+shown);
      assert.match(shown,/아침 점검/);
      await screenshot('01-quick-preview');
    });

    await test('초안이 있는 한 줄 입력은 Esc를 한 번 더 눌러야 닫힌다(WHENDESK 대화상자 규칙)',async()=>{
      await press('Escape');assert.equal(await modalOpen('.quick-event-form'),true,'초안을 Esc 한 번에 버렸습니다.');
      await press('Escape');
      await waitUntil(async()=>!(await modalOpen('.quick-event-form')),'Esc 두 번에 한 줄 입력이 닫히지 않았습니다.');
    });

    await test('제목이 없으면 그 이유를 말한다',async()=>{
      await openQuick();await text('내일 3시');
      await waitUntil(async()=>/제목이 없습니다/.test(await preview()),'제목 없음 안내가 없습니다: '+await preview().catch(()=>''));
      await press('Escape');await press('Escape');
    });

    const late = plusDays(2), lateKey = dayKey(late), nextKey = dayKey(plusDays(3));
    await test('자정을 넘는 일정: 한 줄로 추가하고 다음 날에도 보인다',async()=>{
      await openQuick();await text(`${late.getMonth()+1}월 ${late.getDate()}일 23시 야간 배포 2시간`);
      await waitUntil(async()=>/23:00 – 01:00/.test(await preview()),'자정 넘김 요약이 다릅니다: '+await preview().catch(()=>''));
      await press('Enter');
      await waitUntil(async()=>(await events()).some(e=>e.title==='야간 배포'),'일정이 추가되지 않았습니다.');
      const item=(await events()).find(e=>e.title==='야간 배포');
      assert.equal(Date.parse(item.endsAt)-Date.parse(item.startsAt),2*3600e3);
      // 다음 날(이어지는 날) 칸에도 세어진다 — 월 격자는 창이 좁으면 숨지만 그려져 있다.
      const label=await page.evaluate(key=>document.querySelector(`.td-calendar-side [data-date="${key}"]`)?.getAttribute('aria-label')||null,nextKey);
      if(label)assert.match(label,/일정 1개/,'다음 날 칸에 자정 넘김 일정이 세어지지 않았습니다: '+label);
      measurements.nextDayLabel=label;
    });

    await test('폼: 시작을 옮기면 종료가 따라오고, 자정을 넘는 종료도 저장된다',async()=>{
      // 한 줄로 추가하면 그 날짜 목록으로 옮겨 새 일정에 포커스를 둔다.
      await waitUntil(()=>page.evaluate(()=>!!document.activeElement?.closest('.td-main [data-event]')&&document.activeElement.textContent.includes('야간 배포')),'추가한 일정에 포커스가 없습니다.');
      await press('Enter');await page.locator('.event-form').waitFor();
      const value = name => page.locator(`.event-form [name=${name}]`).inputValue();
      assert.equal(await value('time'),'23:00');assert.equal(await value('end'),'01:00');assert.equal(await value('endDate'),nextKey);
      await page.evaluate(()=>{const f=document.querySelector('.event-form [name=time]');f.value='21:00';f.dispatchEvent(new Event('change',{bubbles:true}));});
      assert.equal(await value('end'),'23:00','시작을 옮겼는데 종료가 따라오지 않았습니다.');assert.equal(await value('endDate'),lateKey);
      await page.evaluate(next=>{const d=document.querySelector('.event-form [name=endDate]'),e=document.querySelector('.event-form [name=end]');d.value=next;e.value='00:30';d.dispatchEvent(new Event('input',{bubbles:true}));},nextKey);
      await screenshot('02-form-overnight');
      await press('Control+s');
      await waitUntil(async()=>{const item=(await events()).find(e=>e.title==='야간 배포');return item&&new Date(item.startsAt).getHours()===21&&Date.parse(item.endsAt)-Date.parse(item.startsAt)===3.5*3600e3;},'21:00 → 다음 날 00:30으로 저장되지 않았습니다.');
    });

    await test('Ctrl+Enter로 넘긴 여러 날 종일 일정은 폼에서 그대로 저장된다',async()=>{
      const from=plusDays(4),to=plusDays(6);
      await openQuick();await text(`${from.getMonth()+1}월 ${from.getDate()}일부터 ${to.getMonth()+1}월 ${to.getDate()}일까지 워크숍`);
      await waitUntil(async()=>/종일/.test(await preview()),'여러 날 종일 요약이 없습니다: '+await preview().catch(()=>''));
      await press('Control+Enter');await page.locator('.event-form').waitFor();
      assert.equal(await page.locator('.event-form [name=allDay]').isChecked(),true);
      assert.equal(await page.locator('.event-form [name=endDate]').inputValue(),dayKey(to),'종료 날짜(마지막 날)가 넘어오지 않았습니다.');
      assert.equal(await page.locator('.event-form [name=time]').isDisabled(),true,'종일인데 시각 칸이 켜져 있습니다.');
      await press('Control+s');
      await waitUntil(async()=>{const item=(await events()).find(e=>e.title==='워크숍');return item&&item.allDay&&dayKey(new Date(item.endsAt))===dayKey(plusDays(7));},'여러 날 종일 일정이 하루짜리로 저장됐습니다.');
    });

    await test('E는 제목만 한 줄로 고치고(U로 되돌림), D는 제목을 두고 날짜·시각만 한 줄로 옮긴다',async()=>{
      await openQuick();await text('내일 오후 2시 덱 점검');
      await waitUntil(async()=>/14:00 – 15:00/.test(await preview()),'추가 미리보기가 없습니다.');
      await press('Enter');
      await waitUntil(()=>page.evaluate(()=>!!document.activeElement?.closest('.td-main [data-event]')&&document.activeElement.textContent.includes('덱 점검')),'추가한 일정에 포커스가 없습니다.');
      await press('e');await page.locator('.line-edit-form[data-mode=title]').waitFor();
      assert.equal(await page.locator('.line-edit-form [name=line]').inputValue(),'덱 점검','E 입력줄에 지금 제목이 없습니다.');
      await press('Control+a');await text('덱 점검 다시');await press('Enter');
      await waitUntil(async()=>(await events()).some(e=>e.title==='덱 점검 다시'),'E로 제목을 바꾸지 못했습니다.');
      await waitUntil(()=>page.evaluate(()=>document.activeElement?.textContent?.includes('덱 점검 다시')),'제목을 바꾼 뒤 그 일정에 포커스가 없습니다.');
      await press('u');await waitUntil(async()=>(await events()).some(e=>e.title==='덱 점검'),'U로 제목 변경을 되돌리지 못했습니다.');
      await waitUntil(()=>page.evaluate(()=>{const row=[...document.querySelectorAll('.td-main [data-event]')].find(row=>row.textContent.includes('덱 점검'));row?.focus();return document.activeElement===row&&!!row;}),'일정 행에 다시 포커스를 두지 못했습니다.');
      const moved=plusDays(2);
      await press('d');await page.locator('.line-edit-form[data-mode=when]').waitFor();
      await text(`${moved.getMonth()+1}월 ${moved.getDate()}일 오후 4시 1시간`);
      await waitUntil(async()=>/16:00 – 17:00/.test(await page.locator('.line-edit-form .quick-event-preview').innerText()),'옮기기 미리보기가 다릅니다: '+await page.locator('.line-edit-form .quick-event-preview').innerText().catch(()=>''));
      await screenshot('04-line-move');
      await press('Enter');
      await waitUntil(async()=>{const item=(await events()).find(e=>e.title==='덱 점검');return item&&item.date===dayKey(moved)&&new Date(item.startsAt).getHours()===16&&Date.parse(item.endsAt)-Date.parse(item.startsAt)===60*60e3;},'D로 날짜·시각을 옮기지 못했습니다(제목 유지).');
      await waitUntil(()=>page.evaluate(()=>document.activeElement?.textContent?.includes('덱 점검')),'옮긴 뒤 그 일정에 포커스가 없습니다.');
    });

    await test('반복 일정: 편집 범위 기본은 이 회차만, X는 3지선다로 묻고 1이면 그 회차만 지운다',async()=>{
      await openQuick();await text('매일 7시 아침 운동');
      await waitUntil(async()=>/매일/.test(await preview()),'반복 요약이 없습니다: '+await preview().catch(()=>''));
      await press('Enter');
      await waitUntil(async()=>(await events()).filter(e=>e.title==='아침 운동').length>3,'반복 일정이 펼쳐지지 않았습니다.');
      const before=(await events()).filter(e=>e.title==='아침 운동').length;
      await waitUntil(async()=>page.evaluate(()=>{const row=[...document.querySelectorAll('.td-main [data-event], .td-calendar-side [data-event]')].find(row=>row.textContent.includes('아침 운동'));row?.focus();return document.activeElement===row&&!!row;}),'반복 일정 행에 포커스를 두지 못했습니다.');
      await press('Enter');await page.locator('.event-form [name=scope]').waitFor();
      assert.equal(await page.locator('.event-form [name=scope]').inputValue(),'one','반복 일정 편집 범위 기본값이 이 회차만이 아닙니다.');
      await press('Escape');await waitUntil(async()=>!(await modalOpen('.event-form')),'폼이 닫히지 않았습니다.');
      await page.evaluate(()=>[...document.querySelectorAll('.td-main [data-event], .td-calendar-side [data-event]')].find(row=>row.textContent.includes('아침 운동'))?.focus());
      await press('e');await page.locator('.line-edit-form[data-mode=title]').waitFor();await press('Control+a');await text('아침 달리기');await press('Enter');
      await page.locator('.scope-form').waitFor();assert.match(await page.locator('.scope-form').innerText(),/바꾸기/);
      await press('1');
      await waitUntil(async()=>{const list=await events();return list.filter(e=>e.title==='아침 달리기').length===1&&list.filter(e=>e.title==='아침 운동').length===before-1;},'반복 일정의 이 회차만 제목이 바뀌지 않았습니다.');
      // 이름을 바꾼 회차는 제외하고 남은 '아침 운동' 회차로 삭제를 검증한다.
      const remaining=(await events()).filter(e=>e.title==='아침 운동').length;
      // 이름을 바꾼 회차의 날에는 '아침 운동'이 없다. 다음 날(→)로 넘겨 그 회차를 고른다.
      await press('ArrowRight');
      await waitUntil(()=>page.evaluate(()=>{const row=[...document.querySelectorAll('.td-main [data-event]')].find(row=>row.textContent.includes('아침 운동'));row?.focus();return !!row&&document.activeElement===row;}),'다음 날의 반복 회차에 포커스를 두지 못했습니다.');
      await press('x');await page.locator('.scope-form').waitFor();
      assert.equal(await page.evaluate(()=>document.activeElement?.dataset.scope),'one','3지선다 커서가 이 회차만에서 시작하지 않습니다.');
      await screenshot('03-scope-chooser');
      await press('1');
      await waitUntil(async()=>(await events()).filter(e=>e.title==='아침 운동').length===remaining-1,'이 회차만 지워지지 않았습니다.');
      assert.equal(await page.locator('.td-feedback [data-action=undo]').isVisible().catch(()=>false),false,'되돌릴 수 없는 회차 삭제에 되돌리기가 보입니다.');
    });

    assert.equal(errors.length,0,errors.join('\n'));
  }catch(error){failure=error.stack||String(error);if(page&&!page.isClosed())await screenshot('failure').catch(()=>{});}
  finally{
    try{if(app){await page?.evaluate(()=>window.__whendeskFlush?.()).catch(()=>{});await app.close().catch(()=>{});}}catch{}
    const report={results,errors,failure,measurements,dataDir,packaged,screenshots};
    fs.writeFileSync(path.join(output,'e2e-calendar.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(failure||errors.length)process.exitCode=1;
  }
})();
