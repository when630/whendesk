import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const context = {};
vm.runInNewContext(read('keymap.js'), context);
const K = context.WhendeskKeys;
const sources = read('app.js') + read('notes.js');
const key = (code, extra = {}) => ({ code, key:extra.key ?? '', ctrlKey:false, metaKey:false, altKey:false, shiftKey:false, ...extra });

test('키맵 동작 id는 모두 렌더러에서 쓰이고, 렌더러가 판정하는 id는 모두 키맵에 있다', () => {
  const ids = new Set(K.ACTIONS.map(action => action.id));
  const unused = [...K.ACTIONS].filter(action => !action.section && !sources.includes(`'${action.id}'`)).map(action => action.id);
  assert.deepEqual(unused, [], '쓰이지 않는 키맵 항목');
  const judged = [...sources.matchAll(/K\.is\(event,\s*'([^']+)'\)/g)].map(match => match[1]);
  assert.ok(judged.length > 40);
  assert.deepEqual(judged.filter(id => !ids.has(id)), [], '키맵에 없는 동작 id');
  assert.throws(() => K.is(key('KeyA'), 'no.such.action'), /키맵에 없는 동작/);
});

test('물리 키·수식키를 정확히 판정하고 한글 입력 상태에서도 같은 동작으로 읽는다', () => {
  assert.ok(K.is(key('Slash', { key:'/', ctrlKey:true }), 'help.toggle'));
  assert.ok(K.is(key('KeyK', { key:'ㅏ', ctrlKey:true }), 'command.open'), '한글 자판의 Ctrl+K');
  assert.ok(K.is(key('KeyK', { key:'k', metaKey:true }), 'command.open'), '⌘도 Mod');
  assert.equal(K.is(key('KeyK', { key:'k', ctrlKey:true, shiftKey:true }), 'command.open'), false, '적지 않은 수식키는 거부');
  assert.equal(K.section(key('KeyH', { key:'ㅗ', altKey:true })), 'dashboard');
  assert.equal(K.section(key('KeyH', { key:'h' })), null);
  assert.ok(K.is(key('Tab', { key:'Tab', shiftKey:true }), 'work.tab.cycle'));
  assert.ok(K.is(key('Escape', { key:'Escape', ctrlKey:true, shiftKey:true }), 'back'), '?수식키는 눌려도 된다');
  assert.ok(K.is(key('Enter', { key:'Enter', shiftKey:true }), 'command.run'));
  assert.equal(K.is(key('Enter', { key:'Enter', ctrlKey:true }), 'command.run'), false);
  assert.ok(K.is(key('NumpadEnter', { key:'Enter' }), 'task.open'), '숫자패드 Enter도 Enter');
  assert.ok(K.is(key('Space', { key:' ' }), 'task.complete'));
});

test('안내 표기는 Windows 키캡 표기로 만들고 숫자 할당을 포함하지 않는다', () => {
  assert.equal(K.format('help.toggle'), 'Ctrl + /');
  assert.equal(K.format('project.new'), 'Ctrl + Shift + N');
  assert.equal(K.format('list.up'), '↑ · K');
  assert.equal(K.format('back'), 'Esc');
  assert.equal(K.format('command.run'), 'Enter');
  assert.equal(K.format('task.assign'), '1 ~ 9', '프로젝트 바로 지정은 원본 WHENWORK의 숫자 키를 쓴다');
  // 숫자 키는 프로젝트 바로 지정 한 줄에만 허용한다.
  const shown = [...K.HELP].flatMap(group => [...group.rows].flatMap(([, ids]) => [...ids].filter(id => id !== 'task.assign').map(K.format)));
  assert.deepEqual(shown.filter(text => /\d/.test(text)), []);
});

function overlaps(a, b) {
  for (const x of a.keys.map(K.parse)) for (const y of b.keys.map(K.parse)) {
    const sameKey = x.key === y.key || x.key.toLowerCase() === `key${y.key}`.toLowerCase() || y.key.toLowerCase() === `key${x.key}`.toLowerCase();
    if (sameKey && Object.keys(x.mods).every(name => x.mods[name] === null || y.mods[name] === null || x.mods[name] === y.mods[name])) return true;
  }
  return false;
}

test('한 화면에서 동시에 키를 받는 범위끼리는 같은 키를 두 동작이 쓰지 않는다(알려진 짝만 예외)', () => {
  const known = new Set(K.KNOWN_OVERLAPS.map(pair => [...pair].sort().join('|')));
  const scopes = new Set(K.ACTIONS.map(action => action.scope));
  for (const scope of scopes) if (scope !== 'global') assert.ok(K.CONCURRENT.some(group => group.includes(scope)), `묶음에 없는 범위: ${scope}`);
  const conflicts = new Set();
  for (const group of K.CONCURRENT) {
    const actions = K.ACTIONS.filter(action => action.scope === 'global' || group.includes(action.scope));
    for (let i = 0; i < actions.length; i++) for (let j = i + 1; j < actions.length; j++) {
      const pair = [actions[i].id, actions[j].id].sort().join('|');
      if (!known.has(pair) && overlaps(actions[i], actions[j])) conflicts.add(pair);
    }
  }
  assert.deepEqual([...conflicts], []);
  for (const pair of known) { const [a, b] = pair.split('|').map(K.find); assert.ok(overlaps(a, b), `이미 해소된 짝은 목록에서 지운다: ${pair}`); }
});
