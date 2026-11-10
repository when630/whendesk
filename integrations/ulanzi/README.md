# WHENDESK · Ulanzi 덱 플러그인

Ulanzi Studio(D200 등) 키에 WHENDESK 할 일·일정을 보여 주고, 눌러 완료하거나 창을 열지 않고 담는다. 앱의 로컬 통로 `127.0.0.1:37632`(`main/deck.mjs`)에서 SSE로 받는다.

## 설치

1. `com.ulanzi.whendesk.ulanziPlugin` 폴더를 `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`에 복사한다
2. Ulanzi Studio를 다시 켠다 → 액션 목록에 **WHENDESK** 분류가 생긴다

플러그인을 고친 뒤에는 다시 복사하고 Ulanzi Studio를 다시 켠다. 덱 통로가 들어간 WHENDESK가 켜져 있어야 한다.

## 액션

| 액션 | 보이는 것 | 누르면 |
|---|---|---|
| 오늘 | 남은 할 일 수. 아래 줄은 지연(붉게) → 오늘 마감 → 오늘 완료 순으로 하나 | 대시보드 |
| 할 일 | 놓은 키를 위→아래, 왼쪽→오른쪽 순서로 세어 N번째 키에 대시보드 ToDo의 N번째 할 일. 불릿 기호 · 마감 배지(오늘 · D-3 · D+1) · 세 번 넘게 미뤘으면 `>3` · 프로젝트 | **짧게** 완료, **길게(0.6초)** 취소. 5초 안에 다시 누르면 되돌린다 |
| 다음 일정 | 아직 끝나지 않은 첫 일정의 시각 · 남은 시간 · 제목 · 장소. 10분 안이면 붉게, 시작했으면 NOW | 캘린더에서 그 일정 |
| 개수 | 키 설정에서 고른 하나: 인박스 · 대기 · 5일 넘게 기다림 · 마감 지남 · 오늘 마감 · 세 번 넘게 미룸 · 오늘 완료 · 남은 할 일. 신호 항목은 1 이상이면 붉게 | 그 목록 |
| 담기 | 클립보드 글 또는 키 설정에 정해 둔 문구 | 창을 열지 않고 담는다. 접두 기호 `. ` 할 일(기본, 인박스) · `@ ` 일정 · `- ` 메모. 여러 줄이면 첫 줄이 제목, 나머지가 상세 내용 |
| 열기 | 고른 화면 이름 | 입력줄 · 대시보드 · 인박스 · 할 일 · 대기 · 캘린더 |

- 할 일 키는 막 닫은 일을 5초 동안 그 자리에 붙들고(줄 긋기 + "다시 눌러 되돌림"), 나머지 할 일 키는 그 일을 건너뛰어 채운다
- 할 일이 키보다 많으면 마지막 키에 `+남은 수`가 나온다. 키 설정에서 순번을 고정할 수 있다(기본은 자동)
- 덱에서 한 완료·취소는 앱의 U(되돌리기) 기록에는 들어가지 않는다. 덱 키를 다시 눌러 되돌린다
- WHENDESK가 꺼져 있으면 `OFFLINE`

## 통로

```
GET  /state · /events(SSE)
POST /task/complete?id=…[&done=0] · /task/cancel?id=…[&cancelled=0]
POST /capture  {"text": "…"} · /capture/clipboard
POST /open?view=dashboard|command|inbox|todo|waiting|calendar[&id=…&date=YYYY-MM-DD]
```

127.0.0.1에서만 듣고 Host·Origin을 확인한다(whenpc·WHENTERMINAL과 같은 규칙). 포트를 다른 실행본(설치본 옆의 개발 실행 등)이 쓰고 있으면 통로 없이 뜬다. `--no-deck`으로 끌 수 있다.

## 아이콘·미리보기

액션 아이콘은 키 화면과 같은 `plugin/draw.js`로 그린다. 그림을 고쳤으면 다시 만든다:

```sh
npx electron integrations/ulanzi/render-icons.cjs [미리보기.png]
```

`plugin.png`·`category.png`는 `../ulanzi-icons/png/16_whendesk.png`를 줄여 쓴다.

## 디버깅

Ulanzi Studio를 `--webRemoteDebug`로 켜고 `localhost:9292`에서 주 서비스(`plugin/app.html`) 콘솔을 본다. 통로는 `curl http://127.0.0.1:37632/state`로 확인한다.

`libs/`는 [UlanziDeckPlugin-SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK) 데모의 공용 라이브러리 사본이다(Apache-2.0, `libs/LICENSE-ulanzi-sdk`).
