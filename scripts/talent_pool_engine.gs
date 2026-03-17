/**
 * [v20.2] 인재풀 엔진
 * 변경 내역:
 * 1. [BUG FIX] extractNonAprCompanies: 구분자 | 와 ' - ' 모두 처리
 * 2. [BUG FIX] runDuplicateScan: 입사년월 Gate 방식 도입
 * 3. [UX] 리포트 체크박스 + 처리구분 + 입사년월 + 프로필 링크 컬럼 추가
 * 4. [FIX] applyDuplicateSelections: 이름·링크드인URL 이식, 직책 메모 추가, 리포트 초기화
 * 5. [NEW] mergeLinkedinIntoRemember: 링크드인 잔여 데이터 → 리멤버 시트에 append
 * 6. [NEW] buildCategoryMappingReport: F/G열 고유값 → 카테고리 매핑 시트 생성
 * 7. [NEW] applyCategoryMapping: 매핑 시트 기반 F/G열 일괄 업데이트
 */

const COMPANY_CONFIG = {
  "더파운더즈": {
    linkedinSourceId : "1-ZalK4uhxz3uq4RyAMkqHrHkYrkFTNM27G6IswVnj8I",
    rememberSourceId  : "1R-uwGSBBgsMDYUJiZaHUD-Uh9V-Q3xdCkFuGnT7146o",
    sheet1Name: 'Remember_더파운더즈',
    sheet2Name: 'linkedin_더파운더즈',
    excludeKeywords  : ["더파운더즈", "founders"]
  },
  "APR": {
    linkedinSourceId : "1-ZalK4uhxz3uq4RyAMkqHrHkYrkFTNM27G6IswVnj8I",
    rememberSourceId  : "1R-uwGSBBgsMDYUJiZaHUD-Uh9V-Q3xdCkFuGnT7146o",
    sheet1Name: 'Remember_APR',
    sheet2Name: 'linkedin_APR',
    excludeKeywords  : ["APR", "에이피알", "aprilskin", "medicube", "에이피알커뮤니케이션즈"]
  }
};

const SHEET_DUP_REPORT    = "🔍 중복_대조_리포트";
const SHEET_CATEGORY_MAP  = "📋 카테고리 매핑 리포트";

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 인재풀 엔진 v20.2')
    .addSubMenu(ui.createMenu('🛠️ 1. 데이터 준비')
      .addItem('📥 링크드인 데이터 가져오기 (현재 시트)', 'importLinkedInData')
      .addItem('📥 리멤버 데이터 가져오기 (현재 시트)', 'importRememberData')
      .addSeparator()
      .addItem('🔤 이름 열 국문 번역(자동)', 'translateNameColumn')
      .addItem('🧹 포맷 통일(링크드인 > 리멤버)', 'unifyFormatLinkedinToRemember')
      .addItem('🚀 총 경력 합산 업데이트', 'updateCurrentSheetCareer'))
    .addSeparator()
    .addSubMenu(ui.createMenu('📂 2. 데이터 통합 (중복/매핑)')
      .addItem('🔎 중복 대조 리포트 생성 (Gate 방식)', 'runDuplicateScan')
      .addItem('🔗 선택 중복 병합/삭제 실행', 'applyDuplicateSelections')
      .addSeparator()
      .addItem('🔀 링크드인 잔여 데이터 → 리멤버 시트에 합치기', 'mergeLinkedinIntoRemember'))
    .addSeparator()
    .addSubMenu(ui.createMenu('🏷️ 3. 팀/직책 카테고리 정규화')
      .addItem('📋 카테고리 매핑 시트 생성 (고유값 추출)', 'buildCategoryMappingReport')
      .addItem('✅ 카테고리 매핑 적용 (현재 시트)', 'applyCategoryMapping'))
    .addSeparator()
    .addItem('🌏 Region 자동 매핑 실행', 'runRegionMapping')
    .addItem('⚪ 리포트 서식 초기화', 'clearAllColors')
    .addToUi();
}

// ==========================================
// ■ 포맷 통일 로직 (역산 포함) — v19.28 유지
// ==========================================
function unifyFormatLinkedinToRemember() {
  try {
    const sheet = SpreadsheetApp.getActiveSheet(), tMap = getColMap(sheet), lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const careerColIdx = (tMap["재직 기간"] || tMap["재직기간"]) + 1;
    const prevColIdx = tMap["이전 경력"] + 1;

    // 1. 재직 기간 업데이트 (핀포인트 — C·D열 절대 포함 금지)
    const careerRange = sheet.getRange(2, careerColIdx, lastRow - 1, 1);
    const newCareer = careerRange.getValues().map(r => [
      r[0] ? r[0].toString().split('\n').map(l => standardizeLineFinal(l, true)).filter(String).join('\n') : ""
    ]);
    careerRange.setValues(newCareer);

    // 2. 이전 경력 업데이트 (현재 직장 제외 포함)
    const prevRange = sheet.getRange(2, prevColIdx, lastRow - 1, 1);
    const newPrev = prevRange.getValues().map(r => [
      r[0] ? r[0].toString().split('\n').map(l => standardizeLineFinal(l, false)).filter(String).join('\n') : ""
    ]);
    prevRange.setValues(newPrev);

    SpreadsheetApp.getUi().alert("✅ [역산 완료] 모든 경력 포맷이 표준화되었습니다.");
  } catch (e) { SpreadsheetApp.getUi().alert("오류: " + e.message); }
}

