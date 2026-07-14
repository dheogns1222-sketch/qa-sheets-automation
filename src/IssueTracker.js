/**
 * @file IssueTracker.js — 이슈 시트 집계 (심각도별/상태별, 잔존 이슈 추적).
 *
 * 원본 'Total BTS status' 표의 재구현:
 *   =IF(COUNTIFS(Issuelist!H:H,"Highest",Issuelist!I:I,"이슈 종료")=0,"-",...)
 * 심각도(Highest~Lowest) x (총 등록/수정 확인/잔존/보류/논이슈) 매트릭스를
 * Issuelist(등록 이슈)와 Issue_Checklist(수정 확인 체크) 두 시트에서 만든다.
 */

/** 집계 결과를 쓰는 시트 이름. */
var ISSUE_SUMMARY_SHEET_NAME = 'Issue Summary';

/**
 * 이슈 심각도별 현황을 집계해 'Issue Summary' 시트에 쓴다.
 * @returns {{rows: Object, totals: Object, severities: string[]}} Core.aggregateIssues 결과
 */
function refreshIssueSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = getConfig(ss);
  var issues = readIssueRows_(ss, config);
  var checklist = readChecklistRows_(ss, config);
  if (!issues.length && !checklist.length) {
    throw new Error("'" + config.ISSUE_SHEET + "' / '" + config.CHECKLIST_SHEET + "' 시트에서 이슈를 찾지 못했습니다.");
  }
  var aggregate = Core.aggregateIssues(issues, checklist);
  writeIssueSummarySheet_(ss, aggregate, config);
  return aggregate;
}

/**
 * 심각도 매트릭스를 시트에 기록하고 색상 규약을 적용한다.
 * 0 건은 원본과 같이 '-' 로 표기한다.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {{severities: string[], rows: Object, totals: Object}} aggregate
 * @param {Object<string, *>} config
 */
function writeIssueSummarySheet_(ss, aggregate, config) {
  var header = ['심각도', '총 등록', '수정 확인', '잔존', '보류', '논이슈'];
  var rows = [header];

  aggregate.severities.forEach(function (severity) {
    var metrics = aggregate.rows[severity];
    rows.push([
      severity,
      dashIfZero_(metrics.registered),
      dashIfZero_(metrics.fixed),
      dashIfZero_(metrics.remaining),
      dashIfZero_(metrics.onHold),
      dashIfZero_(metrics.nonIssue)
    ]);
  });

  var totals = aggregate.totals;
  rows.push([
    '합계',
    dashIfZero_(totals.registered),
    dashIfZero_(totals.fixed),
    dashIfZero_(totals.remaining),
    dashIfZero_(totals.onHold),
    dashIfZero_(totals.nonIssue)
  ]);

  var sheet = resetSheet_(ss, ISSUE_SUMMARY_SHEET_NAME);
  sheet.getRange(1, 1, rows.length, header.length).setValues(rows);

  var palette = getPalette(config.REPORT_PALETTE);
  applyHeaderStyle(sheet.getRange(1, 1, 1, header.length), palette.SUBTITLE);
  applyHeaderStyle(sheet.getRange(rows.length, 1, 1, header.length), palette.SUB1);
  paintSeverityColumn(sheet.getRange(2, 1, aggregate.severities.length, 1));
  sheet.setFrozenRows(1);
  sheet.setTabColor(STYLE.TAB.LOCKED);

  if (totals.unclassified > 0) {
    sheet.getRange(rows.length + 2, 1).setValue(
      '주의: 심각도를 해석하지 못한 항목 ' + totals.unclassified + '건이 있습니다 (합계에만 포함).'
    );
  }
}

/**
 * 0이면 '-'로 바꾼다 (원본 표기 규약).
 * @param {number} value
 * @returns {number|string}
 */
function dashIfZero_(value) {
  return value === 0 ? '-' : value;
}
