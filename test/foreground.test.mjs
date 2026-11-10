import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createForeground, handleText, HELPER_SCRIPT } from '../main/foreground.mjs';

function fakeSpawn(calls) {
  return (cmd, args) => {
    const child = new EventEmitter(), written = [];
    child.stdin = { writable: true, write: text => written.push(text), end() {} };
    child.stdout = new EventEmitter();
    child.kill = () => {};
    calls.push({ cmd, args, written });
    return child;
  };
}

test('창 핸들 Buffer를 10진 문자열로 바꾼다', () => {
  const buf = Buffer.alloc(8); buf.writeBigUInt64LE(123456789n);
  assert.equal(handleText(buf), '123456789');
  assert.equal(handleText(Buffer.alloc(0)), '');
  assert.equal(handleText(null), '');
});

test('도우미는 한 번만 띄우고 창 핸들을 한 줄씩 넘긴다', () => {
  const calls = [];
  const fg = createForeground({ platform: 'win32', spawn: fakeSpawn(calls) });
  const buf = Buffer.alloc(8); buf.writeBigUInt64LE(42n);
  assert.equal(fg.bring(buf), true);
  assert.equal(fg.bring(buf), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'powershell');
  assert.deepEqual(calls[0].written, ['42\n', '42\n']);
});

test('Windows가 아니면 아무것도 띄우지 않는다', () => {
  const calls = [];
  const fg = createForeground({ platform: 'darwin', spawn: fakeSpawn(calls) });
  assert.equal(fg.bring(Buffer.alloc(8, 1)), false);
  assert.equal(calls.length, 0);
});

test('도우미 스크립트는 ASCII만 쓴다(PowerShell 5.1이 BOM 없는 UTF-8을 cp949로 읽는다)', () => {
  assert.ok(/^[\x00-\x7f]*$/.test(HELPER_SCRIPT));
  assert.match(HELPER_SCRIPT, /SetForegroundWindow/);
  assert.match(HELPER_SCRIPT, /AttachThreadInput/);
});
