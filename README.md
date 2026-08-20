# qa-sheets-automation

파견 QA 팀의 일일 보고와 TC 진행률, 이슈 현황을 스프레드시트 안에서 자동으로 만드는 Google Apps Script 도구다. 원래는 수식만으로 짠 시스템이었고 큐로드(Qroad) 재직 중 4개 프로젝트에 실제로 배포했다. 파견이 끝나면 시스템도 같이 끝나는 게 싫어서, 집계 로직을 코드로 옮기고 테스트를 붙였다.

![CI](https://github.com/dheogns1222-sketch/qa-sheets-automation/actions/workflows/ci.yml/badge.svg)

## 이 도구가 하는 일: 입력과 출력

TE는 TC 시트에 결과값만 적는다. Pass, Fail, Block, N/A, No Run 다섯 가지 중 하나다. 날짜별로 어제 것과 오늘 것이 섞여 쌓이고, 이슈는 별도 시트에 심각도와 상태로 등록된다.

예를 들어 오늘 12건이 수행되고(어제 수행분 1건은 자동 제외됨) 당일 이슈 5건이 등록되면 이렇게 나온다. `demo/daily_report_demo.js`를 실행한 실제 출력이다.

```
$ node demo/daily_report_demo.js
──────────────────────────────────────────────────
  QA 일일 보고 (자동 생성)  |  2026-08-20
──────────────────────────────────────────────────
  TC 수행     : 12건  (어제 수행분 1건 자동 제외됨: 1건)
  결과 분포   : Pass 7 / Fail 2 / Block 1 / N-A 1 / No Run 1
  진행률      : 90.9%   성공률: 70%
  당일 이슈   : 총 5건 (수정 확인 2건)
  미종료 잔존 : Highest 0 / High 2 / Medium 1 / Low 0 / Lowest 0
──────────────────────────────────────────────────

▼ 고객사 전달용 보고 본문 자동 조립 (원본 Daily Report!C7 로직):

안녕하세요.
QA 1팀 오대훈입니다.
금일 진행된 업무 대응 내용 및 테스트 진행 결과에 대해 하기와 같이 전달드립니다.

■ 테스트 진행 결과 (2026-08-20)
 - 수행: 10건 (Pass 7 / Fail 2 / Block 1)
 - 진행률: 90.9% · 성공률: 70%
■ 금일 등록 이슈: 총 5건 (수정 확인 2건)
 - 이슈 번호: PRJ-101, PRJ-102, PRJ-103, PRJ-104, PRJ-105

감사합니다.
```

이 본문이 실제 운영에서는 리포트 시트로 생성되고, `Triggers.js`가 매일 정해진 시각에 메일이나 웹훅으로 내보낸다.

## 왜 만들었나

큐로드에서 3계층(고객사·TL·TE)으로 나뉜 스프레드시트를 운영했다. TL 마스터 문서 하나에 IFERROR만 8,000개 넘게 걸려 있었고, 열 하나만 잘못 삽입해도 수식이 통째로 깨졌다. "이 셀이 왜 0%지"를 확인할 방법은 눈으로 보는 것뿐이었다. QA가 만든 도구가 검증이 안 된다는 게 이상했다.

파견이 끝나면 REGEXEXTRACT와 IMPORTRANGE로 짠 수식은 작성자만 고칠 수 있는 채로 남았다. 그래서 이 저장소는 그 시스템을 코드로 다시 짠 것이다. 계산 로직만 Sheets API 의존 없이 떼어내면 Node로 테스트할 수 있다는 게 핵심 판단이었다.

## 테스트

```
$ npm test

> qa-sheets-automation@1.0.0 test
> node --test test/*.test.js

▶ countResults — TC 결과 카운트 (COUNTIFS 재구현)
  ✔ 2차원 범위에서 5개 결과 라벨을 대소문자 구분 없이 센다
  ✔ 결과값이 아닌 셀(설명 텍스트, 숫자, null)은 무시한다
...
▶ normalizeSeverity — 심각도 셀 정규화
  ✔ null/undefined/빈 문자열은 null을 반환한다 (경계값: 빈 입력)

ℹ tests 34
ℹ suites 16
ℹ pass 34
ℹ fail 0
ℹ duration_ms 69.153
```

34개 테스트가 16개 스위트로 나뉘어 있다. 0으로 나누는 경우, 빈 시트, 날짜 시리얼 해석 같은 경계값을 회귀 테스트로 고정해 뒀다.

## 설계 판단

집계 로직(`lib/core.js`)과 Apps Script 배포 코드(`src/`)를 분리했다. Apps Script는 로컬에서 실행할 방법이 없어서, `SpreadsheetApp` 같은 Sheets API를 아예 쓰지 않는 순수 함수만 core.js에 몰아넣고 Node에서 검증한다. `src/`는 이 core.js를 불러다 시트 읽기·쓰기만 담당하고, `clasp push` 대상도 core.js와 src뿐이다(`.claspignore` 참고).

권한 3계층(고객사는 뷰 전용, TL은 보고서·일정, TE는 본인 시트만)은 실무에서 사고를 막으려고 나온 구조라 그대로 코드에 옮겼다. 색상 규약은 `StyleGuide.js`에 상수로 박아 뒀다.

## 설치와 배포

대상 스프레드시트에 `Config` 시트(A열 키, B열 값)와 `TC Documents` 시트(문서명과 ID)를 만든 다음:

```bash
npm i -g @google/clasp && clasp login
cp .clasp.json.example .clasp.json   # scriptId 입력
clasp push
```

시트를 새로고침하면 `QA 자동화` 메뉴가 뜬다. `Triggers.js`의 `installDailyTrigger()`를 한 번 실행하면 일일 트리거가 등록된다. Config 시트 스키마와 권한 분리 설정은 [docs/architecture.md](docs/architecture.md#4-설치)에 있다.

## 모듈 구성

| 모듈 | 역할 |
|---|---|
| `lib/core.js` | 순수 집계 로직. Sheets API 무의존, Apps Script/Node 겸용 |
| `src/Config.js` | Config·TC Documents 시트 파싱 |
| `src/TcProgress.js` | TC 문서 순회, 진행률·성공률 크로스 집계 |
| `src/DailyReport.js` | 당일 결과 집계, 보고서 시트 생성 |
| `src/IssueTracker.js` | 심각도별·상태별·잔존 이슈 집계 |
| `src/Triggers.js` | 시간 트리거로 일일 보고 자동 실행·발송 |
| `src/Menu.js` | 커스텀 메뉴 |
| `src/StyleGuide.js` | 색상 규약 상수 |

배경과 원본 수식 대응표는 [docs/architecture.md](docs/architecture.md), 수식에서 코드로 옮긴 이유는 [docs/migration.md](docs/migration.md)에 정리했다.

## 이 도구가 못 하는 것

- 실시간이 아니다. 트리거 주기(하루 1회)에 묶여 있고, 그 사이 값이 바뀌어도 다음 실행 전까지는 반영되지 않는다.
- BTS(이슈 트래커) API 연동이 없다. Issuelist 시트에 결과를 사람이 옮겨 적어야 한다.
- TC 문서가 수십 개로 늘어나면 Sheets API 호출 쿼터에 걸릴 수 있다. 캐시 시트 도입은 아직 안 했다.
- `src/`는 clasp push 없이는 통합 테스트가 안 된다. 검증되는 건 `lib/core.js`의 계산 로직뿐이다.

## License

MIT © 2026 Daehun Oh
