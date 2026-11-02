import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyClipboard, brief, MAX_TEXT } from '../modules/command/main/clip.mjs';

test('클립보드: URL·존재하는 경로·글로 가른다. 비었거나 너무 길면 null (PANEL-13)', () => {
  assert.deepEqual(classifyClipboard('  https://github.com/when630/whencommand  '), { kind: 'url', value: 'https://github.com/when630/whencommand' });
  assert.deepEqual(classifyClipboard('C:\\Users\\me\\a.txt', (p) => p.endsWith('a.txt')), { kind: 'path', value: 'C:\\Users\\me\\a.txt' });
  assert.deepEqual(classifyClipboard('C:\\Users\\me\\없음.txt', () => false).kind, 'text'); // 없는 경로는 그냥 글이다
  assert.deepEqual(classifyClipboard('/Users/me/doc.md', (p) => p === '/Users/me/doc.md').kind, 'path');
  assert.deepEqual(classifyClipboard('담주 화 3시\r\n  김부장 미팅'), { kind: 'text', value: '담주 화 3시 김부장 미팅' }); // 줄바꿈은 한 칸으로
  assert.equal(classifyClipboard(''), null);
  assert.equal(classifyClipboard('   \n  '), null);
  assert.equal(classifyClipboard('x'.repeat(MAX_TEXT + 1)), null);
  assert.equal(classifyClipboard(null), null);
});

test('클립보드: 여러 줄이면 URL·경로가 아니다 — 글이다', () => {
  assert.equal(classifyClipboard('https://a.com\nhttps://b.com').kind, 'text');
  assert.equal(classifyClipboard('C:\\a\nC:\\b', () => true).kind, 'text');
});

test('brief: 부제 한 줄 요약', () => {
  assert.equal(brief('짧다'), '짧다');
  assert.equal(brief('a'.repeat(100), 10), 'aaaaaaaaa…');
});
