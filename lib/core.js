/**
 * @file core.js — 순수 집계 로직 (Google Apps Script + Node.js 겸용).
 *
 * Google Sheets API에 의존하지 않는 계산 로직만 모아 둔 모듈이다.
 * - Apps Script(V8)에서는 전역 객체 `Core`로 노출된다 (clasp push 대상).
 * - Node.js에서는 CommonJS 모듈로 로드되어 `node --test`로 단위 테스트한다.
 *
 * 원본 수식 대응 관계:
 * - parseSheetIdFromName  ← REGEXEXTRACT(E5, "\((.*?)\)")
 * - countResults          ← COUNTIFS(INDIRECT("'"&C9&"'!$I:$AZ"), "Pass") 계열
 * - computeProgress       ← IFERROR((F+G+H)/(K-I), "0%") / IFERROR(F/(F+G+H), "0%")
 * - toDateKey/filterRowsByDate ← COUNTIFS(Issuelist!M:M, TEXT(TODAY(), "yyyy-mm-dd"))
 * - mapIssueStatusToResult ← IF(I9="이슈 종료","PASSED",IF(I9="재발생","FAILED","UNTESTED"))
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(); // Node.js
  } else {
    root.Core = factory(); // Google Apps Script (V8 globalThis)
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 테스트 결과 라벨 (원본 '결과값' 체계 그대로). */
  var RESULT_LABELS = ['Pass', 'Fail', 'Block', 'N/A', 'No Run'];

  /** 이슈 심각도 라벨 (원본 '심각도' 체계 그대로, 높은 순). */
  var SEVERITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

  /** Google Sheets 날짜 시리얼의 Unix epoch(1970-01-01) 오프셋. */
  var SHEETS_EPOCH_OFFSET = 25569;
  var MS_PER_DAY = 86400000;

  /**
   * @typedef {Object} ResultCounts
   * @property {number} pass
   * @property {number} fail
   * @property {number} block
   * @property {number} na    - "N/A" (테스트 제외 대상)
   * @property {number} noRun - "No Run" (미수행)
   * @property {number} total - 5개 라벨 합계
   */

  /**
   * @typedef {Object} ProgressSummary
   * @property {number} executed     - 수행 완료 건수 (Pass+Fail+Block)
   * @property {number} progressRate - 진행률 = executed / (total - na)
   * @property {number} successRate  - 성공률 = pass / executed
   */

  /**
   * @typedef {Object} IssueMetrics
   * @property {number} registered - 총 등록
   * @property {number} fixed      - 수정 확인 (상태 = 이슈 종료)
   * @property {number} onHold     - 보류
   * @property {number} remaining  - 잔존 (체크 결과 = UNTESTED)
   * @property {number} nonIssue   - 논이슈 (체크 결과 = N/A)
   */

  /** @param {number} n @returns {string} 2자리 0 패딩 */
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /**
   * 셀 값을 표준 결과 라벨로 정규화한다. 대소문자/공백 변형을 흡수한다.
   * @param {*} value 셀 값
   * @returns {string|null} 'Pass'|'Fail'|'Block'|'N/A'|'No Run' 또는 null(결과값 아님)
   */
  function normalizeResult(value) {
    if (value === null || value === undefined) return null;
    var text = String(value).trim().toLowerCase();
    if (!text) return null;
    if (text === 'pass') return 'Pass';
    if (text === 'fail') return 'Fail';
    if (text === 'block' || text === 'blocked') return 'Block';
    if (text === 'n/a' || text === 'na') return 'N/A';
    if (text === 'no run' || text === 'norun' || text === 'no-run') return 'No Run';
    return null;
  }

  /**
   * 심각도 값을 표준 라벨로 정규화한다.
   * @param {*} value
   * @returns {string|null} SEVERITIES 중 하나 또는 null
   */
  function normalizeSeverity(value) {
    if (value === null || value === undefined) return null;
    var text = String(value).trim().toLowerCase();
    if (!text) return null;
    for (var i = 0; i < SEVERITIES.length; i++) {
      if (SEVERITIES[i].toLowerCase() === text) return SEVERITIES[i];
    }
    return null;
  }

  /**
   * 2차원 범위 값에서 결과 라벨별 건수를 센다.
   * 원본: COUNTIFS(INDIRECT("'"&$C9&"'!$I:$AZ"), "Pass") — TC 시트당 5개 수식.
   * @param {Array<Array<*>>} values 시트 범위 값 (getValues() 형태)
   * @returns {ResultCounts}
   */
  function countResults(values) {
    var counts = { pass: 0, fail: 0, block: 0, na: 0, noRun: 0, total: 0 };
    if (!Array.isArray(values)) return counts;
    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      if (!Array.isArray(row)) continue;
      for (var c = 0; c < row.length; c++) {
        var label = normalizeResult(row[c]);
        if (label === 'Pass') counts.pass++;
        else if (label === 'Fail') counts.fail++;
        else if (label === 'Block') counts.block++;
        else if (label === 'N/A') counts.na++;
        else if (label === 'No Run') counts.noRun++;
        else continue;
        counts.total++;
      }
    }
    return counts;
  }

  /**
   * 여러 시트의 ResultCounts를 합산한다 (문서 단위 크로스 집계).
   * @param {ResultCounts[]} list
   * @returns {ResultCounts}
   */
  function mergeCounts(list) {
    var merged = { pass: 0, fail: 0, block: 0, na: 0, noRun: 0, total: 0 };
    (list || []).forEach(function (c) {
      if (!c) return;
      merged.pass += c.pass || 0;
      merged.fail += c.fail || 0;
      merged.block += c.block || 0;
      merged.na += c.na || 0;
      merged.noRun += c.noRun || 0;
      merged.total += c.total || 0;
    });
    return merged;
  }

  /**
   * 진행률/성공률을 계산한다. 0 나눗셈은 0으로 처리한다.
   * 원본: 진행률 =IFERROR((F9+G9+H9)/(K9-I9), "0%"), 성공률 =IFERROR(F9/(F9+G9+H9), "0%")
   * @param {ResultCounts} counts
   * @returns {ProgressSummary}
   */
  function computeProgress(counts) {
    var executed = (counts.pass || 0) + (counts.fail || 0) + (counts.block || 0);
    var denominator = (counts.total || 0) - (counts.na || 0);
    return {
      executed: executed,
      progressRate: denominator > 0 ? executed / denominator : 0,
      successRate: executed > 0 ? (counts.pass || 0) / executed : 0
    };
  }

  /**
   * 비율을 퍼센트 문자열로 만든다. 소수부 말미의 0은 제거한다.
   * @param {number} ratio 0~1 비율
   * @param {number} [digits=1] 소수 자릿수
   * @returns {string} 예: 0.875 → '87.5%', 1 → '100%'
   */
  function formatPercent(ratio, digits) {
    if (typeof ratio !== 'number' || !isFinite(ratio)) return '-';
    var d = typeof digits === 'number' ? digits : 1;
    var text = (ratio * 100).toFixed(d);
    if (d > 0) text = text.replace(/\.?0+$/, '');
    return text + '%';
  }

  /**
   * "문서 이름 (스프레드시트ID)" 형식에서 ID를 추출한다.
   * 원본: REGEXEXTRACT(E5, "\((.*?)\)") + IMPORTRANGE 동적 참조.
   * @param {*} name 시트/문서 표시 이름
   * @returns {string|null} 괄호 안 ID 또는 null
   */
  function parseSheetIdFromName(name) {
    if (name === null || name === undefined) return null;
    var match = String(name).match(/\(([^)]+)\)/);
    if (!match) return null;
    var id = match[1].trim();
    return id ? id : null;
  }

  /**
   * 설정 시트(키-값 2열)를 객체로 파싱한다.
   * 빈 행과 '#'으로 시작하는 행(주석)은 건너뛰고, 중복 키는 마지막 값이 이긴다.
   * @param {Array<Array<*>>} values Config 시트의 getValues() 결과
   * @returns {Object<string, *>}
   */
  function parseConfigSheet(values) {
    var config = {};
    (values || []).forEach(function (row) {
      if (!Array.isArray(row) || row[0] === null || row[0] === undefined) return;
      var key = String(row[0]).trim();
      if (!key || key.charAt(0) === '#') return;
      var raw = row.length > 1 ? row[1] : '';
      config[key] = typeof raw === 'string' ? raw.trim() : (raw === null || raw === undefined ? '' : raw);
    });
    return config;
  }

  /**
   * TC 문서 목록 시트를 파싱한다.
   * 각 행: [표시 이름] 또는 [표시 이름, 스프레드시트 ID].
   * B열 ID가 비어 있으면 이름 속 "(ID)"에서 추출한다 (원본 명명 규약 유지).
   * '#'으로 시작하는 행은 주석으로 건너뛴다.
   * @param {Array<Array<*>>} values
   * @returns {Array<{label: string, id: string}>}
   */
  function parseProjectTable(values) {
    var docs = [];
    (values || []).forEach(function (row) {
      if (!Array.isArray(row)) return;
      var name = row[0] === null || row[0] === undefined ? '' : String(row[0]).trim();
      if (!name || name.charAt(0) === '#') return;
      var explicit = row.length > 1 && row[1] !== null && row[1] !== undefined ? String(row[1]).trim() : '';
      var id = explicit || parseSheetIdFromName(name);
      if (!id) return;
      var label = name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
      docs.push({ label: label, id: id });
    });
    return docs;
  }

  /**
   * 다양한 형태의 날짜 값을 'yyyy-mm-dd' 키로 정규화한다.
   * Date 객체, 'yyyy-mm-dd'·'yyyy.m.d'·'yyyy/m/d' 문자열,
   * Google Sheets 날짜 시리얼(예: 45657 → 2024-12-31)을 지원한다.
   * 원본은 보조 열(=TEXT(K9,"yyyy-mm-dd"))로 이 변환을 대신했다.
   * @param {*} value
   * @returns {string|null} 'yyyy-mm-dd' 또는 null(해석 불가)
   */
  function toDateKey(value) {
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return null;
      return value.getFullYear() + '-' + pad2(value.getMonth() + 1) + '-' + pad2(value.getDate());
    }
    if (typeof value === 'number' && isFinite(value) && value > 0) {
      var date = new Date(Math.round((value - SHEETS_EPOCH_OFFSET) * MS_PER_DAY));
      return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
    }
    if (typeof value === 'string') {
      var match = value.trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
      if (!match) return null;
      return match[1] + '-' + pad2(Number(match[2])) + '-' + pad2(Number(match[3]));
    }
    return null;
  }

  /**
   * 지정 열의 날짜가 대상 날짜와 같은 행만 남긴다 (당일 보고 필터).
   * 원본: COUNTIFS(Issuelist!M:M, TEXT(L5, "yyyy-mm-dd")) 계열 수식.
   * @param {Array<Array<*>>} rows 데이터 행 배열
   * @param {number} dateIndex 날짜 열의 0-기준 인덱스
   * @param {Date|string|number} targetDate 기준 날짜
   * @returns {Array<Array<*>>} 필터링된 행
   */
  function filterRowsByDate(rows, dateIndex, targetDate) {
    var targetKey = toDateKey(targetDate);
    if (!targetKey || !Array.isArray(rows)) return [];
    return rows.filter(function (row) {
      return Array.isArray(row) && toDateKey(row[dateIndex]) === targetKey;
    });
  }

  /**
   * BTS 이슈 상태를 재확인(regression check) 기대 결과로 매핑한다.
   * 원본: =IF(I9="", "", IF(I9="이슈 종료", "PASSED", IF(I9="재발생", "FAILED", "UNTESTED")))
   * @param {*} status 이슈 상태 문자열
   * @returns {string} 'PASSED'|'FAILED'|'UNTESTED'|''(빈 상태)
   */
  function mapIssueStatusToResult(status) {
    var text = status === null || status === undefined ? '' : String(status).trim();
    if (!text) return '';
    if (text === '이슈 종료') return 'PASSED';
    if (text === '재발생') return 'FAILED';
    return 'UNTESTED';
  }

  /** @returns {IssueMetrics} */
  function emptyIssueMetrics() {
    return { registered: 0, fixed: 0, onHold: 0, remaining: 0, nonIssue: 0 };
  }

  /**
   * 심각도별 이슈 매트릭스를 만든다.
   * 원본 'Total BTS status' 표(우선순위 x 총 등록/수정 확인/잔존/보류/논이슈)의 재구현:
   * - 총 등록/수정 확인/보류 ← Issuelist (COUNTIFS(Issuelist!H:H, sev, Issuelist!I:I, status))
   * - 잔존/논이슈 ← Issue_Checklist (COUNTIFS(..., "UNTESTED") / (..., "N/A"))
   * @param {Array<{severity: *, status: *}>} registered 등록된 이슈 목록
   * @param {Array<{severity: *, checkResult: *}>} checklist 이슈 재확인 체크리스트
   * @param {{resolvedStatus?: string, holdStatus?: string, remainingResult?: string, nonIssueResult?: string}} [options]
   * @returns {{severities: string[], rows: Object<string, IssueMetrics>, totals: (IssueMetrics & {unclassified: number})}}
   */
  function aggregateIssues(registered, checklist, options) {
    var opts = options || {};
    var resolvedStatus = opts.resolvedStatus || '이슈 종료';
    var holdStatus = opts.holdStatus || '보류';
    var remainingResult = (opts.remainingResult || 'UNTESTED').toUpperCase();
    var nonIssueResult = (opts.nonIssueResult || 'N/A').toUpperCase();

    var rows = {};
    SEVERITIES.forEach(function (sev) {
      rows[sev] = emptyIssueMetrics();
    });
    var totals = emptyIssueMetrics();
    totals.unclassified = 0;

    function bump(severity, metric) {
      var canonical = normalizeSeverity(severity);
      if (canonical) rows[canonical][metric]++;
      totals[metric]++;
      return canonical;
    }

    (registered || []).forEach(function (issue) {
      var status = issue && issue.status !== null && issue.status !== undefined ? String(issue.status).trim() : '';
      var canonical = bump(issue && issue.severity, 'registered');
      if (!canonical) totals.unclassified++;
      if (status === resolvedStatus) bump(issue.severity, 'fixed');
      if (status === holdStatus) bump(issue.severity, 'onHold');
    });

    (checklist || []).forEach(function (entry) {
      var result = entry && entry.checkResult !== null && entry.checkResult !== undefined
        ? String(entry.checkResult).trim().toUpperCase()
        : '';
      if (!result) return;
      if (result === remainingResult) {
        if (!bump(entry.severity, 'remaining')) totals.unclassified++;
      } else if (result === nonIssueResult) {
        if (!bump(entry.severity, 'nonIssue')) totals.unclassified++;
      }
    });

    return { severities: SEVERITIES.slice(), rows: rows, totals: totals };
  }

  /**
   * 당일 이슈 요약 문구를 만든다.
   * 원본: ="총 " & N & "건 " & IF(수정확인>0, "(수정 확인 " & M & "건)", "") / 0건이면 "-".
   * @param {Array<{status: *}>} issues 당일 등록 이슈 목록
   * @param {{resolvedStatus?: string}} [options]
   * @returns {{registered: number, fixed: number, text: string}}
   */
  function summarizeDailyIssues(issues, options) {
    var resolvedStatus = (options && options.resolvedStatus) || '이슈 종료';
    var list = issues || [];
    var fixed = list.filter(function (issue) {
      var status = issue && issue.status !== null && issue.status !== undefined ? String(issue.status).trim() : '';
      return status === resolvedStatus;
    }).length;
    var registered = list.length;
    var text = registered === 0
      ? '-'
      : '총 ' + registered + '건' + (fixed > 0 ? ' (수정 확인 ' + fixed + '건)' : '');
    return { registered: registered, fixed: fixed, text: text };
  }

  return {
    RESULT_LABELS: RESULT_LABELS,
    SEVERITIES: SEVERITIES,
    normalizeResult: normalizeResult,
    normalizeSeverity: normalizeSeverity,
    countResults: countResults,
    mergeCounts: mergeCounts,
    computeProgress: computeProgress,
    formatPercent: formatPercent,
    parseSheetIdFromName: parseSheetIdFromName,
    parseConfigSheet: parseConfigSheet,
    parseProjectTable: parseProjectTable,
    toDateKey: toDateKey,
    filterRowsByDate: filterRowsByDate,
    mapIssueStatusToResult: mapIssueStatusToResult,
    aggregateIssues: aggregateIssues,
    summarizeDailyIssues: summarizeDailyIssues
  };
});