function standardizeLineFinal(line, isCurrentJob) {
  if (!line || line.trim() === "" || line === "-") return "";
  line = line.trim();
  line = line.replace(/(\d{4})년\s*(\d{1,2})월/g, (m, p1, p2) => p1 + "." + p2.padStart(2, '0'));

  const dateRegex = /(\d{4}\.\d{2})\s*[\-~|·]\s*([\d\.]+|현재|Present)/i;
  const durationOnlyRegex = /^(\d+년\s*\d+개월|\d+년|\d+개월)$/;

  // Case 1: "1년 11개월"만 있는 경우 → 역산
  if (durationOnlyRegex.test(line)) {
    const durMatch = line.match(/(\d+년)?\s*(\d+개월)?/);
    const y = durMatch[1] ? parseInt(durMatch[1]) : 0;
    const m = durMatch[2] ? parseInt(durMatch[2]) : 0;
    const totalMonths = (y * 12) + m;
    const now = new Date(2026, 2);
    now.setMonth(now.getMonth() - totalMonths + 1);
    const sy = now.getFullYear();
    const sm = (now.getMonth() + 1).toString().padStart(2, '0');
    const sD = `${sy}.${sm}`;
    const durStr = `${y}년 ${m}개월`;
    return isCurrentJob ? `${sD} ~ 현재 (${durStr})` : `[${sD} ~ 현재 (${durStr})]`;
  }

  // Case 2: 날짜 범위가 있는 경우
  const match = line.match(dateRegex);
  if (match) {
    let sD = match[1], eD = match[2].replace(/Present/i, "현재").trim();
    let durMatch = line.match(/\((\d+년\s*\d+개월|\d+년|\d+개월)\)/);
    let dur = "";
    if (durMatch) {
      const dStr = durMatch[1];
      const yMatch = dStr.match(/(\d+)년/), mMatch = dStr.match(/(\d+)개월/);
      const y = yMatch ? yMatch[1] : "0", m = mMatch ? mMatch[1] : "0";
      dur = `${y}년 ${m}개월`;
    } else {
      const sP = sD.split('.');
      const sy = parseInt(sP[0]), sm = parseInt(sP[1]);
      let ey, em;
      if (eD === "현재") { ey = 2026; em = 3; }
      else { const eP = eD.split('.'); ey = parseInt(eP[0]); em = parseInt(eP[1]); }
      dur = calcDurationBetween(sy, sm, ey, em);
    }
    let info = line.replace(dateRegex, '').replace(/\(.*?\)/g, '').replace(/[\[\]]/g, '').replace(/^\s*[\-·~]\s*/, '').trim();
    info = info.replace(/\(주\)|\(유\)|\(사\)|㈜/g, '').replace(/\s{2,}/g, ' ').trim();
    if (!isCurrentJob && isExcludedCompany(info)) return "";
    return isCurrentJob ? `${sD} ~ ${eD} (${dur}) ${info}` : `[${sD} ~ ${eD} (${dur})] ${info}`;
  }

  return isCurrentJob ? line : (isExcludedCompany(line) ? "" : line);
}

function calcDurationBetween(sy, sm, ey, em) {
  var total = (ey * 12 + em) - (sy * 12 + sm) + 1;
  if (total <= 0) return "0년 0개월";
  var y = Math.floor(total / 12), m = total % 12;
  return `${y}년 ${m}개월`;
}

function isExcludedCompany(text) {
  const cfg = getOrSelectCompany();
  if (!cfg || !cfg.excludeKeywords || !text) return false;
  const cleanText = text.toLowerCase().replace(/\s/g, '');
  return cfg.excludeKeywords.some(kw => cleanText.includes(kw.toLowerCase().replace(/\s/g, '')));
}

