/* NSIS 설치본과 자동 업데이트용 latest.yml을 만든다(형제 앱과 같은 electron-builder 방식).
 * Electron 런타임은 내려받지 않고 tools/electron-runtime.mjs가 찾은 폴더를 쓴다. 게시는 하지 않는다(--publish never와 같음).
 * 결과: dist/installer/WHENDESK-<version>-win-x64.exe · .exe.blockmap · latest.yml → GitHub 릴리스에 함께 올린다. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build, Platform, Arch} from 'electron-builder';
import {electronRuntime} from './electron-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'installer.json'), 'utf8'));
const runtime = electronRuntime();
const result = await build({
  projectDir:root,
  targets:Platform.WINDOWS.createTarget('nsis', Arch.x64),
  publish:'never',
  config:{ ...config, electronDist:runtime.dir, electronVersion:runtime.version },
});
console.log(JSON.stringify({ electron:runtime.version, artifacts:result.map(file => path.relative(root, file)) }));
