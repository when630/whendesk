// 개발 renderer·엔진·저장소는 그대로 사용하고 OS 효과만 격리하는 Command E2E 진입점.
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDomain } from '../main/domain.mjs';
import { createCommand } from '../main/command.mjs';
import { createPreferences } from '../main/preferences.mjs';
import { createShortcutManager } from '../main/shortcuts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-output');
const dataArg = process.argv.find(value => value.startsWith('--data-dir='));
const dataDir = path.resolve(dataArg?.slice('--data-dir='.length) || path.join(output, 'command-profile-' + Date.now()));
if (!dataDir.toLowerCase().startsWith(output.toLowerCase() + path.sep)) throw new Error('테스트 저장소는 test-output 아래에 있어야 합니다.');
fs.mkdirSync(dataDir, { recursive:true });
app.setName('whendesk-command-test');
app.setPath('userData', path.join(dataDir, 'electron'));
app.setPath('sessionData', path.join(dataDir, 'electron', 'session'));
async function bootstrap() {
await app.whenReady();

const calls = [], messages = [], registrations = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = (type, value = {}) => calls.push({ type, ...value });
const apps = [
  ...Array.from({ length:12 }, (_,index) => ({ name:'ListSpec ' + String(index + 1).padStart(2,'0'), path:`C:\\fixture\\ListSpec-${index + 1}.lnk` })),
  { name:'ActionSpec', path:'C:\\fixture\\ActionSpec.lnk' },
  { name:'LateSpec ' + 'Alpha'.repeat(15), path:'C:\\fixture\\LateSpec-Alpha.lnk' },
  { name:'LateSpec ' + 'Bravo'.repeat(15), path:'C:\\fixture\\LateSpec-Bravo.lnk' },
];
const domain = createDomain({ dataDir });
const preferences = createPreferences(path.join(dataDir, 'preferences.json'));
const shortcutManager = createShortcutManager({
  globalShortcut:{
    register(key, handler) { record('shortcut.register', { key }); if (key === 'Control+Alt+F4' || registrations.has(key)) return false; registrations.set(key, handler); return true; },
    unregister(key) { record('shortcut.unregister', { key }); registrations.delete(key); },
  },
  handlers:{ hotkey:() => record('shortcut.command'), captureHotkey:() => record('shortcut.capture') },
});
shortcutManager.initialize(preferences.get());
nativeTheme.themeSource = preferences.get().mode;
let win, dashboardBounds = { width:1120, height:820 }, mode = 'command', commandHeightLimit = 700, commandWidth = 560;
const send = (event, value) => { if (win && !win.isDestroyed()) win.webContents.send(event, value); };
const command = createCommand({
  dataDir, domain, fileDebounceMs:20, fileTimeoutMs:2000,
  onMore:value => { messages.push(value); send('command.more', value); },
  platform:{
    listApps:async () => apps,
    scriptRunner:() => null,
    systemCommands:() => [],
    openApp:async file => { record('app.open', { file }); await delay(160); return true; },
    createFileSearch:() => ({
      ready:async () => ({ ok:true }), status:() => ({ ok:true }), dispose() {},
      async query(query) {
        record('files.query', { query });
        await delay(query === 'LateSpec' ? 500 : query === 'OldSpec' ? 180 : query.startsWith('PendingSpec') ? 350 : 40);
        if (query === 'LateSpec') return [{ name:'LateSpec', path:'C:\\fixture\\LateSpec.txt', isDir:false }];
        if (query === 'OldSpec') return [{ name:'OldSpec', path:'C:\\fixture\\OldSpec.txt', isDir:false }];
        if (query.startsWith('PendingSpec')) return [{ name:query, path:`C:\\fixture\\${query}.txt`, isDir:false }];
        return [];
      },
    }),
  },
  effects:{
    clipboard:{ writeText:text => record('clipboard.copy', { text }) },
    shell:{ openPath:async file => { record('path.open', { file }); await delay(100); return ''; }, showItemInFolder:file => record('path.reveal', { file }) },
    dialog:{ showMessageBox:async () => { throw new Error('테스트에서 OS 확인 대화상자를 열 수 없습니다.'); } },
  },
});
await command.ready();

function shell(payload = {}) {
  if (payload.mode === 'dashboard') {
    mode = 'dashboard'; win.setBounds(dashboardBounds);
  } else {
    if (mode === 'dashboard') dashboardBounds = win.getBounds();
    mode = 'command'; win.setBounds({ width:commandWidth, height:Math.min(commandHeightLimit, Math.max(54, Number(payload.height) || 54)) });
  }
  return { mode };
}
const methods = {
  state:payload => domain.state(payload || {}),
  mutate:async payload => { const value = await domain.mutate(payload.type, payload.payload || {}); send('state.changed', {}); return value; },
  'command.query':payload => { record('command.query', { query:payload.q, seq:payload.seq }); return command.query(payload.q, payload.seq); },
  'command.run':async payload => { record('command.run', payload); const result = await command.run(payload.key, payload.actionId, { query:payload.query }); if (result?.route) send('state.changed', {}); return result; },
  'command.refresh':() => command.refresh(),
  shell,
  'preferences.get':() => preferences.get(),
  'preferences.set':payload => {
    const patch = payload || {};
    const next = Object.hasOwn(patch,'hotkey') || Object.hasOwn(patch,'captureHotkey')
      ? shortcutManager.update({ ...preferences.get(), ...patch }, values => preferences.set({ ...patch, hotkey:values.hotkey, captureHotkey:values.captureHotkey }))
      : preferences.set(patch);
    nativeTheme.themeSource = next.mode; return next;
  },
  'update.state':() => ({ status:'unsupported', line:'버전 development-test — 업데이트 확인은 설치본에서만', supported:false }),
  'update.check':() => ({ status:'unsupported', line:'버전 development-test — 업데이트 확인은 설치본에서만', supported:false }),
  'update.install':() => ({ installing:false }),
  'app.info':() => ({ name:'WHENDESK', version:'development-test', dataDir, ...shortcutManager.status(), commandReady:true, commandFailure:null, platform:process.platform, isPackaged:false }),
  'media.state':() => ({ available:false, sessions:[] }),
  'media.control':payload => { record('media.control',payload); return true; },
  'window.close':() => { record('window.hide'); return true; },
  'window.minimize':() => { record('window.minimize'); return true; },
  'app.quit':() => app.quit(),
};
ipcMain.handle('desk:call', async (_event, method, payload) => {
  try { if (!Object.hasOwn(methods, method)) throw new Error('테스트에서 허용하지 않는 요청입니다: ' + method); return { ok:true, value:await methods[method](payload) }; }
  catch (error) { return { ok:false, error:error.message, ...(error.fields ? { fields:error.fields } : {}) }; }
});

globalThis.__commandTest = {
  calls, messages, dataDir, registrations, emitMore:message => send('command.more', message), emitMedia:value => send('media.changed',value),
  setCommandWidth(width) {
    if (![360,560].includes(width)) throw new Error('테스트 창 너비는 360 또는 560만 허용합니다.');
    commandWidth = width;
    if (mode === 'command') return shell({ mode:'command', height:win.getBounds().height });
    return { mode };
  },
  setCommandHeightLimit(height) {
    if (![320,700].includes(height)) throw new Error('테스트 창 높이 제한은 320 또는 700만 허용합니다.');
    commandHeightLimit = height;
    if (mode === 'command') return shell({ mode:'command', height });
    return { mode };
  },
};
win = new BrowserWindow({
  width:560, height:54, frame:false, thickFrame:false, show:true, title:'WHENDESK Command 개발 검증',
  webPreferences:{ preload:path.join(root,'main','preload.cjs'), contextIsolation:true, sandbox:true, nodeIntegration:false },
});
win.setMenu(null);
win.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
await win.loadURL(pathToFileURL(path.join(root,'renderer','index.html')).href);
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { shortcutManager.dispose(); command.close(); domain.close(); });
}
bootstrap().catch(error => { console.error(error); app.exit(1); });