// ==========================================
// ■ [v20.1] 중복 대조 — Gate 방식 + 링크 컬럼 추가
// 리포트 컬럼 레이아웃 (16열):
// [0]선택 [1]처리 [2]입사년월 [3]일치항목
// [4]s1행 [5]s1이름 [6]s1리멤버링크 [7]s1링크드인링크 [8]s1경력 [9]s1학력
// [10]s2행 [11]s2이름 [12]s2리멤버링크 [13]s2링크드인링크 [14]s2경력 [15]s2학력
// ==========================================
function runDuplicateScan() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();
  const cfg = getOrSelectCompany(); if (!cfg) return;
  const sheet1 = ss.getSheetByName(cfg.sheet1Name), sheet2 = ss.getSheetByName(cfg.sheet2Name);
  if (!sheet1 || !sheet2) return ui.alert(`❌ 시트가 없습니다.`);

  const data1 = sheet1.getDataRange().getValues(), data2 = sheet2.getDataRange().getValues();
  const h1 = data1[0], h2 = data2[0];
  let idx1, idx2;
  try {
    idx1 = {
      name:      getColIndex(h1, '이름',        cfg.sheet1Name),
      company:   getColIndex(h1, '이전 경력',   cfg.sheet1Name),
      period:    getColIndex(h1, '재직 기간',   cfg.sheet1Name),
      education: getColIndex(h1, '학력',        cfg.sheet1Name),
      remember:  getColIndex(h1, '리멤버 페이지', cfg.sheet1Name),
      linkedin:  getColIndex(h1, '링크드인 페이지', cfg.sheet1Name)
    };
    idx2 = {
      name:      getColIndex(h2, '이름',        cfg.sheet2Name),
      company:   getColIndex(h2, '이전 경력',   cfg.sheet2Name),
      period:    getColIndex(h2, '재직 기간',   cfg.sheet2Name),
      education: getColIndex(h2, '학력',        cfg.sheet2Name),
      remember:  getColIndex(h2, '리멤버 페이지', cfg.sheet2Name),
      linkedin:  getColIndex(h2, '링크드인 페이지', cfg.sheet2Name)
    };
  } catch (e) { return ui.alert('❌ ' + e.message); }

  // 프로필 링크 RichText 전체 읽기 (C열=리멤버, D열=링크드인, 1-based 3·4)
  const lastRow1 = data1.length - 1, lastRow2 = data2.length - 1;
  const rt1C = lastRow1 > 0 ? sheet1.getRange(2, idx1.remember + 1, lastRow1, 1).getRichTextValues() : [];
  const rt1D = lastRow1 > 0 ? sheet1.getRange(2, idx1.linkedin + 1, lastRow1, 1).getRichTextValues() : [];
  const rt2C = lastRow2 > 0 ? sheet2.getRange(2, idx2.remember + 1, lastRow2, 1).getRichTextValues() : [];
  const rt2D = lastRow2 > 0 ? sheet2.getRange(2, idx2.linkedin + 1, lastRow2, 1).getRichTextValues() : [];

  const getUrl = (rtArr, rowIdx) => {
    const rt = rtArr[rowIdx] && rtArr[rowIdx][0];
    return rt ? (rt.getLinkUrl() || '') : '';
  };

  const duplicates = [];

  for (let i = 1; i < data1.length; i++) {
    const r = data1[i]; if (!r[idx1.name]) continue;

    for (let j = 1; j < data2.length; j++) {
      const l = data2[j]; if (!l[idx2.name]) continue;

      // ── [GATE] 입사년월 일치 여부 — 불일치 시 즉시 제외 ──
      const joinDate1 = extractAprStartDate(r[idx1.period]);
      const joinDate2 = extractAprStartDate(l[idx2.period]);
      if (joinDate1 === '-' || joinDate2 === '-' || joinDate1 !== joinDate2) continue;

      // ── [보조 조건] 성씨 / 이전 경력 / 학력 ──
      const secondary = [
        { label: '성(姓) 일치',    match: compareSurname(r[idx1.name], l[idx2.name]) },
        { label: '이전 경력 유사', match: comparePreviousCompanies(r[idx1.company], l[idx2.company]) },
        { label: '학력 유사',      match: compareEducation(r[idx1.education], l[idx2.education]) }
      ];
      const matched = secondary.filter(c => c.match);
      if (matched.length === 0) continue;

      const autoMerge = matched.length >= 2;
      duplicates.push({
        autoMerge, matched, joinDate: joinDate1,
        rRow: i + 1, lRow: j + 1, r, l, idx1, idx2,
        rememberUrl1: getUrl(rt1C, i - 1), linkedinUrl1: getUrl(rt1D, i - 1),
        rememberUrl2: getUrl(rt2C, j - 1), linkedinUrl2: getUrl(rt2D, j - 1)
      });
    }
  }

  // ── 리포트 작성 ──
  let report = ss.getSheetByName(SHEET_DUP_REPORT) || ss.insertSheet(SHEET_DUP_REPORT);
  report.clear();

  const headers = [
    '선택', '처리', '입사년월', '일치항목',
    `[${cfg.sheet1Name}] 행`, `[${cfg.sheet1Name}] 이름`, `[${cfg.sheet1Name}] 리멤버`, `[${cfg.sheet1Name}] 링크드인`, `[${cfg.sheet1Name}] 경력`, `[${cfg.sheet1Name}] 학력`,
    `[${cfg.sheet2Name}] 행`, `[${cfg.sheet2Name}] 이름`, `[${cfg.sheet2Name}] 리멤버`, `[${cfg.sheet2Name}] 링크드인`, `[${cfg.sheet2Name}] 경력`, `[${cfg.sheet2Name}] 학력`
  ];
  report.appendRow(headers);
  report.getRange(1, 1, 1, headers.length).setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');

  if (duplicates.length > 0) {
    duplicates.sort((a, b) => b.matched.length - a.matched.length);

    // 링크 제외 텍스트 값 먼저 세팅
    const reportValues = duplicates.map(d => [
      false,
      d.autoMerge ? '✅ 자동 병합' : '🔍 검토 필요',
      d.joinDate,
      d.matched.map(c => c.label).join(' · '),
      d.rRow, String(d.r[d.idx1.name]), '', '', extractPrevCompanySummary(d.r[d.idx1.company]), extractSchoolSummary(d.r[d.idx1.education]),
      d.lRow, String(d.l[d.idx2.name]), '', '', extractPrevCompanySummary(d.l[d.idx2.company]), extractSchoolSummary(d.l[d.idx2.education])
    ]);
    report.getRange(2, 1, reportValues.length, headers.length).setValues(reportValues);

    // 링크 컬럼에 RichText 하이퍼링크 삽입 (col 7=s1리멤버, 8=s1링크드인, 13=s2리멤버, 14=s2링크드인)
    const buildLink = (text, url) =>
      url ? SpreadsheetApp.newRichTextValue().setText(text).setLinkUrl(url).build()
          : SpreadsheetApp.newRichTextValue().setText('-').build();

    duplicates.forEach((d, i) => {
      const row = i + 2;
      report.getRange(row, 7).setRichTextValue(buildLink('리멤버', d.rememberUrl1));
      report.getRange(row, 8).setRichTextValue(buildLink('linkedin', d.linkedinUrl1));
      report.getRange(row, 13).setRichTextValue(buildLink('리멤버', d.rememberUrl2));
      report.getRange(row, 14).setRichTextValue(buildLink('linkedin', d.linkedinUrl2));
    });

    // 체크박스 삽입 + 자동 병합 행 사전 체크
    const checkboxRange = report.getRange(2, 1, reportValues.length, 1);
    checkboxRange.insertCheckboxes();
    duplicates.forEach((d, i) => {
      if (d.autoMerge) report.getRange(i + 2, 1).setValue(true);
    });

    // 행 색상 (자동 병합: 연초록 / 검토 필요: 연노랑)
    duplicates.forEach((d, i) => {
      report.getRange(i + 2, 1, 1, headers.length)
        .setBackground(d.autoMerge ? '#e6f4ea' : '#fef9c3');
    });
  }

  report.activate();
  const autoCount = duplicates.filter(d => d.autoMerge).length;
  ui.alert(`✅ 완료: 총 ${duplicates.length}건\n✅ 자동 병합 대상: ${autoCount}건\n🔍 검토 필요: ${duplicates.length - autoCount}건`);
}

