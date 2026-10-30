/* 빌드에 쓸 Electron Windows 런타임 폴더를 찾는다. 네트워크에서 내려받지 않는다.
 * 순서: WHENDESK_ELECTRON_DIST → 이 프로젝트의 node_modules/electron/dist → 같은 PC의 WHENCOMMAND 런타임.
 * node_modules의 electron은 ELECTRON_SKIP_BINARY_DOWNLOAD로 설치돼 실행 파일이 없을 수 있으므로 실제 파일로 고른다. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

export function electronRuntime() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.WHENDESK_ELECTRON_DIST];
  try { candidates.push(path.join(path.dirname(require.resolve('electron/package.json')), 'dist')); } catch {}
  candidates.push('D:/when630/whencommand/node_modules/electron/dist');
  for (const dir of candidates.filter(Boolean)) {
    if (fs.existsSync(path.join(dir, 'electron.exe')) && fs.existsSync(path.join(dir, 'version'))) {
      return { dir:path.resolve(dir), version:fs.readFileSync(path.join(dir, 'version'), 'utf8').trim().replace(/^v/, '') };
    }
  }
  throw new Error('Electron Windows 런타임을 찾을 수 없습니다. WHENDESK_ELECTRON_DIST에 electron.exe가 있는 폴더를 지정하세요.');
}
