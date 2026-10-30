# vendor/

네이티브 애드온 바이너리. **직접 빌드하지 않는다** — 개발 PC에 Rust·MSVC를 두지 않기로 했다([D-06](../docs/03_기술_스펙.md#d-06-애드온은-ci에서만-빌드한다)).

| | |
|---|---|
| 출처 | [when630/node-windows-smtc-monitor](https://github.com/when630/node-windows-smtc-monitor) `v1.1.0` 릴리스 |
| 파일 | `windows-smtc-monitor.win32-x64-msvc.node` (803,840 bytes) |
| 빌드 | GitHub Actions `windows-latest`, `x86_64-pc-windows-msvc` |
| 라이선스 | MIT — upstream `LeagueTavern/node-windows-smtc-monitor` (REL-05) |

## 왜 저장소에 커밋하는가

npm에 퍼블리시하지 않기로 했다([D-20](../docs/03_기술_스펙.md#d-20-애드온은-npm에-퍼블리시하지-않고-릴리스의-node를-쓴다)). 바이너리를 여기 두면 `npm i`에도 `electron-builder`에도 네트워크와 Rust가 끼지 않는다 — "설치 파일 하나"(PLAT-01)와 같은 방향이다.

## 갱신하는 법

```powershell
gh release download vX.Y.Z -R when630/node-windows-smtc-monitor `
  --pattern 'windows-smtc-monitor.win32-x64-msvc.node' --dir vendor --clobber
```

받은 뒤 이 표의 버전·크기를 고치고, 로드되는지 확인한다:

```powershell
node -e "console.log(Object.keys(require('./vendor/windows-smtc-monitor.win32-x64-msvc.node')))"
```

## 주의

이 `.node`는 **asar 안에서는 로드되지 않는다.** `package.json`의 `asarUnpack`이 `vendor/**/*.node`를 밖으로 빼고, 포장된 앱에서는 `app.asar.unpacked/vendor/` 아래에서 찾아야 한다. 그리고 애드온은 Worker thread에서만 만진다([D-16](../docs/03_기술_스펙.md#d-16-smtc는-worker-thread에서만-만진다)).
