import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = {};
vm.runInNewContext(fs.readFileSync(new URL('../renderer/rapid.js', import.meta.url), 'utf8'), context);
const { parse } = context.WhendeskRapid;
const plain = value => value && { ...value };

test('접두 기호와 빈칸으로 할 일·일정·메모를 고르고 기호를 뗀다', () => {
  assert.deepEqual(plain(parse('. 보고서 보내기')), { kind:'task', text:'보고서 보내기' });
  assert.deepEqual(plain(parse('* 보고서')), { kind:'task', text:'보고서' });
  assert.deepEqual(plain(parse('o 내일 오후 3시 치과')), { kind:'event', text:'내일 오후 3시 치과' });
  assert.deepEqual(plain(parse('ㅐ 내일 치과')), { kind:'event', text:'내일 치과' });
  assert.deepEqual(plain(parse('@ 금요일 회식')), { kind:'event', text:'금요일 회식' });
  assert.deepEqual(plain(parse('  - 회의 메모')), { kind:'note', text:'회의 메모' });
});

test('빈칸 없는 기호·기호뿐인 입력·평범한 글은 접두로 보지 않는다', () => {
  for (const value of ['-3도', '.env 고치기', 'oauth 설정', '오늘 할 일', '- ', 'o', '']) assert.equal(parse(value), null, value);
});