// ==========================================
// ■ [v20.2] 병합 실행
// 리포트 컬럼: [0]선택 [1]처리 [2]입사년월 [3]일치항목
//             [4]s1행 [5]s1이름 [6]s1리멤버 [7]s1링크드인 [8]s1경력 [9]s1학력
//             [10]s2행 [11]s2이름 [12]s2리멤버 [13]s2링크드인 [14]s2경력 [15]s2학력
// ==========================================
function applyDuplicateSelections() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reportSheet = ss.getSheetByName(SHEET_DUP_REPORT);
  const cfg = getOrSelectCompany(); if (!cfg) return;
  const targetSheet = ss.getSheetByName(cfg.sheet1Name); // 리멤버
  const newSheet    = ss.getSheetByName(cfg.sheet2Name); // 링크드인
  if (!reportSheet || !targetSheet || !newSheet) return;

  const rData  = reportSheet.getDataRange().getValues();
  const tMap1  = getColMap(targetSheet);
  const tMap2  = getColMap(newSheet);

  // 리멤버 시트 컬럼 인덱스 (1-based)
  const nameColIdx = tMap1["이름"]           + 1; // B열
  const liColIdx   = tMap1["링크드인 페이지"] + 1; // D열
  const posColIdx  = tMap1["직책"]           + 1; // G열

  // 링크드인 시트 컬럼 인덱스 (1-based)
  const li_nameIdx = tMap2["이름"]            + 1;
  const li_liIdx   = tMap2["링크드인 페이지"] + 1;
  const li_posIdx  = tMap2["직책"]            + 1;

  const rowsToDelete = [];

  for (let i = 1; i < rData.length; i++) {
    if (rData[i][0] !== true) continue; // 체크박스 선택 행만

    const aIdx = rData[i][4];  // sheet1(리멤버) 행 번호
    const bIdx = rData[i][10]; // sheet2(링크드인) 행 번호

    // 1. 링크드인 이름 → 리멤버 B열 덮어쓰기
    const liName = newSheet.getRange(bIdx, li_nameIdx).getValue();
    if (liName) targetSheet.getRange(aIdx, nameColIdx).setValue(liName);

    // 2. 링크드인 페이지 URL → 리멤버 D열 이식 (RichText)
    const liLinkRt = newSheet.getRange(bIdx, li_liIdx).getRichTextValue();
    if (liLinkRt && liLinkRt.getLinkUrl()) {
      targetSheet.getRange(aIdx, liColIdx).setRichTextValue(
        SpreadsheetApp.newRichTextValue().setText("linkedin").setLinkUrl(liLinkRt.getLinkUrl()).build()
      );
    }

    // 3. 링크드인 직책 → 리멤버 G열 셀에 메모 추가
    const liPos = newSheet.getRange(bIdx, li_posIdx).getValue();
    if (liPos) {
      const cell = targetSheet.getRange(aIdx, posColIdx);
      const existing = cell.getNote();
      cell.setNote(existing ? `${existing}\n[LinkedIn] ${liPos}` : `[LinkedIn] ${liPos}`);
    }

    rowsToDelete.push(bIdx);
  }

  // 역순 삭제 (인덱스 밀림 방지)
  [...new Set(rowsToDelete)].sort((a, b) => b - a).forEach(idx => newSheet.deleteRow(idx));

  // 리포트 시트 초기화
  reportSheet.clear();

  SpreadsheetApp.getUi().alert(`✅ 병합 완료: ${rowsToDelete.length}건 처리\n리포트 시트가 초기화되었습니다.`);
}

