/**
 * @file StyleGuide.js — 원본 '색상 칼럼' 설계의 상수화.
 *
 * 실사용 당시 문서 성격별로 팔레트를 분리해 운용했다.
 * - CLIENT(블루): 고객사 보고 문서. 신뢰감 있는 블루 그라데이션.
 * - INTERNAL(브라운): 실장/팀장 내부 보고 문서. 정직하고 깔끔한 톤.
 * - LONG_SESSION(그린): 테스터가 하루 8시간 이상 보는 문서. 눈의 피로 최소화.
 * 시트 탭 색상 규약(연두=뷰어, 주황=수정 가능, 붉은색=수정 금지)도 그대로 옮겼다.
 */

/**
 * @typedef {Object} CellStyle
 * @property {string} bg   배경색 hex
 * @property {string} font 글자색 hex
 */

/** 스타일 상수 전체. */
var STYLE = {
  /** 문서 성격별 헤더 팔레트 (제목 → Sub2로 갈수록 밝아지는 그라데이션). */
  PALETTES: {
    /** 고객사 보고용 — 블루 계열. */
    CLIENT: {
      TITLE: { bg: '#0D47A1', font: '#FFFFFF' },
      SUBTITLE: { bg: '#1976D2', font: '#FFFFFF' },
      SUB1: { bg: '#42A5F5', font: '#212121' },
      SUB2: { bg: '#BBDEFB', font: '#0D47A1' }
    },
    /** 내부 보고용 — 브라운/올리브 계열. */
    INTERNAL: {
      TITLE: { bg: '#5D4037', font: '#FFFFFF' },
      SUBTITLE: { bg: '#8D6E63', font: '#FFFFFF' },
      SUB1: { bg: '#A5A58D', font: '#5D4037' },
      SUB2: { bg: '#E0D8CD', font: '#8D6E63' }
    },
    /** 장시간 열람용 — 그린 계열. */
    LONG_SESSION: {
      TITLE: { bg: '#4CAF50', font: '#FFFFFF' },
      SUBTITLE: { bg: '#81C784', font: '#212121' },
      SUB1: { bg: '#A5D6A7', font: '#212121' },
      SUB2: { bg: '#E8F5E9', font: '#4CAF50' }
    }
  },

  /** 심각도 배경색 (Highest가 가장 강한 경고색). */
  SEVERITY: {
    Highest: '#FF7676',
    High: '#FFCFC9',
    Medium: '#FFE9AD',
    Low: '#ACC6FF',
    Lowest: '#BFE1F6'
  },

  /** 테스트 결과값 스타일. */
  RESULT: {
    'Pass': { bg: '#BFE1F6', font: '#0000FF' },
    'Fail': { bg: '#FFCFC9', font: '#FF0000' },
    'Block': { bg: '#3D3D3D', font: '#FFFFFF' },
    'N/A': { bg: '#FFE5A0', font: '#000000' },
    'No Run': { bg: '#D4EDBC', font: '#38761D' }
  },

  /** 시트 탭 색상 규약. */
  TAB: {
    VIEWER: '#8BC34A',   // 연두: 뷰어 (보기만)
    EDITABLE: '#FF9800', // 주황: 직접 수정하는 곳
    LOCKED: '#F44336'    // 붉은색: 건드리면 안 되는 곳 (수식/스크립트 출력)
  }
};

/**
 * 팔레트 이름으로 팔레트 객체를 찾는다. 모르는 이름이면 CLIENT로 폴백.
 * @param {string} name 'CLIENT' | 'INTERNAL' | 'LONG_SESSION'
 * @returns {{TITLE: CellStyle, SUBTITLE: CellStyle, SUB1: CellStyle, SUB2: CellStyle}}
 */
function getPalette(name) {
  var key = String(name || '').trim().toUpperCase();
  return STYLE.PALETTES[key] || STYLE.PALETTES.CLIENT;
}

/**
 * 범위에 헤더 스타일(배경 + 글자색 + 굵게)을 적용한다.
 * @param {GoogleAppsScript.Spreadsheet.Range} range
 * @param {CellStyle} style
 */
function applyHeaderStyle(range, style) {
  range.setBackground(style.bg).setFontColor(style.font).setFontWeight('bold');
}

/**
 * 심각도 값에 대응하는 배경색을 돌려준다.
 * @param {*} severity
 * @returns {string|null} hex 색상 또는 null(심각도 아님)
 */
function severityBackground(severity) {
  var canonical = Core.normalizeSeverity(severity);
  return canonical ? STYLE.SEVERITY[canonical] : null;
}

/**
 * 결과값에 대응하는 셀 스타일을 돌려준다.
 * @param {*} result
 * @returns {CellStyle|null}
 */
function resultStyle(result) {
  var canonical = Core.normalizeResult(result);
  return canonical ? STYLE.RESULT[canonical] : null;
}

/**
 * 심각도 라벨이 들어 있는 세로 1열 범위에 심각도 색을 일괄 적용한다.
 * @param {GoogleAppsScript.Spreadsheet.Range} range 심각도 라벨 열 범위
 */
function paintSeverityColumn(range) {
  var values = range.getValues();
  var backgrounds = values.map(function (row) {
    return [severityBackground(row[0]) || null];
  });
  range.setBackgrounds(backgrounds);
}
