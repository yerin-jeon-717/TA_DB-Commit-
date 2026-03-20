/**
 * [v1.1] 인재풀 Web App — GAS doGet API
 *
 * 변경 내역:
 * v1.0 - 초기 버전 (다른 툴 생성)
 * v1.1 - [FIX] buildJsonFromData: key 파라미터 추가 (캐시 복구 가능 구조)
 *        [NEW] processSheetData: tenure_start 필드 추가 (재직 기간에서 시작일 파싱)
 *        [CLEANUP] 캐시 관련 주석 정리
 */

// =======================
// 설정: 관리할 시트 규칙
// =======================

// 통합 대상이 되는 시트 이름 접두어들
const SHEET_PREFIXES = ["통합_"];

// 캐시 유지 시간 (초) — 데이터가 작을 때 활성화
const CACHE_TIME = 3600;


// =======================
// 유틸: 대상 시트 목록 구하기
// =======================

function getTargetSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets()
    .map(s => s.getName())
    .filter(name => SHEET_PREFIXES.some(p => name.startsWith(p)));
}


// =======================
// 엔트리 포인트: doGet
// =======================

function doGet(e) {
  const sheetParam = e.parameter.sheet;

  if (sheetParam) {
    const fullSheetName = "통합_" + sheetParam;
    const targetSheets = getTargetSheets();
    if (targetSheets.includes(fullSheetName)) {
      return buildJsonResponse(fullSheetName);
    } else {
      return buildJsonFromData([], null);
    }
  }

  return buildJsonResponse("ALL_DATA");
}


// =======================
// 데이터 빌드 + 응답 생성
// =======================

function buildJsonResponse(key) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) {
    return ContentService.createTextOutput(cached)
      .setMimeType(ContentService.MimeType.JSON);
  }

  let resultData;
  const targetSheets = getTargetSheets();

  if (key === "ALL_DATA") {
    resultData = targetSheets.reduce((acc, name) => {
      return acc.concat(processSheetData(name));
    }, []);
  } else {
    resultData = processSheetData(key);
  }

  // [FIX v1.1] key를 buildJsonFromData에 전달해야 캐시 저장 가능
  return buildJsonFromData(resultData, key);
}

function buildJsonFromData(dataArray, key) {
  const jsonStr = JSON.stringify(dataArray || []);

  // 데이터가 100KB 이하일 때 캐시 활성화 (CacheService 제한: 100KB)
  // if (key && jsonStr.length < 100000) {
  //   const cache = CacheService.getScriptCache();
  //   cache.put(key, jsonStr, CACHE_TIME);
  // }

  return ContentService.createTextOutput(jsonStr)
    .setMimeType(ContentService.MimeType.JSON);
}


// =======================
// 시트 한 개 처리
// =======================

function processSheetData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const tMap = getColMap(sheet);
  const range = sheet.getDataRange();
  const values = range.getValues();
  const richTextValues = range.getRichTextValues();
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const name = (r[tMap["이름"]] || "").toString().trim();
    if (!name) continue;

    const tenureStr = (r[tMap["재직 기간"]] || "").toString().trim();

    // [NEW v1.1] 재직 기간에서 시작일(YYYY.MM) 파싱 — 입사일 기준 정렬용
    // 포맷 예시: "2022.03 ~ 현재 (3년 1개월)"
    const tenureStartMatch = tenureStr.match(/(\d{4}\.\d{2})/);
    const tenure_start = tenureStartMatch ? tenureStartMatch[1] : "";

    rows.push({
      source_sheet: sheetName,
      company:          (r[tMap["회사명"]]      || "").toString().trim(),
      name:             name,
      remember:         extractUrl(richTextValues[i][tMap["리멤버 페이지"]]),
      linkedin:         extractUrl(richTextValues[i][tMap["링크드인 페이지"]]),
      job:              (r[tMap["대분류(직무)"]] || "").toString().trim(),
      team:             (r[tMap["팀"]]           || "").toString().trim(),
      role:             (r[tMap["직책"]]         || "").toString().trim(),
      total_career:     (r[tMap["총 경력"]]      || "").toString().trim(),
      tenure:           tenureStr,
      tenure_start:     tenure_start,
      prev_career_raw:  (r[tMap["이전 경력"]]   || "").toString().trim(),
      education:        (r[tMap["학력"]]         || "").toString().trim(),
      region:           (r[tMap["Region"]]       || "").toString().trim()
    });
  }
  return rows;
}


// =======================
// 리치텍스트에서 URL 추출
// =======================

function extractUrl(richTextValue) {
  if (!richTextValue) return "";
  const mainLink = richTextValue.getLinkUrl();
  if (mainLink) return mainLink;

  const runs = richTextValue.getRuns();
  for (const run of runs) {
    const link = run.getLinkUrl();
    if (link) return link;
  }
  return "";
}


// =======================
// 헤더 맵 생성
// =======================

function getColMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    if (h) map[h.toString().trim()] = i;
  });
  return map;
}
