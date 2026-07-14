/**
 * @file core.test.js — lib/core.js 단위 테스트 (node --test).
 *
 * Apps Script 환경 없이 순수 로직만 검증한다.
 * 기대값은 원본 수식의 동작(0건 → '-', IFERROR → 0% 등)을 기준으로 삼았다.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../lib/core.js');

describe('countResults — TC 결과 카운트 (COUNTIFS 재구현)', () => {
  it('2차원 범위에서 5개 결과 라벨을 대소문자 구분 없이 센다', () => {
    const values = [
      ['Pass', 'FAIL', 'pass'],
      ['Block', 'N/A', 'No Run'],
      ['테스트 스텝 설명', '', 'PASS']
    ];
    const counts = Core.countResults(values);
    assert.deepEqual(counts, { pass: 3, fail: 1, block: 1, na: 1, noRun: 1, total: 7 });
  });

  it('결과값이 아닌 셀(설명 텍스트, 숫자, null)은 무시한다', () => {
    const values = [
      ['기대결과: 정상 노출', 123, null],
      ['norun', 'NO-RUN', 'na'] // 변형 표기 흡수
    ];
    const counts = Core.countResults(values);
    assert.equal(counts.noRun, 2);
    assert.equal(counts.na, 1);
    assert.equal(counts.total, 3);
  });
});

describe('computeProgress — 진행률/성공률 계산', () => {
  it('진행률 = (Pass+Fail+Block)/(Total-N/A), 성공률 = Pass/수행건수', () => {
    // Pass 7, Fail 2, Block 1, N/A 2, No Run 8 → Total 20
    const counts = { pass: 7, fail: 2, block: 1, na: 2, noRun: 8, total: 20 };
    const progress = Core.computeProgress(counts);
    assert.equal(progress.executed, 10);
    assert.equal(progress.progressRate, 10 / 18);
    assert.equal(progress.successRate, 0.7);
  });

  it('빈 시트(0 나눗셈)에서는 0을 반환한다 (원본 IFERROR → "0%" 동작)', () => {
    const progress = Core.computeProgress({ pass: 0, fail: 0, block: 0, na: 0, noRun: 0, total: 0 });
    assert.equal(progress.progressRate, 0);
    assert.equal(progress.successRate, 0);
  });

  it('전부 N/A인 시트도 0 나눗셈 없이 0을 반환한다', () => {
    const progress = Core.computeProgress({ pass: 0, fail: 0, block: 0, na: 5, noRun: 0, total: 5 });
    assert.equal(progress.progressRate, 0);
  });
});

describe('mergeCounts — 문서 단위 크로스 집계', () => {
  it('여러 TC 시트의 카운트를 합산한다', () => {
    const merged = Core.mergeCounts([
      { pass: 3, fail: 1, block: 0, na: 1, noRun: 5, total: 10 },
      { pass: 2, fail: 0, block: 1, na: 0, noRun: 2, total: 5 }
    ]);
    assert.deepEqual(merged, { pass: 5, fail: 1, block: 1, na: 1, noRun: 7, total: 15 });
  });
});

describe('formatPercent — 퍼센트 표기', () => {
  it('소수부 말미 0을 정리한다 (87.5% / 100% / 0%)', () => {
    assert.equal(Core.formatPercent(0.875), '87.5%');
    assert.equal(Core.formatPercent(1), '100%');
    assert.equal(Core.formatPercent(0), '0%');
  });

  it('숫자가 아니면 "-"를 반환한다', () => {
    assert.equal(Core.formatPercent(NaN), '-');
    assert.equal(Core.formatPercent(undefined), '-');
  });
});

describe('parseSheetIdFromName — 동적 문서 참조 (REGEXEXTRACT 재구현)', () => {
  it('"문서 이름 (ID)" 형식에서 ID를 추출한다', () => {
    assert.equal(
      Core.parseSheetIdFromName('프로젝트A_TestCase (1_7WnU9nzqCwQiQv_bwfy9FZ2rxH85RTl_SdNkD1hofU)'),
      '1_7WnU9nzqCwQiQv_bwfy9FZ2rxH85RTl_SdNkD1hofU'
    );
  });

  it('괄호가 없거나 비어 있으면 null을 반환한다', () => {
    assert.equal(Core.parseSheetIdFromName('프로젝트A_TestCase'), null);
    assert.equal(Core.parseSheetIdFromName('이름 ( )'), null);
    assert.equal(Core.parseSheetIdFromName(null), null);
  });
});

describe('parseConfigSheet — 설정 시트 파싱', () => {
  it('키-값을 트림해 읽고, 주석과 빈 행을 건너뛰고, 중복 키는 마지막 값이 이긴다', () => {
    const values = [
      ['# 설정 시트', ''],
      ['PROJECT_NAME ', ' 샘플 프로젝트 '],
      ['', '무시됨'],
      ['REPORT_HOUR', 18],
      ['PROJECT_NAME', '최종 프로젝트']
    ];
    const config = Core.parseConfigSheet(values);
    assert.deepEqual(config, { PROJECT_NAME: '최종 프로젝트', REPORT_HOUR: 18 });
  });
});

describe('parseProjectTable — TC 문서 목록 파싱', () => {
  it('이름 속 (ID)와 B열 직접 기입을 모두 지원하고, B열이 우선한다', () => {
    const values = [
      ['# 문서 이름', 'ID'],
      ['프로젝트A_TestCase (abc123)'],
      ['프로젝트B_TestCase', 'xyz789'],
      ['프로젝트C_TestCase (ignored)', 'explicit-id'],
      ['ID 없는 문서'] // 건너뜀
    ];
    const docs = Core.parseProjectTable(values);
    assert.deepEqual(docs, [
      { label: '프로젝트A_TestCase', id: 'abc123' },
      { label: '프로젝트B_TestCase', id: 'xyz789' },
      { label: '프로젝트C_TestCase', id: 'explicit-id' }
    ]);
  });
});

describe('toDateKey — 날짜 정규화', () => {
  it('Date 객체와 문자열 표기를 yyyy-mm-dd 로 통일한다', () => {
    assert.equal(Core.toDateKey(new Date(2026, 6, 14)), '2026-07-14');
    assert.equal(Core.toDateKey('2026-07-14 18:00'), '2026-07-14');
    assert.equal(Core.toDateKey('2026.7.4'), '2026-07-04');
    assert.equal(Core.toDateKey('2026/07/14'), '2026-07-14');
  });

  it('Google Sheets 날짜 시리얼을 해석한다 (45657 → 2024-12-31)', () => {
    assert.equal(Core.toDateKey(45657), '2024-12-31');
  });

  it('해석할 수 없는 값은 null을 반환한다', () => {
    assert.equal(Core.toDateKey('이슈 종료'), null);
    assert.equal(Core.toDateKey(''), null);
    assert.equal(Core.toDateKey(new Date('invalid')), null);
  });
});

describe('filterRowsByDate — 당일 보고 필터 (FILTER+TODAY 재구현)', () => {
  it('혼합된 날짜 표기(Date/문자열/시리얼) 중 기준일과 같은 행만 남긴다', () => {
    const rows = [
      ['BTS-1', 'High', new Date(2024, 11, 31)],
      ['BTS-2', 'Low', '2024-12-30'],
      ['BTS-3', 'Medium', 45657], // 2024-12-31
      ['BTS-4', 'High', null]
    ];
    const filtered = Core.filterRowsByDate(rows, 2, '2024-12-31');
    assert.deepEqual(filtered.map((row) => row[0]), ['BTS-1', 'BTS-3']);
  });
});

describe('mapIssueStatusToResult — 이슈 상태 → 재확인 결과 매핑', () => {
  it('이슈 종료→PASSED, 재발생→FAILED, 빈 값→빈 문자열, 그 외→UNTESTED', () => {
    assert.equal(Core.mapIssueStatusToResult('이슈 종료'), 'PASSED');
    assert.equal(Core.mapIssueStatusToResult('재발생'), 'FAILED');
    assert.equal(Core.mapIssueStatusToResult(''), '');
    assert.equal(Core.mapIssueStatusToResult(null), '');
    assert.equal(Core.mapIssueStatusToResult('수정 중'), 'UNTESTED');
  });
});

describe('aggregateIssues — 심각도 매트릭스 (Total BTS status 재구현)', () => {
  const registered = [
    { severity: 'Highest', status: '이슈 종료' },
    { severity: 'Highest', status: '수정 중' },
    { severity: 'High', status: '보류' },
    { severity: 'medium', status: '이슈 종료' }, // 소문자 흡수
    { severity: '???', status: '수정 중' } // 미분류
  ];
  const checklist = [
    { severity: 'Highest', checkResult: 'UNTESTED' },
    { severity: 'High', checkResult: 'N/A' },
    { severity: 'Medium', checkResult: 'PASSED' }
  ];

  it('총 등록/수정 확인/보류는 이슈 목록에서, 잔존/논이슈는 체크리스트에서 센다', () => {
    const result = Core.aggregateIssues(registered, checklist);
    assert.deepEqual(result.rows.Highest, { registered: 2, fixed: 1, onHold: 0, remaining: 1, nonIssue: 0 });
    assert.deepEqual(result.rows.High, { registered: 1, fixed: 0, onHold: 1, remaining: 0, nonIssue: 1 });
    assert.deepEqual(result.rows.Medium, { registered: 1, fixed: 1, onHold: 0, remaining: 0, nonIssue: 0 });
  });

  it('합계에는 미분류 심각도도 포함하고 unclassified 로 표시한다', () => {
    const result = Core.aggregateIssues(registered, checklist);
    assert.equal(result.totals.registered, 5);
    assert.equal(result.totals.fixed, 2);
    assert.equal(result.totals.remaining, 1);
    assert.equal(result.totals.unclassified, 1);
  });
});

describe('summarizeDailyIssues — 당일 이슈 요약 문구', () => {
  it('0건이면 "-" (원본 표기 규약)', () => {
    assert.deepEqual(Core.summarizeDailyIssues([]), { registered: 0, fixed: 0, text: '-' });
  });

  it('등록/수정 확인 건수를 문구로 조립한다', () => {
    const issues = [
      { status: '이슈 종료' },
      { status: '수정 중' },
      { status: '이슈 종료' }
    ];
    const summary = Core.summarizeDailyIssues(issues);
    assert.equal(summary.text, '총 3건 (수정 확인 2건)');
  });

  it('수정 확인이 없으면 건수만 표기한다', () => {
    const summary = Core.summarizeDailyIssues([{ status: '수정 중' }]);
    assert.equal(summary.text, '총 1건');
  });
});

// ── 원본 Daily Report 문구 조립 로직 (Drive 원본 확인 후 추가: 2026-07-15) ──
const { test: t2, describe: d2 } = require('node:test');
const assert2 = require('node:assert');

d2('listDailyIssueKeys — 당일 이슈 키 목록 (TEXTJOIN+UNIQUE+FILTER 대응)', () => {
  const issues = [
    { key: 'PRJ-1', date: '2026-07-15', status: '수정 대기' },
    { key: 'PRJ-2', date: '2026-07-15', status: '이슈 종료' },
    { key: 'PRJ-1', date: '2026-07-15', status: '수정 대기' }, // 중복
    { key: 'PRJ-9', date: '2026-07-14', status: '수정 대기' }, // 다른 날짜
  ];
  t2('당일 이슈만 중복 없이 조인한다', () => {
    assert2.strictEqual(Core.listDailyIssueKeys(issues, '2026-07-15'), 'PRJ-1, PRJ-2');
  });
  t2('상태 필터를 적용한다', () => {
    assert2.strictEqual(Core.listDailyIssueKeys(issues, '2026-07-15', '이슈 종료'), 'PRJ-2');
  });
  t2('해당 건이 없으면 "-" (원본 표기 규약)', () => {
    assert2.strictEqual(Core.listDailyIssueKeys(issues, '2026-01-01'), '-');
  });
});

d2('buildDailyReportMessage — 보고 본문 자동 조립 (Daily Report!C7 대응)', () => {
  const counts = { pass: 7, fail: 2, block: 1, na: 1, noRun: 1, total: 12 };
  const msg = Core.buildDailyReportMessage({
    team: 'QA 1팀', name: '오대훈', date: '2026-07-15',
    counts, issueLine: '총 5건 (수정 확인 2건)', issueKeys: 'PRJ-101, PRJ-103',
  });
  t2('인사말·소속·이름이 포함된다', () => {
    assert2.ok(msg.includes('안녕하세요.'));
    assert2.ok(msg.includes('QA 1팀 오대훈입니다.'));
  });
  t2('수행 건수와 결과 분포가 정확하다', () => {
    assert2.ok(msg.includes('수행: 10건 (Pass 7 / Fail 2 / Block 1)'));
  });
  t2('진행률·성공률·이슈 라인이 포함된다', () => {
    assert2.ok(msg.includes('진행률: 90.9%'));
    assert2.ok(msg.includes('금일 등록 이슈: 총 5건 (수정 확인 2건)'));
    assert2.ok(msg.includes('이슈 번호: PRJ-101, PRJ-103'));
  });
});
