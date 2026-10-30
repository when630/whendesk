// main/store.mjs — 랭킹 저장소. node:sqlite 단일 파일(STOR-01). 저장하는 것은 **무엇을 언제 몇 번 골랐는지**뿐이다(STOR-02).
// 테이블이 둘뿐인 것이 정상이다(03 §4). 이 파일이 100줄을 넘으면 이 앱이 데이터를 갖기 시작했다는 신호다(D-02).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS picks (
      key     TEXT PRIMARY KEY,
      source  TEXT NOT NULL,
      hits    INTEGER NOT NULL DEFAULT 0,
      last_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS picks_last ON picks(last_at DESC);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    INSERT OR IGNORE INTO meta(k, v) VALUES ('schema', '1');
  `);
  const upsert = db.prepare(
    `INSERT INTO picks(key, source, hits, last_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET hits = hits + 1, last_at = excluded.last_at`
  );
  const selectAll = db.prepare('SELECT key, hits, last_at FROM picks');

  // 랭킹은 검색마다 읽으므로 메모리에 들고 있다. 쓰기는 드물다(고를 때만).
  let cache = null;
  function picks() {
    if (!cache) {
      cache = new Map();
      for (const r of selectAll.all()) cache.set(r.key, { hits: Number(r.hits), lastAt: Number(r.last_at) });
    }
    return cache;
  }

  return {
    picks,
    pick(key, source, now = Date.now()) {
      upsert.run(key, source, now);
      const prev = picks().get(key);
      picks().set(key, { hits: (prev?.hits ?? 0) + 1, lastAt: now });
    },
    // 랭킹 초기화 — 되돌릴 수 없다(설정 창이 경고한다)
    reset() {
      db.exec('DELETE FROM picks');
      cache = new Map();
    },
    close() {
      db.close();
    },
    file,
  };
}
