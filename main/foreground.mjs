// Windows에서 다른 프로세스가 앞에 있을 때 WHENDESK 창을 앞으로 가져온다.
//
// Windows는 키 입력을 받지 않은 프로세스의 SetForegroundWindow를 거절한다(전경 잠금). 덱 키처럼
// 백그라운드 HTTP로 들어온 요청은 그래서 focus()가 먹지 않고 창이 다른 창 뒤에 남는다.
// Electron에는 Windows용 우회가 없다(app.focus의 steal은 macOS 전용).
//
// 상주 PowerShell 도우미 하나가 창 핸들을 받아: 아무 앱도 쓰지 않는 F24 키를 한 번 넣어 자신이
// "마지막 입력을 받은 프로세스"가 되고, 앞 창의 입력 스레드에 잠깐 붙어 SetForegroundWindow를 부른다.
// 첫 컴파일(Add-Type)이 1초 남짓 걸리므로 미리 띄워 둔다. 스크립트는 ASCII만 쓴다(PowerShell 5.1 인코딩).
import { spawn as nodeSpawn } from 'node:child_process';

export const HELPER_SOURCE = `
using System;
using System.Runtime.InteropServices;
public static class WdForeground {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static bool Bring(IntPtr h) {
    if (GetForegroundWindow() == h) return true;
    keybd_event(0x87, 0, 0, UIntPtr.Zero);
    keybd_event(0x87, 0, 2, UIntPtr.Zero);
    if (IsIconic(h)) ShowWindow(h, 9);
    IntPtr fg = GetForegroundWindow();
    uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero), me = GetCurrentThreadId();
    bool attached = fg != IntPtr.Zero && fgThread != me && AttachThreadInput(me, fgThread, true);
    BringWindowToTop(h);
    bool ok = SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fgThread, false);
    return ok;
  }
}
`;

export const HELPER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `Add-Type -TypeDefinition @'${HELPER_SOURCE}'@`,
  "[Console]::Out.WriteLine('ready')",
  'while ($null -ne ($line = [Console]::In.ReadLine())) {',
  '  try { $ok = [WdForeground]::Bring([IntPtr][long]$line); [Console]::Out.WriteLine($(if ($ok) { "ok" } else { "no" })) }',
  "  catch { [Console]::Out.WriteLine('error') }",
  '}',
].join('\n');

/** 창 핸들 Buffer(getNativeWindowHandle) → 10진 문자열. */
export function handleText(handle) {
  if (!Buffer.isBuffer(handle) || !handle.length) return '';
  return handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : String(handle.readUInt32LE(0));
}

/**
 * 도우미를 띄우고 bring(handle)을 돌려준다. Windows가 아니거나 띄우지 못하면 bring은 false를 돌려주는 빈 동작이다.
 * spawn은 테스트에서 바꿔 끼운다.
 */
export function createForeground({ platform = process.platform, spawn = nodeSpawn, log = () => {} } = {}) {
  let child = null, failed = platform !== 'win32';
  function start() {
    if (child || failed) return;
    try {
      child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(HELPER_SCRIPT, 'utf16le').toString('base64')],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      child.on('error', error => { log('전경 도우미:', error.message); child = null; failed = true; });
      child.on('exit', () => { child = null; });
      child.stdout?.on('data', () => {});
    } catch (error) { log('전경 도우미:', error.message); child = null; failed = true; }
  }
  return {
    start,
    bring(handle) {
      const text = handleText(handle);
      if (!text) return false;
      start();
      if (!child?.stdin?.writable) return false;
      child.stdin.write(text + '\n');
      return true;
    },
    stop() { try { child?.stdin?.end(); child?.kill(); } catch {} child = null; },
  };
}
