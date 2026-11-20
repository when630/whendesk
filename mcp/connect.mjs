// mcp/connect.mjs — 설정 화면의 'Claude에 연결'이 클립보드에 넣는 글. Electron 없이 검증하는 순수 모듈이다.
//
// 서버는 앱 실행 파일을 ELECTRON_RUN_AS_NODE=1로 띄워 돌린다 — Node를 따로 깔 필요가 없다.
// 데이터 폴더는 인자가 아니라 환경변수로 넘긴다. Claude Code 명령에 서버 쪽 플래그(--data-dir)가 섞이면
// `--` 구분자가 필요해지는데, PowerShell·cmd·npm 셰임마다 `--`를 다루는 방식이 달라 복사한 명령이 깨질 수 있다.
import path from 'node:path';

export const SERVER_NAME = 'whendesk';

export function serverSpec({ execPath, appPath, dataDir }) {
  return {
    command: execPath,
    args: [path.join(appPath, 'mcp', 'server.mjs')],
    env: { ELECTRON_RUN_AS_NODE: '1', WHENDESK_DATA_DIR: dataDir },
  };
}

const quote = (value) => '"' + String(value).replace(/"/g, '\\"') + '"';

// Claude Code — 사용자 범위(--scope user)로 한 번 등록하면 모든 폴더에서 쓴다.
// --env 바로 뒤에 서버 이름이 오면 env 값으로 읽히므로 --transport를 사이에 둔다(Claude Code 문서).
export function claudeCodeCommand(spec) {
  const env = Object.entries(spec.env).map(([k, v]) => quote(`${k}=${v}`)).join(' ');
  return `claude mcp add --scope user --env ${env} --transport stdio ${SERVER_NAME} ${quote(spec.command)} ${spec.args.map(quote).join(' ')}`;
}

// Claude Desktop — claude_desktop_config.json의 mcpServers에 넣는 조각. 파일 전체를 덮지 않도록 조각만 준다.
export function claudeDesktopSnippet(spec) {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: { command: spec.command, args: spec.args, env: spec.env } } }, null, 2);
}