// ==========================================
// ■ [v20.2] 링크드인 잔여 데이터 → 리멤버 시트에 append
// 중복 처리 후 링크드인 시트에 남은 행(리멤버에 없는 인재)을 리멤버 시트 하단에 붙임.
// 링크드인 시트는 작업 후 숨김 처리.
// ==========================================
function mergeLinkedinIntoRemember() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();
  const cfg = getOrSelectCompany(); if (!cfg) return;
  const remSheet = ss.getSheetByName(cfg.sheet1Name);
  const liSheet  = ss.getSheetByName(cfg.sheet2Name);
  if (!remSheet || !liSheet) return ui.alert('❌ 시트가 없습니다.');

  const liData = liSheet.getDataRange().getValues().slice(1); // 헤더 제외
  if (liData.length === 0) return ui.alert('링크드인 시트에 남은 데이터가 없습니다.');

  // 링크드인 시트의 RichText (C열=리멤버링크, D열=링크드인링크) 읽기
  const tMap2  = getColMap(liSheet);
  const liRemColIdx = tMap2["리멤버 페이지"]  + 1;
  const liLiColIdx  = tMap2["링크드인 페이지"] + 1;
  const rtC = liSheet.getRange(2, liRemColIdx, liData.length, 1).getRichTextValues();
  const rtD = liSheet.getRange(2, liLiColIdx,  liData.length, 1).getRichTextValues();

  // 리멤버 시트에 append (setValues로 텍스트 먼저)
  const startRow = remSheet.getLastRow() + 1;
  remSheet.getRange(startRow, 1, liData.length, liData[0].length).setValues(liData);

  // C·D열 RichText 이식 (Pinpoint Update — C·D열만 별도 처리)
  const tMap1     = getColMap(remSheet);
  const remColIdx = tMap1["리멤버 페이지"]  + 1;
  const liColIdx  = tMap1["링크드인 페이지"] + 1;
  remSheet.getRange(startRow, remColIdx, liData.length, 1).setRichTextValues(rtC);
  remSheet.getRange(startRow, liColIdx,  liData.length, 1).setRichTextValues(rtD);

  // 링크드인 시트 숨김
  liSheet.hideSheet();

  ui.alert(`✅ 완료: 링크드인 잔여 ${liData.length}건을 리멤버 시트에 추가했습니다.\n링크드인 시트는 숨김 처리되었습니다.`);
}

