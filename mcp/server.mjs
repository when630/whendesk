// mcp/server.mjs — WHENDESK의 할 일·일정·메모를 Claude(Claude Code·Claude Desktop)가 읽게 하는 stdio MCP 서버.
// 읽기 전용이다. 실행: WHENDESK.exe를 ELECTRON_RUN_AS_NODE=1로 띄워 이 파일을 넘긴다(개발 중에는 node로도 된다).
//
//   옵션  --data-dir <폴더>        데이터 폴더(기본: %APPDATA%\whendesk, 환경변수 WHENDESK_DATA_DIR)
//         --include-archived       보관한 메모도 보이게 한다
//         --include-attachments    메모의 첨부파일 이름도 보이게 한다(내용은 보내지 않는다)
//
// stdout은 프로토콜 전용이다. 사람에게 남길 말은 stderr로만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { createReader, defaultDataDir } from './read.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));

function option(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

const INSTRUCTIONS = `WHENDESK는 사용자의 개인 불릿 저널 앱이다. 이 서버는 그 데이터를 읽기만 한다(추가·수정·완료 처리는 할 수 없다).
- 할 일 종류: inbox(아직 분류 안 함), todo(할 일), waiting(남에게 맡기고 기다리는 일 — waitingFor가 상대). note는 한 줄 메모, 일정은 별도 도구(list_events).
- 상태: open(열림) / done(완료) / cancelled(취소). postponed는 마감을 뒤로 민 횟수, nudgeCount는 재촉한 횟수.
- 마감(due)은 로컬 날짜 YYYY-MM-DD. "넘길 일(carryOver)"은 마감이 지났는데 아직 열린 일이다.
- "오늘 뭐 해야 해?" 같은 질문은 today를 먼저 부른다. 긴 메모는 search_notes로 찾고 get_note로 본문을 읽는다.
- 메모 검색어: 3글자 이상은 전문 검색, 1~2글자는 부분 일치, 초성만 쓰면(ㅎㅇ) 초성 검색, #태그는 태그 필터.`;

export function createServer(reader) {
  const server = new McpServer({ name: 'whendesk', version: pkg.version }, { instructions: INSTRUCTIONS });
  const READ = { readOnlyHint: true, openWorldHint: false };
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
  const reply = (fn) => async (args) => {
    try {
      const value = await fn(args ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(value ?? null, null, 1) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err?.message ?? err) }], isError: true };
    }
  };
  const notFound = (what) => (value) => value ?? { notFound: true, message: `${what}을(를) 찾지 못했습니다. 지웠거나 보이지 않게 설정된 항목일 수 있습니다.` };

  server.registerTool('today', {
    title: '오늘 저널',
    description: 'WHENDESK 대시보드와 같은 하루치 저널: 넘길 일(지난 마감), 그날 일정, 오늘 마감, 대기, 다가오는 마감, 마감 없는 할 일, 그날 적은 한 줄 메모, 그날 마친 일, InBox 건수.',
    inputSchema: z.object({ date: day.optional().describe('보고 싶은 날짜(기본: 오늘, 로컬 시간)') }),
    annotations: READ,
  }, reply(({ date }) => reader.today({ date })));

  server.registerTool('list_tasks', {
    title: '할 일 목록',
    description: '할 일을 조건으로 거른다. 기본은 열린 일 전부(마감 빠른 순). 완료 기록은 status=done으로 최근 doneDays일치를 본다.',
    inputSchema: z.object({
      status: z.enum(['open', 'done', 'cancelled', 'closed']).optional().describe('open(기본) · done · cancelled · closed(완료+취소)'),
      kind: z.enum(['all', 'inbox', 'todo', 'waiting']).optional().describe('기본 all'),
      project: z.string().optional().describe('프로젝트 이름. 빈 문자열이면 프로젝트 없는 일만'),
      dueFrom: day.optional(),
      dueTo: day.optional(),
      query: z.string().optional().describe('제목·상세·기다리는 상대에서 찾을 단어(공백으로 나누면 AND)'),
      doneDays: z.number().int().min(1).max(3650).optional().describe('완료 기록을 며칠 전까지 볼지(기본 7)'),
      limit: z.number().int().min(1).max(500).optional().describe('기본 100'),
    }),
    annotations: READ,
  }, reply((args) => reader.listTasks(args)));

  server.registerTool('get_task', {
    title: '할 일 상세',
    description: '할 일·한 줄 메모 하나의 상세(상세 메모, 출처 context 포함).',
    inputSchema: z.object({ id: z.string() }),
    annotations: READ,
  }, reply(({ id }) => notFound('할 일')(reader.getTask(id))));

  server.registerTool('list_events', {
    title: '일정',
    description: '기간 안의 일정(반복 일정은 회차로 펼친다). from·to는 둘 다 포함하는 로컬 날짜, 최대 366일.',
    inputSchema: z.object({ from: day, to: day }),
    annotations: READ,
  }, reply((args) => reader.listEvents(args)));

  server.registerTool('list_projects', {
    title: '프로젝트',
    description: '활성 프로젝트와 각각의 열린 할 일 수.',
    annotations: READ,
  }, reply(() => reader.listProjects()));

  server.registerTool('search_notes', {
    title: '메모 검색',
    description: 'Note(긴 메모)를 찾는다. 검색어를 비우면 최근 열어본 순 목록. 결과는 요약(snippet)이라 본문은 get_note로 읽는다.',
    inputSchema: z.object({
      query: z.string().optional().describe('검색어. #태그로 태그 필터, 초성만 쓰면 초성 검색'),
      archived: z.boolean().optional().describe('보관한 메모에서 찾기(서버가 허용할 때만)'),
      limit: z.number().int().min(1).max(100).optional().describe('기본 20'),
    }),
    annotations: READ,
  }, reply((args) => reader.searchNotes(args)));

  server.registerTool('get_note', {
    title: '메모 읽기',
    description: '메모 하나의 본문(마크다운)과 태그·링크·백링크.',
    inputSchema: z.object({ id: z.string() }),
    annotations: READ,
  }, reply(({ id }) => notFound('메모')(reader.getNote(id))));

  server.registerTool('list_note_tags', {
    title: '메모 태그',
    description: '메모에 쓰인 태그와 메모 수(많은 순).',
    annotations: READ,
  }, reply(() => reader.listNoteTags()));

  return server;
}

async function main(argv = process.argv.slice(2)) {
  const reader = createReader({
    dataDir: option(argv, '--data-dir') ? path.resolve(option(argv, '--data-dir')) : defaultDataDir(),
    includeArchived: argv.includes('--include-archived'),
    includeAttachments: argv.includes('--include-attachments'),
  });
  const server = createServer(reader);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`whendesk MCP ${pkg.version} — 읽기 전용, 데이터 ${reader.dataDir}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { process.stderr.write(`whendesk MCP 시작 실패: ${err?.stack ?? err}\n`); process.exit(1); });
}
