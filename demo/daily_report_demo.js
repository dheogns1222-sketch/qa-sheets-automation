/**
 * @file daily_report_demo.js — 일일 보고 자동 생성 로직 데모 (Node 단독 실행).
 *
 * Google Sheets 없이 lib/core.js 의 순수 로직만으로,
 * 샘플 TC 수행 데이터와 이슈 데이터에서 일일 보고 요약을 생성해 콘솔에 출력한다.
 *
 *   node demo/daily_report_demo.js
 */
'use strict';

const Core = require('../lib/core.js');

const TODAY = Core.toDateKey(new Date());

// ── 샘플: TC 수행 기록 행 [테스터, 기능, 결과, 수행일] ──
const tcRows = [
  ['TE-A', '로그인', 'Pass', TODAY], ['TE-A', '로그인', 'Pass', TODAY],
  ['TE-A', '상점', 'Fail', TODAY], ['TE-A', '상점', 'Pass', TODAY],
  ['TE-B', '매칭', 'Pass', TODAY], ['TE-B', '매칭', 'Block', TODAY],
  ['TE-B', '매칭', 'Pass', TODAY], ['TE-B', '설정', 'N/A', TODAY],
  ['TE-C', '결제', 'Pass', TODAY], ['TE-C', '결제', 'Pass', TODAY],
  ['TE-C', '결제', 'Fail', TODAY], ['TE-C', '인벤토리', 'No Run', TODAY],
  ['TE-A', '(어제 수행분)', 'Pass', '2000-01-01'], // 당일 필터에서 제외되어야 함
];

// ── 샘플: 당일 등록 이슈 [{severity, status}] ──
const issuesToday = [
  { key: 'PRJ-101', severity: 'Highest', status: '이슈 종료' },
  { key: 'PRJ-102', severity: 'High', status: '수정 대기' },
  { key: 'PRJ-103', severity: 'High', status: '재발생' },
  { key: 'PRJ-104', severity: 'Medium', status: '수정 대기' },
  { key: 'PRJ-105', severity: 'Low', status: '이슈 종료' },
];

// ── 집계 (Apps Script의 DailyReport.js 가 사용하는 함수 그대로) ──
const todayTc = Core.filterRowsByDate(tcRows, 3, TODAY);
const counts = Core.countResults(todayTc.map((r) => [r[2]]));
const progress = Core.computeProgress(counts);
const daily = Core.summarizeDailyIssues(issuesToday);
const agg = Core.aggregateIssues(issuesToday, []);

// ── 보고서 출력 ──
const bar = '─'.repeat(50);
const sevLine = Core.SEVERITIES
  .map((s) => s + ' ' + (agg.rows[s].registered - agg.rows[s].fixed))
  .join(' / ');

console.log(bar);
console.log('  QA 일일 보고 (자동 생성)  |  ' + TODAY);
console.log(bar);
console.log('  TC 수행     : ' + todayTc.length + '건  (어제 수행분 1건 자동 제외됨: ' + (tcRows.length - todayTc.length) + '건)');
console.log('  결과 분포   : Pass ' + counts.pass + ' / Fail ' + counts.fail + ' / Block ' + counts.block +
  ' / N-A ' + counts.na + ' / No Run ' + counts.noRun);
console.log('  진행률      : ' + Core.formatPercent(progress.progressRate) +
  '   성공률: ' + Core.formatPercent(progress.successRate));
console.log('  당일 이슈   : ' + daily.text);
console.log('  미종료 잔존 : ' + sevLine);
console.log(bar);
console.log('');
console.log('▼ 고객사 전달용 보고 본문 자동 조립 (원본 Daily Report!C7 로직):');
console.log('');
const keys = Core.listDailyIssueKeys(
  issuesToday.map((i) => ({ key: i.key, date: TODAY, status: i.status })), TODAY);
console.log(Core.buildDailyReportMessage({
  team: 'QA 1팀', name: '오대훈', date: TODAY,
  counts, issueLine: daily.text, issueKeys: keys,
}));
console.log('');
console.log(bar);
console.log('  * 실제 운영에서는 이 본문이 보고서 시트로 생성되고,');
console.log('    시간 트리거(Triggers.js)가 매일 자동 실행·발송합니다.');
console.log(bar);