// ==========================================
// ■ [v20.2] 팀/직책 카테고리 매핑 — STEP 1: 고유값 추출
// 현재 시트의 F열(팀), G열(직책) 고유값을 카테고리 매핑 시트에 나열.
// 사용자가 '표준 카테고리' 열을 채운 뒤 applyCategoryMapping 실행.
// ==========================================
function buildCategoryMappingReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = SpreadsheetApp.getActiveSheet();
  const tMap = getColMap(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return SpreadsheetApp.getUi().alert('데이터가 없습니다.');

  const teamIdx = tMap["팀"]  + 1; // F열 (1-based)
  const posIdx  = tMap["직책"] + 1; // G열

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  // 고유값 수집 (타입별 분리)
  const teamSet = new Set(), posSet = new Set();
  data.forEach(row => {
    const t = String(row[tMap["팀"]]  || '').trim(); if (t) teamSet.add(t);
    const p = String(row[tMap["직책"]] || '').trim(); if (p) posSet.add(p);
  });

  // 매핑 시트 작성
  let mapSheet = ss.getSheetByName(SHEET_CATEGORY_MAP);
  if (!mapSheet) mapSheet = ss.insertSheet(SHEET_CATEGORY_MAP);
  else mapSheet.clear();

  const headers = ['타입', '원본값', '표준 카테고리', '비고'];
  mapSheet.appendRow(headers);
  mapSheet.getRange(1, 1, 1, 4).setBackground('#34a853').setFontColor('#ffffff').setFontWeight('bold');

  const rows = [];
  [...teamSet].sort().forEach(v => rows.push(['팀', v, '', '']));
  [...posSet].sort().forEach(v => rows.push(['직책', v, '', '']));

  if (rows.length > 0) {
    mapSheet.getRange(2, 1, rows.length, 4).setValues(rows);
    // 표준 카테고리 열 노란색 강조 (사용자 입력 구간)
    mapSheet.getRange(2, 3, rows.length, 1).setBackground('#fff9c4');
  }

  mapSheet.activate();
  SpreadsheetApp.getUi().alert(
    `✅ 완료: 팀 ${teamSet.size}개, 직책 ${posSet.size}개 고유값을 추출했습니다.\n` +
    `'${SHEET_CATEGORY_MAP}' 시트의 C열(표준 카테고리)을 채운 뒤 '카테고리 매핑 적용'을 실행하세요.`
  );
}

// ==========================================
// ■ [v20.2] 팀/직책 카테고리 매핑 — STEP 2: 매핑 적용
// 카테고리 매핑 시트를 참조하여 현재 시트 F·G열을 일괄 업데이트.
// 표준 카테고리가 비어 있는 값은 원본 유지.
// ==========================================
function applyCategoryMapping() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();
  const mapSheet = ss.getSheetByName(SHEET_CATEGORY_MAP);
  if (!mapSheet) return ui.alert(`❌ '${SHEET_CATEGORY_MAP}' 시트가 없습니다. 먼저 고유값 추출을 실행하세요.`);

  const mapData = mapSheet.getDataRange().getValues().slice(1); // 헤더 제외

  // 팀·직책 매핑 테이블 생성
  const teamMap = {}, posMap = {};
  mapData.forEach(row => {
    const type = String(row[0]).trim();
    const original = String(row[1]).trim();
    const standard = String(row[2]).trim();
    if (!standard) return; // 표준값 미입력 → 스킵
    if (type === '팀')   teamMap[original] = standard;
    if (type === '직책') posMap[original]  = standard;
  });

  const sheet = SpreadsheetApp.getActiveSheet();
  const tMap  = getColMap(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return ui.alert('데이터가 없습니다.');

  const teamColIdx = tMap["팀"]  + 1; // F열 (1-based)
  const posColIdx  = tMap["직책"] + 1; // G열

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  let updatedCount = 0;

  data.forEach((row, i) => {
    const rowNum = i + 2;
    const origTeam = String(row[tMap["팀"]]  || '').trim();
    const origPos  = String(row[tMap["직책"]] || '').trim();
    if (origTeam && teamMap[origTeam]) {
      sheet.getRange(rowNum, teamColIdx).setValue(teamMap[origTeam]);
      updatedCount++;
    }
    if (origPos && posMap[origPos]) {
      sheet.getRange(rowNum, posColIdx).setValue(posMap[origPos]);
      updatedCount++;
    }
  });

  ui.alert(`✅ 완료: ${updatedCount}개 셀이 표준 카테고리로 업데이트되었습니다.`);
}

// ==========================================
// ■ 데이터 수입
// ==========================================
function importLinkedInData() {
  const ui = SpreadsheetApp.getUi();
  try {
    const cfg = getOrSelectCompany(); if (!cfg) return;
    const sourceSs = SpreadsheetApp.openById(cfg.linkedinSourceId);
    const dataSheets = sourceSs.getSheets().slice(4);
    const sheetList = dataSheets.map((s, i) => `${i + 1}. ${s.getName()}`).join('\n');
    const response = ui.prompt('📥 링크드인 시트 선택', sheetList, ui.ButtonSet.OK_CANCEL);
    if (response.getSelectedButton() !== ui.Button.OK) return;
    const selectedSheet = dataSheets[parseInt(response.getResponseText().trim()) - 1];
    const sourceData = selectedSheet.getDataRange().getValues().slice(1);
    const sourceRichTexts = selectedSheet.getRange(2, 10, sourceData.length, 1).getRichTextValues();
    const targetSheet = SpreadsheetApp.getActiveSheet();
    targetSheet.clear();
    targetSheet.appendRow(["회사명","이름","리멤버 페이지","링크드인 페이지","대분류(직무)","팀","직책","총 경력","재직 기간","이전 경력","학력","기준일"]);
    const results = sourceData.map(row => [selectedSheet.getName(), row[0], "", "linkedin", "", "", row[1], "", row[2], row[4], row[3], row[10]]);
    if (results.length > 0) {
      targetSheet.getRange(2, 1, results.length, 12).setValues(results);
      const richLinks = sourceRichTexts.map(rtRow => {
        const url = rtRow[0] ? rtRow[0].getLinkUrl() : "";
        return [url
          ? SpreadsheetApp.newRichTextValue().setText("linkedin").setLinkUrl(url).build()
          : SpreadsheetApp.newRichTextValue().setText("linkedin").build()];
      });
      targetSheet.getRange(2, 4, richLinks.length, 1).setRichTextValues(richLinks); // D열 (링크드인 페이지)
    }
  } catch (e) { ui.alert("오류: " + e.message); }
}

