/**
 * @file TcProgress.js — TC 문서들을 순회하며 진행률/성공률을 크로스 집계.
 *
 * 원본은 IMPORTRANGE + REGEXEXTRACT 로 TE 문서의 통계 시트를 당겨 왔다:
 *   =IMPORTRANGE("https://docs.google.com/spreadsheets/d/"
 *                 & REGEXEXTRACT(E5, "\((.*?)\)") & "/edit", "통계!K3")
 * 코드판은 같은 명명 규약("문서 이름 (ID)")을 SpreadsheetApp.openById 로
 * 재구현한다. IMPORTRANGE 승인 절차와 재계산 지연이 사라지고,
 * TE 문서마다 통계/SheetTracking 보조 시트를 둘 필요가 없어진다.
 */

/** 집계 결과를 쓰는 시트 이름. */
var TC_PROGRESS_SHEET_NAME = 'TC Progress';

/** TC 문서 안에서 집계 대상에서 제외할 메타 시트 이름들. */
var TC_META_SHEETS = ['통계', 'Home', '이슈 추적기', 'SheetTracking', 'Cover', 'Config', 'Test Guide'];

/**
 * @typedef {Object} SheetProgress
 * @property {string} name TC 시트 이름
 * @property {Object} counts Core.countResults 결과
 * @property {Object} progress Core.computeProgress 결과
 */

/**
 * @typedef {Object} DocumentProgress
 * @property {{label: string, id: string}} doc TC 문서 정보
 * @property {SheetProgress[]} sheets 시트별 집계
 * @property {{counts: Object, progress: Object}} totals 문서 합계
 */

/**
 * 등록된 모든 TC 문서의 진행률을 집계해 'TC Progress' 시트에 쓴다.
 * 커스텀 메뉴와 일일 트리거 양쪽에서 호출된다.
 * @returns {DocumentProgress[]} 문서별 집계 결과
 */
function refreshTcProgress() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = getConfig(ss);
  var docs = getTcDocuments(ss);
  if (!docs.length) {
    throw new Error("'" + TC_DOCS_SHEET_NAME + "' 시트에 TC 문서가 없습니다. \"문서 이름 (스프레드시트ID)\" 형식으로 등록하세요.");
  }
  var report = collectTcProgress_(docs, config);
  writeTcProgressSheet_(ss, report, config);
  return report;
}

/**
 * TC 문서 목록을 순회하며 시트별/문서별 결과 건수를 수집한다.
 * @param {Array<{label: string, id: string}>} docs TC 문서 목록
 * @param {Object<string, *>} config getConfig() 결과
 * @returns {DocumentProgress[]}
 */
function collectTcProgress_(docs, config) {
  var startIndex = config.TC_RESULT_COL_START - 1;
  var endIndex = config.TC_RESULT_COL_END - 1;
  return docs.map(function (doc) {
    var file = SpreadsheetApp.openById(doc.id);
    var sheets = file.getSheets().filter(function (sheet) {
      return TC_META_SHEETS.indexOf(sheet.getName()) === -1;
    });
    var perSheet = sheets.map(function (sheet) {
      var values = sheet.getDataRange().getValues();
      var resultValues = values.map(function (row) {
        return row.slice(startIndex, endIndex + 1);
      });
      var counts = Core.countResults(resultValues);
      return { name: sheet.getName(), counts: counts, progress: Core.computeProgress(counts) };
    });
    var totalCounts = Core.mergeCounts(perSheet.map(function (item) { return item.counts; }));
    return {
      doc: doc,
      sheets: perSheet,
      totals: { counts: totalCounts, progress: Core.computeProgress(totalCounts) }
    };
  });
}

/**
 * 집계 결과를 'TC Progress' 시트에 표로 기록한다.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {DocumentProgress[]} report
 * @param {Object<string, *>} config
 */
function writeTcProgressSheet_(ss, report, config) {
  var header = ['TC 문서', '시트', '진행률', '성공률', 'Pass', 'Fail', 'Block', 'N/A', 'No Run', 'Total'];
  var rows = [header];
  var subtotalRowIndexes = [];

  report.forEach(function (item) {
    item.sheets.forEach(function (sheet) {
      rows.push([
        item.doc.label,
        sheet.name,
        Core.formatPercent(sheet.progress.progressRate),
        Core.formatPercent(sheet.progress.successRate),
        sheet.counts.pass, sheet.counts.fail, sheet.counts.block,
        sheet.counts.na, sheet.counts.noRun, sheet.counts.total
      ]);
    });
    var totals = item.totals;
    rows.push([
      item.doc.label,
      '(소계)',
      Core.formatPercent(totals.progress.progressRate),
      Core.formatPercent(totals.progress.successRate),
      totals.counts.pass, totals.counts.fail, totals.counts.block,
      totals.counts.na, totals.counts.noRun, totals.counts.total
    ]);
    subtotalRowIndexes.push(rows.length);
  });

  var grand = Core.mergeCounts(report.map(function (item) { return item.totals.counts; }));
  var grandProgress = Core.computeProgress(grand);
  rows.push([
    '전체', '(합계)',
    Core.formatPercent(grandProgress.progressRate),
    Core.formatPercent(grandProgress.successRate),
    grand.pass, grand.fail, grand.block, grand.na, grand.noRun, grand.total
  ]);
  var grandRowIndex = rows.length;

  var sheet = resetSheet_(ss, TC_PROGRESS_SHEET_NAME);
  sheet.getRange(1, 1, rows.length, header.length).setValues(rows);

  var palette = getPalette(config.REPORT_PALETTE);
  applyHeaderStyle(sheet.getRange(1, 1, 1, header.length), palette.SUBTITLE);
  subtotalRowIndexes.forEach(function (rowIndex) {
    applyHeaderStyle(sheet.getRange(rowIndex, 1, 1, header.length), palette.SUB2);
  });
  applyHeaderStyle(sheet.getRange(grandRowIndex, 1, 1, header.length), palette.SUB1);
  sheet.setFrozenRows(1);
  sheet.setTabColor(STYLE.TAB.LOCKED); // 스크립트 출력 시트 — 수동 수정 금지
}

/**
 * 이름이 같은 시트가 있으면 비우고, 없으면 새로 만든다.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} name 시트 이름
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function resetSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}
