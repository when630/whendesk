import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates, saves } from '../modules/command/main/hint.mjs';

test('지름길 후보: 짧은 것부터 — 첫 글자·초성·두 글자·낱말 첫 글자들, 셋을 넘지 않는다 (SRCH-11)', () => {
  const c = candidates('Google Chrome', ['크롬']);
  assert.equal(c[0].length, 1);
  assert.ok(c.includes('g'));
  assert.ok(c.includes('ㅋ'));
  assert.ok(c.includes('go'));
  assert.ok(c.includes('ㅋㄹ')); // 크롬의 초성 — 별칭(D-24)이 지름길이 된다
  assert.ok(c.includes('gc')); // 낱말 첫 글자들
  assert.ok(c.every((x) => x.length <= 3));
  assert.deepEqual(c, [...c].sort((a, b) => a.length - b.length)); // 길이순
});

test('지름길 후보: 한글 제목은 글자와 초성 둘 다, 중복 없이', () => {
  const c = candidates('메모 검색');
  assert.ok(c.includes('메'));
  assert.ok(c.includes('ㅁ'));
  assert.ok(c.includes('메모'));
  assert.ok(c.includes('ㅁㅁ'));
  assert.ok(c.includes('메검')); // 낱말 첫 글자들
  assert.equal(new Set(c).size, c.length);
  assert.deepEqual(candidates(''), []);
});

test('saves: 친 것보다 두 글자 이상 짧아야 힌트다', () => {
  assert.equal(saves('chrome', 'ㅋㄹ'), true);
  assert.equal(saves('chrome', 'chro'), true);
  assert.equal(saves('chrome', 'chrom'), false);
  assert.equal(saves('ㅋㄹ', 'ㅋ'), false);
  assert.equal(saves('', 'g'), false);
});