function importRememberData() {
  const ui = SpreadsheetApp.getUi();
  try {
    const cfg = getOrSelectCompany(); if (!cfg) return;
    const sourceSs = SpreadsheetApp.openById(cfg.rememberSourceId);
    const dataSheets = sourceSs.getSheets().slice(4);
    const sheetList = dataSheets.map((s, i) => `${i + 1}. ${s.getName()}`).join('\n');
    const response = ui.prompt('📥 리멤버 시트 선택', sheetList, ui.ButtonSet.OK_CANCEL);
    if (response.getSelectedButton() !== ui.Button.OK) return;
    const selectedSheet = dataSheets[parseInt(response.getResponseText().trim()) - 1];
    const sourceData = selectedSheet.getDataRange().getValues().slice(1);
    const sourceRichTexts = selectedSheet.getRange(2, 2, sourceData.length, 1).getRichTextValues();
    const targetSheet = SpreadsheetApp.getActiveSheet();
    targetSheet.clear();
    targetSheet.appendRow(["회사명","이름","리멤버 페이지","링크드인 페이지","대분류(직무)","팀","직책","총 경력","재직 기간","이전 경력","학력","기준일"]);
    const results = sourceData.map(row => [selectedSheet.getName(), row[0], "link", "", "", row[2], row[3], "", row[4], row[5], row[6], row[7]]);
    if (results.length > 0) {
      targetSheet.getRange(2, 1, results.length, 12).setValues(results);
      const richLinks = sourceRichTexts.map(rtRow => {
        const url = rtRow[0] ? rtRow[0].getLinkUrl() : "";
        return [url
          ? SpreadsheetApp.newRichTextValue().setText("link").setLinkUrl(url).build()
          : SpreadsheetApp.newRichTextValue().setText("").build()];
      });
      targetSheet.getRange(2, 3, richLinks.length, 1).setRichTextValues(richLinks); // C열 (리멤버 페이지)
    }
  } catch (e) { ui.alert("오류: " + e.message); }
}

// ==========================================
// ■ 유틸리티
// ==========================================
function translateNameColumn() {
  const sheet = SpreadsheetApp.getActiveSheet(), tMap = getColMap(sheet);
  const range = sheet.getRange(2, tMap["이름"] + 1, sheet.getLastRow() - 1, 1);
  const newVals = range.getValues().map(row => {
    let t = String(row[0]).trim();
    if (t !== "" && !/[가-힣]/.test(t)) {
      try { let tr = LanguageApp.translate(t, 'en', 'ko'); if (t !== tr) return [t + "\n" + tr]; } catch (e) {}
    }
    return [row[0]];
  });
  range.setValues(newVals);
}

function updateCurrentSheetCareer() {
  const sheet = SpreadsheetApp.getActiveSheet(), tMap = getColMap(sheet);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const res = data.map(row => {
    let t = 0;
    const comb = (row[tMap["재직 기간"] || tMap["재직기간"]] || "").toString() + "\n" + (row[tMap["이전 경력"]] || "").toString();
    const ms = [...comb.matchAll(/\((\d+년\s*\d+개월|\d+년|\d+개월)\)/g)];
    ms.forEach(m => {
      const y = m[1].match(/(\d+)년/), mo = m[1].match(/(\d+)개월/);
      t += (y ? parseInt(y[1]) * 12 : 0) + (mo ? parseInt(mo[1]) : 0);
    });
    return [t > 0 ? (Math.floor(t / 12) > 0 ? `${Math.floor(t / 12)}년 ${t % 12}개월`.replace(' 0개월', '') : `${t % 12}개월`) : "-"];
  });
  sheet.getRange(2, tMap["총 경력"] + 1, res.length, 1).setValues(res);
}

