/**
 * @file Triggers.js — 시간 기반 트리거로 일일 보고 자동 실행/발송.
 *
 * 수식판에서는 리더가 매일 보고서 시트를 열어 표를 복사·전달해야 했다.
 * 코드판은 지정 시각(Config: REPORT_HOUR)에 보고서를 생성하고
 * 메일(MailApp)과 Slack incoming webhook(UrlFetchApp) 으로 요약을 보낸다.
 */

/** 일일 트리거가 호출하는 핸들러 함수 이름. */
var DAILY_TRIGGER_HANDLER = 'runDailyReportJob';

/**
 * 일일 보고 트리거를 설치한다. 기존 트리거가 있으면 교체한다.
 * @returns {string} 안내 메시지
 */
function installDailyReportTrigger() {
  var config = getConfig();
  removeDailyReportTrigger();
  ScriptApp.newTrigger(DAILY_TRIGGER_HANDLER)
    .timeBased()
    .atHour(config.REPORT_HOUR)
    .everyDays(1)
    .create();
  return '매일 ' + config.REPORT_HOUR + '시에 일일 보고서를 자동 생성/발송합니다.';
}

/**
 * 설치된 일일 보고 트리거를 모두 제거한다.
 * @returns {string} 안내 메시지
 */
function removeDailyReportTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === DAILY_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return removed > 0 ? '자동 발송 트리거를 제거했습니다.' : '설치된 트리거가 없습니다.';
}

/**
 * 트리거 진입점: 보고서 생성 후 메일/Slack 발송.
 * MAIL_RECIPIENTS / SLACK_WEBHOOK_URL 이 비어 있으면 해당 채널은 건너뛴다.
 */
function runDailyReportJob() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = getConfig(ss);
  var result = createDailyReport();
  var subject = '[' + config.PROJECT_NAME + '] ' + result.dateKey + ' 일일 업무 보고';
  var body = buildReportBody_(config, result, ss.getUrl());

  if (config.MAIL_RECIPIENTS) {
    MailApp.sendEmail(config.MAIL_RECIPIENTS, subject, body);
  }
  if (config.SLACK_WEBHOOK_URL) {
    postToSlack_(config.SLACK_WEBHOOK_URL, subject + '\n' + body);
  }
}

/**
 * 발송용 본문 텍스트를 만든다 (원본 보고서 인사말 형식 유지).
 * @param {Object<string, *>} config
 * @param {DailyReportResult} result createDailyReport() 결과
 * @param {string} url 리더 문서 URL
 * @returns {string}
 */
function buildReportBody_(config, result, url) {
  var sender = [config.TEAM_NAME, config.AUTHOR].filter(String).join(' ');
  return [
    '안녕하세요. ' + (sender || 'QA팀') + '입니다.',
    '금일 진행된 업무 대응 내용 및 테스트 진행 결과에 대해 하기와 같이 전달드립니다.',
    '',
    '1. 금일 등록 이슈: ' + result.summaryText,
    '2. 잔존 이슈(전체): ' + (result.remaining > 0 ? result.remaining + '건' : '-'),
    '',
    '상세 보고서: ' + url + ' (시트: ' + result.sheetName + ')'
  ].join('\n');
}

/**
 * Slack incoming webhook 으로 텍스트 메시지를 보낸다.
 * @param {string} webhookUrl Slack incoming webhook URL
 * @param {string} text 보낼 메시지
 */
function postToSlack_(webhookUrl, text) {
  UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  });
}
