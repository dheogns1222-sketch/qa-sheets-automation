/**
 * @file Menu.js — 문서를 열 때 'QA 자동화' 커스텀 메뉴를 추가.
 *
 * 메뉴 항목은 실패 시 원인을 알림창으로 보여 주는 래퍼를 거친다.
 * (트리거 컨텍스트에서 호출되는 함수들은 getUi()를 쓰지 않도록 분리)
 */

/**
 * onOpen 단순 트리거: 커스텀 메뉴 등록.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('QA 자동화')
    .addItem('일일 보고서 생성', 'menuCreateDailyReport')
    .addItem('이슈 집계 갱신', 'menuRefreshIssueSummary')
    .addItem('TC 진행률 갱신', 'menuRefreshTcProgress')
    .addSeparator()
    .addItem('일일 자동 발송 켜기', 'menuInstallTrigger')
    .addItem('일일 자동 발송 끄기', 'menuRemoveTrigger')
    .addToUi();
}

/** 메뉴: 일일 보고서 생성. */
function menuCreateDailyReport() {
  runMenuAction_('일일 보고서 생성', function () {
    var result = createDailyReport();
    return "'" + result.sheetName + "' 시트를 생성했습니다.\n금일 등록 이슈: " + result.summaryText;
  });
}

/** 메뉴: 이슈 집계 갱신. */
function menuRefreshIssueSummary() {
  runMenuAction_('이슈 집계 갱신', function () {
    var aggregate = refreshIssueSummary();
    return "'" + ISSUE_SUMMARY_SHEET_NAME + "' 시트를 갱신했습니다.\n총 등록 " +
      aggregate.totals.registered + '건 / 잔존 ' + aggregate.totals.remaining + '건';
  });
}

/** 메뉴: TC 진행률 갱신. */
function menuRefreshTcProgress() {
  runMenuAction_('TC 진행률 갱신', function () {
    var report = refreshTcProgress();
    return "'" + TC_PROGRESS_SHEET_NAME + "' 시트를 갱신했습니다. (문서 " + report.length + '개 집계)';
  });
}

/** 메뉴: 자동 발송 트리거 설치. */
function menuInstallTrigger() {
  runMenuAction_('일일 자동 발송', installDailyReportTrigger);
}

/** 메뉴: 자동 발송 트리거 제거. */
function menuRemoveTrigger() {
  runMenuAction_('일일 자동 발송', removeDailyReportTrigger);
}

/**
 * 메뉴 액션 공통 래퍼: 결과/오류를 알림창으로 보여 준다.
 * @param {string} title 알림창 제목
 * @param {function(): string} action 실행할 액션 (안내 문구 반환)
 */
function runMenuAction_(title, action) {
  var ui = SpreadsheetApp.getUi();
  try {
    ui.alert(title, action(), ui.ButtonSet.OK);
  } catch (error) {
    ui.alert(title + ' 실패', String((error && error.message) || error), ui.ButtonSet.OK);
  }
}