function runRegionMapping() {
  const sheet = SpreadsheetApp.getActiveSheet(), tMap = getColMap(sheet);
  const results = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues().map(row => {
    const combined = (String(row[tMap["팀"]] || "") + " " + String(row[tMap["직책"]] || "")).toLowerCase();
    const matched = [];
    const rules = [
      { region: "북미",   keywords: ["북미", "US", "미국", "America", "North America", "틱톡샵"] },
      { region: "일본",   keywords: ["일본", "Japan", "JP", "일본사업", "일본 GTM"] },
      { region: "한국",   keywords: ["한국", "Korea", "KR", "국내", "한국사업"] },
      { region: "글로벌", keywords: ["글로벌", "Global", "해외", "동남아", "유럽"] }
    ];
    rules.forEach(rule => { if (rule.keywords.some(kw => combined.includes(kw.toLowerCase()))) matched.push(rule.region); });
    if (matched.length === 0) return ["NA"];
    const specific = matched.filter(r => r !== "글로벌");
    return [specific.length > 0 ? [...new Set(specific)].join("|") : "글로벌"];
  });
  const col = tMap["Region"] !== undefined ? tMap["Region"] + 1 : sheet.getLastColumn() + 1;
  if (tMap["Region"] === undefined) sheet.getRange(1, col).setValue("Region");
  sheet.getRange(2, col, results.length, 1).setValues(results);
}

// ==========================================
// ■ [v20.0] 중복 탐지 헬퍼
// ==========================================

/**
 * [BUG FIX v20.0] 이전 경력에서 회사명 추출
 * 리멤버 포맷: [날짜] 회사명 | 팀 | 직책
 * 링크드인 포맷: [날짜] 회사명 - 직책
 * → | 또는 ' - ' 기준으로 첫 세그먼트(회사명)만 추출
 */
function extractNonAprCompanies(text) {
  return text.split('\n').map(line => {
    const afterBracket = line.match(/\]\s*(.+)/);
    if (!afterBracket) return '';
    const content = afterBracket[1];
    const pipeIdx  = content.indexOf('|');
    const dashIdx  = content.indexOf(' - ');
    let end = content.length;
    if (pipeIdx >= 0) end = Math.min(end, pipeIdx);
    if (dashIdx >= 0) end = Math.min(end, dashIdx);
    return content.substring(0, end).trim();
  }).filter(n => n.length > 0 && !isExcludedCompany(n));
}

function compareSurname(name1, name2) {
  // Bottom-up: 마지막 줄(pop())이 국문 성함
  const s1 = String(name1).trim().split('\n').pop().charAt(0);
  const s2 = String(name2).trim().split('\n').pop().charAt(0);
  return s1.length > 0 && s1 === s2;
}

function comparePreviousCompanies(c1, c2) {
  const cos1 = extractNonAprCompanies(String(c1));
  const cos2 = extractNonAprCompanies(String(c2));
  return cos1.length > 0 && cos2.length > 0 && cos1.some(a => cos2.some(b => isSimilarText(a, b)));
}

function compareEducation(e1, e2) {
  const s1 = extractSchools(String(e1)), s2 = extractSchools(String(e2));
  return s1.length > 0 && s2.length > 0 && s1.some(a => s2.some(b => isSimilarText(a, b)));
}

function extractAprStartDate(text) {
  // 재직 기간에서 입사년월(YYYY.MM) 추출 — Gate 조건으로 사용
  const m = String(text).match(/(\d{4}[.\-]\d{2})\s*~/);
  return m ? m[1].replace('-', '.') : '-';
}

function extractSchools(text) {
  return text.split('\n').map(line => {
    const m = line.match(/^(.+?)\s*-\s*/);
    return m ? m[1].trim() : '';
  }).filter(s => s.length > 0);
}

function isSimilarText(a, b) {
  const n1 = norm(a), n2 = norm(b);
  return n1.length >= 2 && n2.length >= 2 && (n1.includes(n2) || n2.includes(n1));
}

function norm(s) {
  return s.toLowerCase().replace(/[\s\-_·.,()（）\[\]]/g, '').trim();
}

function extractPrevCompanySummary(text) {
  const cos = extractNonAprCompanies(String(text));
  return cos.length > 0 ? cos.slice(0, 2).join(', ') : '-';
}

function extractSchoolSummary(eduText) {
  const schs = extractSchools(String(eduText));
  return schs.length > 0 ? schs[0] : '-';
}

// ==========================================
// ■ 공통 유틸
// ==========================================
function getColMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((v, i) => map[v.toString().trim()] = i);
  return map;
}

function getColIndex(headers, name, sheetName) {
  const i = headers.indexOf(name);
  if (i === -1) throw new Error(`'${sheetName}'에서 '${name}' 컬럼 누락`);
  return i;
}

function getOrSelectCompany() {
  const props = PropertiesService.getScriptProperties();
  let saved = props.getProperty('selectedCompany');
  if (!saved || !COMPANY_CONFIG[saved]) {
    const ui = SpreadsheetApp.getUi(), cos = Object.keys(COMPANY_CONFIG);
    const res = ui.prompt('🏢 회사 선택', cos.map((c, i) => `${i + 1}. ${c}`).join('\n'), ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return null;
    saved = cos[parseInt(res.getResponseText()) - 1];
    props.setProperty('selectedCompany', saved);
  }
  return { name: saved, ...COMPANY_CONFIG[saved] };
}

function clearAllColors() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const s = ss.getSheetByName(SHEET_DUP_REPORT);
  if (s) s.clear();
}
