/**
 * @file Config.js — 'Config' / 'TC Documents' 시트 파싱과 기본값 관리.
 *
 * 리더 문서 안의 두 설정 시트를 읽는다.
 * - Config 시트: A열 키, B열 값. '#'으로 시작하는 행은 주석.
 * - TC Documents 시트: A열 "문서 이름 (스프레드시트ID)" 또는 B열에 ID 직접 기입.
 *   (원본 규약 유지 — 시트 이름에 ID를 괄호로 넣던 REGEXEXTRACT 방식과 호환)
 */

/** 설정 시트 이름. */
var CONFIG_SHEET_NAME = 'Config';

/** TC 문서 목록 시트 이름. */
var TC_DOCS_SHEET_NAME = 'TC Documents';

/**
 * 설정 기본값. Config 시트의 같은 키가 있으면 덮어쓴다.
 * *_COL 값은 1-기준 열 번호(A=1)다.
 * @type {Object<string, *>}
 */
var CONFIG_DEFAULTS = {
  PROJECT_NAME: '(미설정 프로젝트)',
  TEAM_NAME: '',
  AUTHOR: '',
  BUILD: '-',

  // 보고서 스타일: CLIENT(블루) | INTERNAL(브라운) | LONG_SESSION(그린)
  REPORT_PALETTE: 'CLIENT',

  // 자동 발송
  REPORT_HOUR: 18,
  MAIL_RECIPIENTS: '',
  SLACK_WEBHOOK_URL: '',

  // Issuelist 시트 레이아웃 (BTS 내보내기 결과)
  ISSUE_SHEET: 'Issuelist',
  ISSUE_HEADER_ROW: 1,
  ISSUE_KEY_COL: 1,      // A: 이슈 키
  ISSUE_SUMMARY_COL: 2,  // B: 요약
  ISSUE_SEVERITY_COL: 3, // C: 심각도 (Highest~Lowest)
  ISSUE_STATUS_COL: 4,   // D: 상태 (이슈 종료 / 재발생 / 보류 / ...)
  ISSUE_CREATED_COL: 5,  // E: 등록일

  // Issue_Checklist 시트 레이아웃 (수정 확인 체크)
  CHECKLIST_SHEET: 'Issue_Checklist',
  CHECKLIST_HEADER_ROW: 1,
  CHECK_KEY_COL: 1,      // A: 이슈 키
  CHECK_SEVERITY_COL: 2, // B: 심각도
  CHECK_RESULT_COL: 3,   // C: 확인 결과 (PASSED / FAILED / UNTESTED / N/A)

  // TC 문서에서 결과값을 탐색할 열 범위 (원본 COUNTIFS I:AZ 스캔과 동일)
  TC_RESULT_COL_START: 9,  // I
  TC_RESULT_COL_END: 52    // AZ
};

/** 숫자로 강제 변환해야 하는 설정 키의 패턴. */
var NUMERIC_CONFIG_KEY = /(_COL|_ROW|_HOUR)$/;

/**
 * Config 시트와 기본값을 병합한 설정 객체를 돌려준다.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss] 대상 문서 (기본: 활성 문서)
 * @returns {Object<string, *>} 병합된 설정
 */
function getConfig(ss) {
  var spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(CONFIG_SHEET_NAME);
  var overrides = sheet ? Core.parseConfigSheet(sheet.getDataRange().getValues()) : {};
  var config = {};
  Object.keys(CONFIG_DEFAULTS).forEach(function (key) {
    config[key] = CONFIG_DEFAULTS[key];
  });
  Object.keys(overrides).forEach(function (key) {
    var value = overrides[key];
    if (NUMERIC_CONFIG_KEY.test(key)) {
      var num = Number(value);
      if (isFinite(num) && num > 0) config[key] = num;
      return;
    }
    if (value !== '') config[key] = value;
  });
  return config;
}

/**
 * TC Documents 시트에 등록된 TC 문서 목록을 돌려준다.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss] 대상 문서 (기본: 활성 문서)
 * @returns {Array<{label: string, id: string}>} 문서 라벨과 스프레드시트 ID
 */
function getTcDocuments(ss) {
  var spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(TC_DOCS_SHEET_NAME);
  if (!sheet) return [];
  return Core.parseProjectTable(sheet.getDataRange().getValues());
}

/**
 * Issuelist 시트를 이슈 객체 배열로 읽는다.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {Object<string, *>} config getConfig() 결과
 * @returns {Array<{key: string, summary: string, severity: *, status: *, createdKey: (string|null)}>}
 */
function readIssueRows_(ss, config) {
  var sheet = ss.getSheetByName(config.ISSUE_SHEET);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  var issues = [];
  for (var i = config.ISSUE_HEADER_ROW; i < values.length; i++) {
    var row = values[i];
    var key = String(row[config.ISSUE_KEY_COL - 1] || '').trim();
    var severity = row[config.ISSUE_SEVERITY_COL - 1];
    var status = row[config.ISSUE_STATUS_COL - 1];
    if (!key && !severity && !status) continue; // 빈 행
    issues.push({
      key: key,
      summary: String(row[config.ISSUE_SUMMARY_COL - 1] || '').trim(),
      severity: severity,
      status: status,
      createdKey: Core.toDateKey(row[config.ISSUE_CREATED_COL - 1])
    });
  }
  return issues;
}

/**
 * Issue_Checklist 시트를 체크 항목 배열로 읽는다.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {Object<string, *>} config getConfig() 결과
 * @returns {Array<{key: string, severity: *, checkResult: *}>}
 */
function readChecklistRows_(ss, config) {
  var sheet = ss.getSheetByName(config.CHECKLIST_SHEET);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  var entries = [];
  for (var i = config.CHECKLIST_HEADER_ROW; i < values.length; i++) {
    var row = values[i];
    var key = String(row[config.CHECK_KEY_COL - 1] || '').trim();
    var severity = row[config.CHECK_SEVERITY_COL - 1];
    var checkResult = row[config.CHECK_RESULT_COL - 1];
    if (!key && !severity && !checkResult) continue;
    entries.push({ key: key, severity: severity, checkResult: checkResult });
  }
  return entries;
}
