/**
 * @file DailyReport.js — 당일 테스트 결과 자동 집계 + 보고서 시트 생성.
 *
 * 원본 '일일 업무 보고서'의 재구현. 수식판은
 *   =COUNTIFS(Issuelist!M:M, TEXT(L5,"yyyy-mm-dd")) (당일 필터, 보조 열 M 필요)
 *   =ARRAYFORMULA(...) 로 인사말과 요약 문구를 조립했다.
 * 코드판은 Core.toDateKey 로 보조 열 없이 당일 이슈를 거르고,
 * 이슈 요약 + 심각도 매트릭스 + TC 진행률을 한 시트에 생성한다.
 */

/** 보고서 시트 열 너비 (A~I). */
var REPORT_WIDTH = 9;

/**
 * @typedef {Object} DailyReportResult
 * @property {string} sheetName 생성된 보고서 시트 이름
 * @property {string} dateKey 보고 기준일 (yyyy-MM-dd)
 * @property {string} summaryText 당일 등록 이슈 요약 문구
 * @property {number} remaining 전체 잔존 이슈 건수
 */

/**
 * 오늘 날짜 기준 일일 보고서 시트를 생성한다.
 * 같은 날짜 시트가 이미 있으면 지우고 다시 만든다 (재실행 안전).
 * @returns {DailyReportResult}
 */
function createDailyReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = getConfig(ss);
  var timezone = ss.getSpreadsheetTimeZone();
  var dateKey = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');

  // 1) 이슈 집계 — 당일 등록분 + 전체 심각도 매트릭스
  var issues = readIssueRows_(ss, config);
  var checklist = readChecklistRows_(ss, config);
  var todayIssues = issues.filter(function (issue) { return issue.createdKey === dateKey; });
  var daily = Core.summarizeDailyIssues(todayIssues);
  var aggregate = Core.aggregateIssues(issues, checklist);

  // 2) TC 진행률 — 등록된 TC 문서 크로스 집계
  var docs = getTcDocuments(ss);
  var tcReport = docs.length ? collectTcProgress_(docs, config) : [];

  // 3) 보고서 시트 조립
  var built = buildReportRows_(config, dateKey, daily, aggregate, tcReport);
  var sheetName = 'Daily Report ' + dateKey;
  var sheet = resetSheet_(ss, sheetName);
  sheet.getRange(1, 1, built.rows.length, REPORT_WIDTH).setValues(built.rows);
  decorateReportSheet_(sheet, built, config, aggregate);

  return {
    sheetName: sheetName,
    dateKey: dateKey,
    summaryText: daily.text,
    remaining: aggregate.totals.remaining
  };
}

/**
 * 보고서 본문 2차원 배열과 스타일 마킹 정보를 만든다.
 * @param {Object<string, *>} config
 * @param {string} dateKey
 * @param {{registered: number, fixed: number, text: string}} daily
 * @param {{severities: string[], rows: Object, totals: Object}} aggregate
 * @param {Array} tcReport collectTcProgress_ 결과
 * @returns {{rows: Array<Array<*>>, marks: Object<string, number[]>, severityStartRow: number}}
 */
function buildReportRows_(config, dateKey, daily, aggregate, tcReport) {
  var rows = [];
  var marks = { title: [], section: [], tableHeader: [] };

  /**
   * @param {Array<*>} cells
   * @param {string} [mark] 'title'|'section'|'tableHeader'
   */
  function push(cells, mark) {
    var row = cells.slice();
    while (row.length < REPORT_WIDTH) row.push('');
    rows.push(row);
    if (mark) marks[mark].push(rows.length); // 1-기준 행 번호
  }

  push(['[' + config.PROJECT_NAME + '] ' + dateKey + ' 일일 업무 보고서'], 'title');
  push([]);
  push(['안녕하세요. ' + [config.TEAM_NAME, config.AUTHOR].filter(String).join(' ') + '입니다.']);
  push(['금일 진행된 업무 대응 내용 및 테스트 진행 결과에 대해 하기와 같이 전달드립니다.']);
  push([]);
  push(['Project', config.PROJECT_NAME]);
  push(['Build', config.BUILD]);
  push(['Date', dateKey]);
  push(['작성자', config.AUTHOR || '-']);
  push([]);

  push(['1. 금일 이슈 등록 현황'], 'section');
  push(['  총 등록', daily.text]);
  push(['  수정 확인', daily.fixed > 0 ? daily.fixed + '건' : '-']);
  push(['  잔존 이슈(전체)', aggregate.totals.remaining > 0 ? aggregate.totals.remaining + '건' : '-']);
  push([]);

  push(['2. 심각도별 이슈 현황'], 'section');
  push(['심각도', '총 등록', '수정 확인', '잔존', '보류', '논이슈'], 'tableHeader');
  var severityStartRow = rows.length + 1;
  aggregate.severities.forEach(function (severity) {
    var metrics = aggregate.rows[severity];
    push([
      severity,
      dashIfZero_(metrics.registered),
      dashIfZero_(metrics.fixed),
      dashIfZero_(metrics.remaining),
      dashIfZero_(metrics.onHold),
      dashIfZero_(metrics.nonIssue)
    ]);
  });
  push([]);

  push(['3. TC 진행 현황'], 'section');
  if (tcReport.length) {
    push(['TC 문서', '시트', '진행률', '성공률', 'Pass', 'Fail', 'Block', 'N/A', 'No Run'], 'tableHeader');
    tcReport.forEach(function (item) {
      item.sheets.forEach(function (sheet) {
        push([
          item.doc.label, sheet.name,
          Core.formatPercent(sheet.progress.progressRate),
          Core.formatPercent(sheet.progress.successRate),
          sheet.counts.pass, sheet.counts.fail, sheet.counts.block,
          sheet.counts.na, sheet.counts.noRun
        ]);
      });
      push([
        item.doc.label, '(소계)',
        Core.formatPercent(item.totals.progress.progressRate),
        Core.formatPercent(item.totals.progress.successRate),
        item.totals.counts.pass, item.totals.counts.fail, item.totals.counts.block,
        item.totals.counts.na, item.totals.counts.noRun
      ]);
    });
  } else {
    push(["('TC Documents' 시트에 등록된 TC 문서 없음)"]);
  }

  return { rows: rows, marks: marks, severityStartRow: severityStartRow };
}

/**
 * 보고서 시트에 색상 규약을 적용한다.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {{rows: Array, marks: Object<string, number[]>, severityStartRow: number}} built
 * @param {Object<string, *>} config
 * @param {{severities: string[]}} aggregate
 */
function decorateReportSheet_(sheet, built, config, aggregate) {
  var palette = getPalette(config.REPORT_PALETTE);
  built.marks.title.forEach(function (rowIndex) {
    var range = sheet.getRange(rowIndex, 1, 1, REPORT_WIDTH);
    range.merge();
    applyHeaderStyle(range, palette.TITLE);
    range.setHorizontalAlignment('center');
  });
  built.marks.section.forEach(function (rowIndex) {
    applyHeaderStyle(sheet.getRange(rowIndex, 1, 1, REPORT_WIDTH), palette.SUBTITLE);
  });
  built.marks.tableHeader.forEach(function (rowIndex) {
    applyHeaderStyle(sheet.getRange(rowIndex, 1, 1, REPORT_WIDTH), palette.SUB1);
  });
  paintSeverityColumn(sheet.getRange(built.severityStartRow, 1, aggregate.severities.length, 1));
  sheet.setTabColor(STYLE.TAB.VIEWER); // 보고서는 열람용 시트
}
