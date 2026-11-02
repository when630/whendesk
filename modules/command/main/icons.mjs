// 원본 WHENCOMMAND main/icons.mjs 그대로(메인 프로세스 전용 — electron을 쓴다).
// main/icons.mjs — 앱·파일 아이콘(LNCH-04). OS가 그 파일에 붙인 아이콘을 app.getFileIcon으로 받아 data URL로 캐시한다.
// 렌더러는 **화면에 보이는 줄**만 묻고, 한 번 받은 건 세션 동안 기억한다(D-23). 못 뽑는 것(지워진 파일, 로고를 못 찾은 UWP)은 null —
// 렌더러가 첫 글자 상자로 둔다. 실패가 앱을 멈추지 않는다.
// 선워밍(D-38) — 시작 직후 앱 목록 전체를 백그라운드에서 청크로 미리 받아 둔다. 실측 #11: 셸 캐시에 없는 exe는 콜드 226~751ms/개라
// 첫 검색에서 글자 상자가 아이콘으로 늦게 바뀌는 것이 체감 "무거움"의 한 축이었다. 캐시 파일은 여전히 두지 않는다(오픈이슈 #4).
import { app, nativeImage } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { platform } from './platform/index.mjs';

export function createIconCache() {
  const cache = new Map(); // path → dataUrl | null
  const inflight = new Map(); // path → Promise
  const needExtract = new Set(); // one()이 셸에 묻지 않고 리소스 추출로 넘긴 경로(인덱스 있는 exe·dll, D-39) — fixGeneric이 채운다
  let generic = null; // 셸이 '모르는 exe'에 주는 기본 실행 파일 아이콘 — 이것과 같으면 진짜가 아니다(D-26 보충)

  async function genericExe() {
    if (generic !== null) return generic;
    try {
      const img = await app.getFileIcon(path.join(os.tmpdir(), 'whencommand-generic-probe.exe'), { size: 'normal' });
      generic = img && !img.isEmpty() ? img.toDataURL() : '';
    } catch { generic = ''; }
    return generic;
  }

  async function one(p) {
    if (cache.has(p)) return cache.get(p);
    if (inflight.has(p)) return inflight.get(p);
    // 셸에 묻지 않고 fixGeneric의 추출로 넘기는 것은 약속(inflight)을 만들기 **전에** 가른다. 작업 안에서 await 없이 return하면
    // inflight.delete가 inflight.set보다 먼저 돌아 끝난 null이 inflight에 영영 남고, 폴백이 needExtract를 지운 뒤의 요청은 그 null을 받았다
    // (2026-10-19 패키징 smoke에서 UWP 로고 41개 중 16개 — 백그라운드 선워밍과 겹칠 때만, D-42)
    if (/^shell:/i.test(p)) {
      // UWP는 셸 아이콘이 없다 — 패키지 매니페스트의 로고를 platform.extractIcons가 읽는다(D-42)
      needExtract.add(p);
      return null;
    }
    // Windows 시작 메뉴는 .lnk — 그대로 물으면 "바로가기" 그림이 온다. platform이 바로가기의 아이콘 출처(IconLocation → 대상)를 푼다(D-39)
    const src = platform.iconSource(p);
    if (!/\.ico$/i.test(src.file) && (src.index !== 0 || /\.dll$/i.test(src.file))) {
      // 인덱스가 있는 exe·dll은 셸의 파일 아이콘이 아니라 그 리소스다 — getFileIcon은 그걸 못 준다
      needExtract.add(p);
      return null;
    }
    const job = (async () => {
      let url = null;
      try {
        if (/\.ico$/i.test(src.file)) {
          // .ico는 셸을 거치지 않고 직접 읽는다(Git·Chrome 앱). 큰 프레임만 든 것은 32px로 줄인다 — data URL이 수십 KB가 되지 않게
          const img = nativeImage.createFromPath(src.file);
          if (!img.isEmpty()) url = (img.getSize().width > 48 ? img.resize({ width: 32, height: 32 }) : img).toDataURL();
        } else {
          const img = await app.getFileIcon(src.file, { size: 'normal' }); // 32px — 24px 상자에 줄여 그린다
          if (img && !img.isEmpty()) url = img.toDataURL();
        }
      } catch {}
      cache.set(p, url);
      inflight.delete(p);
      return url;
    })();
    inflight.set(p, job);
    return job;
  }

  const clean = (paths) => [...new Set((paths ?? []).filter((p) => typeof p === 'string' && p))];

  // 셸이 기본 실행 파일 아이콘을 준 exe는 리소스에서 직접 뽑는다(win32만 — darwin은 빈 객체). PowerShell 한 번에 여러 경로를 묶는다 —
  // 프로세스 시작이 ~400ms라 경로마다 띄우지 않는다. 한 번 뽑으면 캐시에 남아 다시 안 묻는다. 돌려주는 값은 다시 뽑은 경로 수
  // 폴백은 경로마다 **한 번**만, 그리고 동시 요청은 같은 약속을 기다린다(2026-09-23 실사용 로그 — 실패한 것을 요청마다 다시 PowerShell로 뽑으면
  // 매번 ~200ms. 그리고 목록 그리기와 파일 합류가 같은 경로를 거의 동시에 물을 때 둘째가 폴백을 건너뛰면 기본 아이콘을 돌려주고 렌더러가 그걸 세션 내내 기억한다)
  const fixing = new Map(); // path → Promise<url|null> — 진행 중이거나 끝난 폴백
  async function fixGeneric(list, out) {
    const g = await genericExe();
    // 리소스에서 뽑아야 하는 것: 셸이 기본 exe 아이콘을 준 exe + one()이 넘긴 인덱스 있는 exe·dll(D-39)·UWP(D-42)
    // fixing에 이미 있는 것도 — 다른 요청의 폴백이 needExtract를 지운 뒤라도 그 약속(진행 중이든 끝났든)의 값을 받아야 한다
    const generic = list.filter((p) => needExtract.has(p) || fixing.has(p) || (g && out[p] === g && /\.exe$/i.test(platform.iconSource(p).file)));
    if (!generic.length) return 0;
    const fresh = generic.filter((p) => !fixing.has(p));
    if (fresh.length) {
      const srcOf = new Map(fresh.map((p) => [p, platform.iconSource(p)]));
      const job = platform.extractIcons([...srcOf.values()]).then((got) => {
        const urls = new Map();
        for (const [p, src] of srcOf) { const url = got[`${src.file}\t${src.index | 0}`]; if (url) urls.set(p, url); }
        return urls;
      }).catch(() => new Map());
      for (const p of fresh) fixing.set(p, job.then((urls) => urls.get(p) ?? null));
    }
    let n = 0;
    for (const p of generic) {
      const url = await fixing.get(p);
      // 폴백도 실패하면 기본 실행 파일 아이콘 대신 null — 렌더러가 첫 글자 상자를 그린다. Windows 기본 앱 아이콘은 "우리가 모른다"를 말해 주지 않는다
      cache.set(p, url);
      needExtract.delete(p);
      out[p] = url;
      if (url) n++;
    }
    return n;
  }

  return {
    // paths[] → { path: dataUrl|null }. 한 화면은 최대 8줄이라 병렬로 한 번에
    async get(paths) {
      const list = clean(paths).slice(0, 16);
      const out = {};
      await Promise.all(list.map(async (p) => { out[p] = await one(p); }));
      await fixGeneric(list, out);
      return out;
    },
    // 선워밍(D-38) — 전체를 청크로 나눠 사이에 숨을 두고 받는다(시작 직후 메인 프로세스를 독점하지 않게). 폴백은 끝에 **한 번**만 —
    // get()처럼 청크마다 PowerShell을 띄우면 청크 수만큼 ~400ms씩 든다. 이미 캐시된 경로는 비용이 없어 refresh 뒤에 다시 불러도 된다
    async warm(paths, { chunk = 16, gapMs = 40 } = {}) {
      const t0 = performance.now();
      const list = clean(paths).filter((p) => !cache.has(p));
      const out = {};
      for (let i = 0; i < list.length; i += chunk) {
        const part = list.slice(i, i + chunk);
        await Promise.all(part.map(async (p) => { out[p] = await one(p); }));
        if (i + chunk < list.length) await new Promise((r) => setTimeout(r, gapMs));
      }
      const fixed = await fixGeneric(list, out);
      const got = Object.values(out).filter(Boolean).length;
      // 못 받은 것의 이름 — 실측용. 여기 남는 것은 폴백까지 실패해 글자 상자로 가는 항목이다(UWP도 D-42부터 셈에 든다)
      const missing = list.filter((p) => !out[p]).map((p) => path.basename(p));
      return { total: list.length, got, fixed, missing, ms: Math.round(performance.now() - t0) };
    },
    size: () => cache.size,
  };
}
