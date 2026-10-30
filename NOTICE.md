# 재사용 코드와 구성 요소

원본 프로젝트를 수정하지 않고 다음 코드를 WHENDESK 안에 복사해 재사용했습니다.

- WHENWORK 0.2.14: SQLite 저장·마이그레이션·백업·캡처 큐, 자연어 마감 파서, 초성·필터 검색과 마감·대기·프로젝트 그룹 계산. 복사본에 원자적인 항목 수정 경로 추가.
- WHENNOTE 0.1.8: SQLite 메모·초성/태그 검색·고정·보관/휴지통·링크/백링크·이미지 첨부·안전한 Markdown 렌더러. 복사본에 빈 메모 작성과 목록 일괄 조회 경로 추가.
- WHENCALENDAR: SQLite·반복·한국어 일정 파서·검색·ICS·구독. 복사본에서 반복 회차와 ICS 예외 보존 경로 연결.
- WHENCOMMAND 0.1.16: 초성/한영 자판 검색·별칭·랭킹·계산/단위·스크립트 파서·Windows 앱 열거/검색/실행.
- WHENMUSIC 0.1.7: Worker 기반 Windows SMTC 컨트롤 경계. 청취 기록 기능은 사용하지 않음.

기존 프로젝트 코드는 각 원본의 MIT 라이선스 안내를 따릅니다. 원본 경로는 개발 PC의 `D:\when630\whenwork`, `whencalendar`, `whencommand`, `whenmusic`입니다. 배포 실행은 이 경로에 의존하지 않습니다.

Pretendard 글꼴은 `renderer/fonts/PretendardOFL.txt`의 SIL Open Font License 1.1을 따릅니다. Lucide는 ISC 라이선스입니다. ical.js 2.2.1은 MPL-2.0 라이선스이며 번들된 패키지의 LICENSE를 참고하세요. Electron과 Chromium의 라이선스 문서는 배포 폴더에 포함됩니다. Windows SMTC 네이티브 애드온 출처·버전·MIT 라이선스 안내는 `vendor/README.md`에 있습니다.
