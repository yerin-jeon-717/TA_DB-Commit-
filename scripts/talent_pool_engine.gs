/**
 * [v23.6] 인재풀 엔진
 * 1. [Fix] 이름 번역: B열(Index 1) 강제 인식
 * 2. [📥수입] LinkedIn(5번째~), Remember(6번째~) 시트 수입
 * 3. [🏷️매핑] 인재별 컨텍스트 리포트 + 원본 수정 반영
 * 4. [⚙️설정] 6컬럼 설정 시트 (URL → ID 자동 추출)
 * 5. [PATCH] isExcludedCompany 팝업 제거 — 설정 시트에서 모든 제외 키워드 합산
 * 6. [PATCH] getKeywordsForCompany 재추가
 * 7. [PATCH] runDuplicateScan RichText null 체크
 * 8. [PATCH] getOrSelectCompany throw → null 반환
 * 9. [PATCH] standardizeLineFinal 기간 단독 역산 로직 복구
 * 10. [PATCH] Supabase 동기화 함수 복구 + 메뉴 추가
 * 11. [Update] runRegionMapping 권역 확장 (동남아/중동/남미/CIS/호주/유럽/중국), 해외 키워드 추가
 * 12. [v23.0] 중복대조/병합 함수 ScriptProperties 의존 제거 → 실행 시마다 시트 직접 선택
 * 13. [v23.1] buildCategoryMappingReport/applyCategoryMapping 행 번호 대신 LinkedIn URL 키 매칭
 * 14. [v23.2] applyCategoryMapping URL 추출: col 0 텍스트 대신 col 3 LinkedIn RichText 우선 사용
 * 15. [v23.3] person_id 일괄 생성 + Supabase UPSERT on person_id
 * 16. [v23.4] person_id 열 M→N (M열 Region 기존 사용), CLAUDE.md 스키마 A~N 업데이트
 * 17. [v23.5] runRegionMapping Region 열 고정(M=13) — getLastColumn() 동적 계산 제거
 * 18. [v23.6] mergeLinkedinIntoRemember 복사 열 A~L(12) 고정 — 잉여 컬럼 유입 차단
 */

// ── 전역 상수 ──────────────────────────────────
const SETTING_SHEET_NAME = "⚙️_엔진설정";
const SHEET_DUP_REPORT   = "🔍 중복 대조 리포트";
const SHEET_CATEGORY_MAP = "📋 카테고리 매핑 리포트";
const SUPABASE_URL       = "https://gthajfbofpvyrwuhxfah.supabase.co";

let _cfgCache    = undefined;
let _allCfgCache = undefined;

// ── 메뉴 ──────────────────────────────────────
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 인재풀 엔진 v23.6')
    .addSubMenu(ui.createMenu('🛠️ 1. 데이터 준비')
      .addItem('📥 링크드인 데이터 가져오기', 'importLinkedInData')
      .addItem('📥 리멤버 데이터 가져오기', 'importRememberData')
      .addSeparator()
      .addItem('🔤 이름 열 국문 번역(B열 기준)', 'translateNameColumn')
      .addItem('🧹 포맷 통일(데이터 복구 포함)', 'unifyFormatLinkedinToRemember')
      .addItem('🚀 총 경력 합산 업데이트', 'updateCurrentSheetCareer'))
    .addSeparator()
    .addSubMenu(ui.createMenu('📂 2. 데이터 통합 (중복/매핑)')
      .addItem('🔎 중복 대조 리포트 생성', 'runDuplicateScan')
      .addItem('🔗 선택 중복 병합/삭제 실행', 'applyDuplicateSelections')
      .addSeparator()
      .addItem('🔀 링크드인 잔여 데이터 → 통합 시트에 합치기', 'mergeLinkedinIntoRemember'))
    .addSeparator()
    .addSubMenu(ui.createMenu('🏷️ 3. 팀/직책 카테고리 정규화')
      .addItem('🌏 Region 자동 매핑 실행', 'runRegionMapping')
      .addItem('🏗️ 매핑 리포트 생성 (인재별 검토)', 'buildCategoryMappingReport')
      .addItem('✅ 매핑 결과 일괄 반영 및 초기화', 'applyCategoryMapping'))
    .addSeparator()
    .addItem('⏪ 리포트 서식 초기화', 'clearAllColors')
    .addSeparator()
    .addItem('⚙️ 엔진 설정 시트 초기화/생성', 'setupSettingSheet')
    .addSeparator()
    .addSubMenu(ui.createMenu('☁️ 4. Supabase 동기화')
      .addItem('🆔 person_id 일괄 생성 (M열)', 'generatePersonIds')
      .addSeparator()
      .addItem('📤 현재 통합_ 시트만 업로드', 'syncCurrentSheetToSupabase')
      .addItem('📤 모든 통합_ 시트 일괄 업로드', 'syncAllSheetsToSupabase'))
    .addToUi();
}

// ── [공통] 시트 선택 팝업 ──────────────────────
// filterFn: 시트 목록 필터 함수 (없으면 전체 표시)
// 1개뿐이면 자동 선택, 0개면 null 반환

function _pickSheet(title, filterFn) {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();
  const sheets = ss.getSheets().filter(filterFn || (() => true));
  if (sheets.length === 0) { ui.alert(`❌ 선택 가능한 시트가 없습니다.\n(${title})`); return null; }
  if (sheets.length === 1) return sheets[0];
  const list = sheets.map((s, i) => `${i + 1}. ${s.getName()}`).join('\n');
  const res = ui.prompt(title, list, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  const idx = parseInt(res.getResponseText().trim()) - 1;
  if (isNaN(idx) || idx < 0 || idx >= sheets.length) { ui.alert('❌ 올바른 번호를 입력하세요.'); return null; }
  return sheets[idx];
}

// ── [1. 데이터 준비] 수입 ──────────────────────

function importLinkedInData() { _importDataFlowFinal('linkedin'); }
function importRememberData()  { _importDataFlowFinal('remember'); }

function _importDataFlowFinal(type) {
  const ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getOrSelectCompany(); if (!cfg) return;
  const sourceId = (type === 'linkedin') ? cfg.linkedinSourceId : cfg.rememberSourceId;
  if (!sourceId) return ui.alert(`❌ '${cfg.name}'의 원본 ID가 없습니다. 설정 시트를 확인하세요.`);

  try {
    const sourceSs  = SpreadsheetApp.openById(sourceId);
    const allSheets = sourceSs.getSheets();
    const dataSheets = (type === 'linkedin') ? allSheets.slice(4) : allSheets.slice(5);
    if (dataSheets.length === 0) return ui.alert("대상 범위에 시트가 없습니다.");

    const sheetList = dataSheets.map((s, i) => `${i + 1}. ${s.getName()}`).join('\n');
    const res = ui.prompt(`📥 ${type.toUpperCase()} 데이터 수입`, `번호를 입력하세요:\n\n${sheetList}`, ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;

    const selIdx = parseInt(res.getResponseText().trim()) - 1;
    if (isNaN(selIdx) || selIdx < 0 || selIdx >= dataSheets.length) return ui.alert("올바른 번호를 입력하세요.");
    const selectedSheet = dataSheets[selIdx];
    const sData = selectedSheet.getDataRange().getValues().slice(1);
    const linkCol = (type === 'linkedin') ? 10 : 2;
    const sRTs = selectedSheet.getRange(2, linkCol, sData.length, 1).getRichTextValues();

    const ts = Utilities.formatDate(new Date(), "GMT+9", "yyyyMMdd_HHmm");
    const newName = `${(type === 'linkedin' ? 'linkedin' : 'Remember')}_${selectedSheet.getName()}_${ts}`;
    const target = ss.insertSheet(newName);

    target.appendRow(["회사명","이름","리멤버 페이지","링크드인 페이지","대분류(직무)","팀","직책","총 경력","재직 기간","이전 경력","학력","기준일"]);

    const results = (type === 'linkedin')
      ? sData.map(r => [selectedSheet.getName(), r[0], "", "linkedin", "", "", r[1], "", r[2], r[4], r[3], r[10]])
      : sData.map(r => [selectedSheet.getName(), r[0], "link", "", "", r[2], r[3], "", r[4], r[5], r[6], r[7]]);

    target.getRange(2, 1, results.length, 12).setValues(results);
    const links = sRTs.map(r => {
      const url = r[0] ? (r[0].getLinkUrl() || "") : "";
      return [SpreadsheetApp.newRichTextValue().setText(type === 'linkedin' ? 'linkedin' : 'link').setLinkUrl(url).build()];
    });
    target.getRange(2, (type === 'linkedin' ? 4 : 3), links.length, 1).setRichTextValues(links);
    target.autoResizeColumns(1, 12);
    ui.alert(`✅ '${newName}' 수입 완료!`);
  } catch (e) { ui.alert("오류: " + e.message); }
}

// ── [Fix] 이름 열 국문 번역 (B열 강제) ──────────

function translateNameColumn() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const tMap = getColMap(sheet);
  let nameIdx = tMap["이름"];
  if (nameIdx === undefined) nameIdx = 1;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const range = sheet.getRange(2, nameIdx + 1, lastRow - 1, 1);
  const values = range.getValues();
  let count = 0;

  const translated = values.map(row => {
    let t = String(row[0]).trim();
    if (t !== "" && !/[가-힣]/.test(t)) {
      try {
        const tr = LanguageApp.translate(t, 'en', 'ko');
        if (t !== tr) { count++; return [t + "\n" + tr]; }
      } catch (e) {}
    }
    return [row[0]];
  });

  range.setValues(translated);
  SpreadsheetApp.getUi().alert(`✅ 번역 완료: 총 ${count}명`);
}

// ── [3. 카테고리 정규화] ───────────────────────

function buildCategoryMappingReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();
  const sheet = ss.getActiveSheet(), tMap = getColMap(sheet);
  const data = sheet.getDataRange().getValues(), rts = sheet.getDataRange().getRichTextValues();
  if (data.length < 2) return ui.alert("데이터 없음");

  const liList = [], refTeams = new Set(), refRoles = new Set();
  for (let i = 1; i < data.length; i++) {
    const rem = String(data[i][tMap["리멤버 페이지"]] || "").trim();
    const li  = String(data[i][tMap["링크드인 페이지"]] || "").trim();
    if ((rem === "" || rem === "-") && li !== "") {
      liList.push({
        liUrl: _extractRichUrl(rts[i][tMap["링크드인 페이지"]]),
        name: data[i][tMap["이름"]],
        liRt:  rts[i][tMap["링크드인 페이지"]],
        remRt: rts[i][tMap["리멤버 페이지"]],
        role:  data[i][tMap["직책"]]
      });
    }
    if (rem !== "" && rem !== "-") {
      const t = data[i][tMap["팀"]];   if (t && t !== "-") refTeams.add(String(t));
      const p = data[i][tMap["직책"]]; if (p && p !== "-") refRoles.add(String(p));
    }
  }

  if (liList.length === 0) return ui.alert("매핑할 LinkedIn 데이터가 없습니다.");

  let rep = ss.getSheetByName(SHEET_CATEGORY_MAP) || ss.insertSheet(SHEET_CATEGORY_MAP);
  rep.clear();
  rep.appendRow(["링크드인URL","이름","링크드인","리멤버","LinkedIn 직책(원본/수정가능)","→ 팀 (표준 선택)","→ 직책 (표준 선택)"]);
  rep.getRange(1, 1, 1, 7).setBackground("#45818e").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");

  const reportRows = liList.map(item => [item.liUrl, item.name, "", "", item.role, "", ""]);
  rep.getRange(2, 1, reportRows.length, 7).setValues(reportRows);

  const teamArr = [...refTeams].sort(), roleArr = [...refRoles].sort();
  const dvT = teamArr.length > 0 ? SpreadsheetApp.newDataValidation().requireValueInList(teamArr, true).build() : null;
  const dvR = roleArr.length > 0 ? SpreadsheetApp.newDataValidation().requireValueInList(roleArr, true).build() : null;

  liList.forEach((item, idx) => {
    const r = idx + 2;
    if (item.liRt)  rep.getRange(r, 3).setRichTextValue(item.liRt);
    if (item.remRt) rep.getRange(r, 4).setRichTextValue(item.remRt);
    if (dvT) rep.getRange(r, 6).setDataValidation(dvT).setBackground("#fff2cc");
    if (dvR) rep.getRange(r, 7).setDataValidation(dvR).setBackground("#fff2cc");
  });

  PropertiesService.getScriptProperties().setProperty('categoryMapSourceSheet', sheet.getName());
  rep.hideColumns(1);
  rep.autoResizeColumns(2, 7);
  rep.activate();
}

function applyCategoryMapping() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();
  const rep = ss.getSheetByName(SHEET_CATEGORY_MAP);
  if (!rep || rep.getLastRow() < 2) return ui.alert("매핑 리포트가 없습니다.");

  const sourceName = PropertiesService.getScriptProperties().getProperty('categoryMapSourceSheet');
  const main = sourceName ? ss.getSheetByName(sourceName) : null;
  if (!main) return ui.alert("원본 시트를 찾을 수 없습니다.\n매핑 리포트를 다시 생성해주세요.");

  const tMap = getColMap(main);
  const mainRts = main.getDataRange().getRichTextValues();

  // Build LinkedIn URL → actual row number (1-based) lookup from current sheet state
  const urlToRow = {};
  for (let i = 1; i < mainRts.length; i++) {
    const url = _extractRichUrl(mainRts[i][tMap["링크드인 페이지"]]);
    if (url) urlToRow[url] = i + 1;
  }

  const data    = rep.getDataRange().getValues();
  const repRts  = rep.getDataRange().getRichTextValues();
  let count = 0, skipped = 0;

  for (let i = 1; i < data.length; i++) {
    // col 3 (index 2) = 링크드인 RichText (소스 시트에서 직접 복사) → col 0 텍스트 fallback
    const liUrl      = _extractRichUrl(repRts[i][2]) || String(data[i][0] || "").trim();
    const editedRole = String(data[i][4] || "").trim();
    const selTeam    = String(data[i][5] || "").trim();
    const selRole    = String(data[i][6] || "").trim();

    const rowIdx = urlToRow[liUrl];
    if (!rowIdx) { skipped++; continue; }

    const roleCell = main.getRange(rowIdx, tMap["직책"] + 1);

    if (selTeam) main.getRange(rowIdx, tMap["팀"] + 1).setValue(selTeam);

    if (selRole) {
      roleCell.setValue(selRole);
      if (editedRole) {
        const oldNote = roleCell.getNote();
        const nText = `[LinkedIn 원본] ${editedRole}`;
        roleCell.setNote(oldNote ? oldNote + "\n" + nText : nText);
      }
    } else if (editedRole) {
      roleCell.setValue(editedRole);
    }
    count++;
  }

  const skipMsg = skipped > 0 ? `\n(LinkedIn URL 미매칭 ${skipped}건 건너뜀)` : "";

  rep.clear();
  ui.alert(`✅ 총 ${count}명 반영 완료!${skipMsg}`);
}

// ── [⚙️ 설정] ─────────────────────────────────

function setupSettingSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(SETTING_SHEET_NAME) || ss.insertSheet(SETTING_SHEET_NAME);
  s.clear();
  s.appendRow(["회사명","LinkedIn 원본 URL","Remember 원본 URL","LinkedIn ID (자동)","Remember ID (자동)","제외 키워드"]);
  s.getRange(1, 1, 1, 6).setBackground("#444444").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");
  s.getRange(2, 4, 100, 2).setBackground("#f3f3f3");
  s.autoResizeColumns(1, 6);
  ss.toast("✅ 설정 시트 생성 완료!");
}

function onEdit(e) {
  if (!e) return;
  const range = e.range, sheet = range.getSheet();
  if (sheet.getName() !== SETTING_SHEET_NAME) return;
  const col = range.getColumn(), val = String(e.value || "");
  if (range.getRow() > 1 && (col === 2 || col === 3) && val.includes("/d/")) {
    const match = val.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match) sheet.getRange(range.getRow(), col + 2).setValue(match[1]);
  }
}

// ── getOrSelectCompany ────────────────────────

function getOrSelectCompany() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const activeName = ss.getActiveSheet().getName();
  const setSheet = ss.getSheetByName(SETTING_SHEET_NAME);

  if (!setSheet) {
    SpreadsheetApp.getUi().alert('⚠️ 설정 시트가 없습니다.\n메뉴 → "⚙️ 엔진 설정 시트 초기화/생성"을 먼저 실행하세요.');
    return null;
  }

  const configData = setSheet.getDataRange().getValues();
  const config = {};
  for (let i = 1; i < configData.length; i++) {
    const [name, lu, ru, li, ri, kw] = configData[i];
    if (!name) continue;
    config[name] = {
      linkedinSourceId: li,
      rememberSourceId: ri,
      excludeKeywords: kw ? kw.toString().split(',').map(x => x.trim()).filter(x => x) : []
    };
  }

  const names = Object.keys(config);
  if (names.length === 0) {
    SpreadsheetApp.getUi().alert('⚠️ 설정 시트에 회사 정보가 없습니다.');
    return null;
  }

  let matched = names.find(n => activeName.includes(n));
  if (!matched) {
    const res = SpreadsheetApp.getUi().prompt(
      '🏢 회사 선택',
      names.map((n, i) => `${i + 1}. ${n}`).join('\n'),
      SpreadsheetApp.getUi().ButtonSet.OK_CANCEL
    );
    if (res.getSelectedButton() !== SpreadsheetApp.getUi().Button.OK) return null;
    const idx = parseInt(res.getResponseText()) - 1;
    if (isNaN(idx) || idx < 0 || idx >= names.length) return null;
    matched = names[idx];
  }

  _cfgCache    = undefined;
  _allCfgCache = undefined;

  return { name: matched, ...config[matched] };
}

function getColMap(s) {
  const h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0], m = {};
  h.forEach((v, i) => m[v.toString().trim()] = i);
  return m;
}

// ── getKeywordsForCompany ─────────────────────

function getKeywordsForCompany(companyName) {
  if (!companyName) return [];
  const name = companyName.toString().trim();
  if (!name) return [];

  if (_allCfgCache === undefined) {
    _allCfgCache = {};
    try {
      const setSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTING_SHEET_NAME);
      if (setSheet) {
        const data = setSheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const [cName, , , , , kw] = data[i];
          if (!cName) continue;
          const cStr = cName.toString().trim();
          _allCfgCache[cStr] = kw
            ? kw.toString().split(',').map(x => x.trim()).filter(x => x)
            : [cStr];
        }
      }
    } catch (e) {}
  }

  const configKey = Object.keys(_allCfgCache).find(k =>
    k.toLowerCase() === name.toLowerCase() ||
    (_allCfgCache[k].some(kw => name.toLowerCase().includes(kw.toLowerCase())))
  );
  return configKey ? _allCfgCache[configKey] : [name];
}

// ── isExcludedCompany (팝업 없이 설정 시트 전체 키워드 합산) ──

function isExcludedCompany(text) {
  if (_cfgCache === undefined) {
    _cfgCache = { excludeKeywords: [] };
    try {
      const setSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTING_SHEET_NAME);
      if (setSheet) {
        const data = setSheet.getDataRange().getValues();
        const allKw = [];
        for (let i = 1; i < data.length; i++) {
          const kw = data[i][5];
          if (kw) kw.toString().split(',').map(x => x.trim()).filter(x => x).forEach(k => allKw.push(k));
        }
        _cfgCache = { excludeKeywords: allKw };
      }
    } catch (e) {}
  }
  if (!text || !_cfgCache.excludeKeywords.length) return false;
  const cleanText = text.toLowerCase().replace(/\s/g, '');
  return _cfgCache.excludeKeywords.some(kw => cleanText.includes(kw.toLowerCase().replace(/\s/g, '')));
}

// ── [🧹 정제] ─────────────────────────────────

function unifyFormatLinkedinToRemember() {
  try {
    const sheet = SpreadsheetApp.getActiveSheet(), tMap = getColMap(sheet), lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const cIdx = (tMap["재직 기간"] !== undefined ? tMap["재직 기간"] : tMap["재직기간"]) + 1;
    const pIdx = tMap["이전 경력"] + 1;
    const dataValues  = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const companyVals = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

    dataValues.forEach((row, i) => {
      let cT = String(row[cIdx - 1] || "").trim(), pT = String(row[pIdx - 1] || "").trim();
      const kws = getKeywordsForCompany(companyVals[i][0]);
      if (kws.length > 0 && pT) {
        const pLs = pT.split('\n'), cLs = pLs.filter(l => isCurrentCompanyLine(l, kws));
        if (cLs.length > 0 && (cT === "" || cT === "-")) {
          const e = extractEarliestDate(cLs); if (e) cT = e + " ~ 현재";
        }
      }
      row[cIdx - 1] = cT ? cT.split('\n').map(l => standardizeLineFinal(l, true)).filter(String).join('\n') : "";
      row[pIdx - 1] = pT ? pT.split('\n').map(l => standardizeLineFinal(l, false)).filter(String).join('\n') : "";
    });

    sheet.getRange(2, cIdx, lastRow - 1, 1).setValues(dataValues.map(r => [r[cIdx - 1]]));
    sheet.getRange(2, pIdx, lastRow - 1, 1).setValues(dataValues.map(r => [r[pIdx - 1]]));
    SpreadsheetApp.getUi().alert("✅ 복구 및 포맷 정화 완료");
  } catch (e) { SpreadsheetApp.getUi().alert("오류: " + e.message); }
}

function standardizeLineFinal(line, isCurrentJob) {
  if (!line || line.trim() === "" || line === "-") return "";
  line = normalizeEngDateAndDuration(line.trim())
    .replace(/(\d{4})년\s*(\d{1,2})월/g, (m, p1, p2) => p1 + "." + p2.padStart(2, '0'));

  const durationOnlyRegex = /^(\d+년\s*\d+개월|\d+년|\d+개월)$/;
  if (durationOnlyRegex.test(line.trim())) {
    const yM = line.match(/(\d+)년/), mM = line.match(/(\d+)개월/);
    const y = yM ? parseInt(yM[1]) : 0, mo = mM ? parseInt(mM[1]) : 0;
    const now = new Date(); now.setMonth(now.getMonth() - (y * 12 + mo) + 1);
    const sy = now.getFullYear(), sm = String(now.getMonth() + 1).padStart(2, '0');
    const durStr = y === 0 ? `${mo}개월` : mo === 0 ? `${y}년` : `${y}년 ${mo}개월`;
    return isCurrentJob
      ? `${sy}.${sm} ~ 현재 (${durStr})`
      : `[${sy}.${sm} ~ 현재 (${durStr})]`;
  }

  const dateRegex = /(\d{4}\.\d{2})\s*[\-~|·]\s*([\d\.]+|현재|Present)/i;
  const match = line.match(dateRegex);
  if (match) {
    let sD = match[1], eD = match[2].replace(/Present/i, "현재").trim();
    const sP = sD.split('.'), sy = parseInt(sP[0]), sm = parseInt(sP[1]);
    let ey = new Date().getFullYear(), em = new Date().getMonth() + 1;
    if (eD !== "현재") { const eP = eD.split('.'); ey = parseInt(eP[0]); em = parseInt(eP[1]); }
    const dur = calcDurationBetween(sy, sm, ey, em);
    let info = line.replace(dateRegex, '').replace(/\(.*?\)/g, '').replace(/[\[\]]/g, '')
      .replace(/^\s*[\-·~]\s*/, '').replace(/\(주\)|\(유\)|\(사\)|㈜/g, '').replace(/\s{2,}/g, ' ')
      .replace(' - ', ' | ').trim();
    if (!isCurrentJob && isExcludedCompany(info)) return "";
    return isCurrentJob ? `${sD} ~ ${eD} (${dur}) ${info}` : `[${sD} ~ ${eD} (${dur})] ${info}`;
  }

  return isCurrentJob ? line : (isExcludedCompany(line) ? "" : line);
}

// ── [📂 중복 대조] Gate 방식 ──────────────────

function runDuplicateScan() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();

  const s1 = _pickSheet('📋 리멤버 시트 선택', s => s.getName().startsWith('Remember_'));
  if (!s1) return;
  const s2 = _pickSheet('📋 링크드인 시트 선택', s => s.getName().startsWith('linkedin_'));
  if (!s2) return;

  const d1 = s1.getDataRange().getValues(), d2 = s2.getDataRange().getValues();
  const h1 = d1[0], h2 = d2[0];
  const idx1 = { n: h1.indexOf('이름'), p: h1.indexOf('재직 기간'), c: h1.indexOf('이전 경력'), e: h1.indexOf('학력'), r: h1.indexOf('리멤버 페이지'), l: h1.indexOf('링크드인 페이지') };
  const idx2 = { n: h2.indexOf('이름'), p: h2.indexOf('재직 기간'), c: h2.indexOf('이전 경력'), e: h2.indexOf('학력'), r: h2.indexOf('리멤버 페이지'), l: h2.indexOf('링크드인 페이지') };

  const lastRow1 = d1.length - 1, lastRow2 = d2.length - 1;
  const rt1C = lastRow1 > 0 ? s1.getRange(2, idx1.r + 1, lastRow1, 1).getRichTextValues() : [];
  const rt1D = lastRow1 > 0 ? s1.getRange(2, idx1.l + 1, lastRow1, 1).getRichTextValues() : [];
  const rt2C = lastRow2 > 0 ? s2.getRange(2, idx2.r + 1, lastRow2, 1).getRichTextValues() : [];
  const rt2D = lastRow2 > 0 ? s2.getRange(2, idx2.l + 1, lastRow2, 1).getRichTextValues() : [];

  const getUrl = (rtArr, rowIdx) => {
    const rt = rtArr[rowIdx] && rtArr[rowIdx][0];
    return rt ? (rt.getLinkUrl() || '') : '';
  };

  const dups = [];
  for (let i = 1; i < d1.length; i++) {
    for (let j = 1; j < d2.length; j++) {
      const dt1 = extractAprStartDate(d1[i][idx1.p]), dt2 = extractAprStartDate(d2[j][idx2.p]);
      if (dt1 === '-' || dt1 !== dt2) continue;
      const matched = [
        { l: '성 일치',    m: compareSurname(d1[i][idx1.n], d2[j][idx2.n]) },
        { l: '경력 유사',  m: comparePreviousCompanies(d1[i][idx1.c], d2[j][idx2.c]) },
        { l: '학력 유사',  m: compareEducation(d1[i][idx1.e], d2[j][idx2.e]) }
      ].filter(x => x.m);
      if (matched.length === 0) continue;
      dups.push({
        a: matched.length >= 2, m: matched, dt: dt1,
        r1: i + 1, r2: j + 1, d1: d1[i], d2: d2[j],
        u1C: getUrl(rt1C, i - 1), u1D: getUrl(rt1D, i - 1),
        u2C: getUrl(rt2C, j - 1), u2D: getUrl(rt2D, j - 1)
      });
    }
  }

  // applyDuplicateSelections에서 같은 시트 재사용
  const p = PropertiesService.getScriptProperties();
  p.setProperty('_dupScan_s1', s1.getName());
  p.setProperty('_dupScan_s2', s2.getName());

  let rep = ss.getSheetByName(SHEET_DUP_REPORT) || ss.insertSheet(SHEET_DUP_REPORT);
  rep.clear();
  rep.appendRow(['선택','처리','입사년월','일치항목','기존행','기존이름','기존리멤버','기존링크드인','신규행','신규이름','신규리멤버','신규링크드인']);
  rep.getRange(1, 1, 1, 12).setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');

  if (dups.length > 0) {
    const rv = dups.map(d => [false, d.a ? '✅자동' : '🔍검토', d.dt, d.m.map(x => x.l).join('·'), d.r1, d.d1[idx1.n], '', '', d.r2, d.d2[idx2.n], '', '']);
    rep.getRange(2, 1, rv.length, 12).setValues(rv);
    dups.forEach((d, k) => {
      const r = k + 2;
      const b = (t, u) => SpreadsheetApp.newRichTextValue().setText(t).setLinkUrl(u || "").build();
      rep.getRange(r, 7).setRichTextValue(b('리멤버',  d.u1C));
      rep.getRange(r, 8).setRichTextValue(b('linkedin', d.u1D));
      rep.getRange(r, 11).setRichTextValue(b('리멤버',  d.u2C));
      rep.getRange(r, 12).setRichTextValue(b('linkedin', d.u2D));
      rep.getRange(r, 1, 1, 12).setBackground(d.a ? '#e6f4ea' : '#fef9c3');
    });
    rep.getRange(2, 1, rv.length, 1).insertCheckboxes();
    dups.forEach((d, k) => { if (d.a) rep.getRange(k + 2, 1).setValue(true); });
  }

  rep.activate();
  const autoCount = dups.filter(d => d.a).length;
  ui.alert(`✅ 완료: 총 ${dups.length}건\n✅ 자동 병합: ${autoCount}건\n🔍 검토 필요: ${dups.length - autoCount}건`);
}

function applyDuplicateSelections() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();
  const repS = ss.getSheetByName(SHEET_DUP_REPORT);
  if (!repS || repS.getLastRow() < 2) return ui.alert('❌ 중복 대조 리포트가 없습니다. 먼저 리포트를 생성하세요.');

  // 직전 runDuplicateScan에서 저장한 시트명 우선 사용, 없으면 선택 팝업
  const p = PropertiesService.getScriptProperties();
  const saved1 = p.getProperty('_dupScan_s1'), saved2 = p.getProperty('_dupScan_s2');
  const tarS = (saved1 && ss.getSheetByName(saved1)) || _pickSheet('📋 리멤버 시트 선택 (병합 대상)', s => s.getName().startsWith('Remember_'));
  if (!tarS) return;
  const newS = (saved2 && ss.getSheetByName(saved2)) || _pickSheet('📋 링크드인 시트 선택 (삭제 대상)', s => s.getName().startsWith('linkedin_'));
  if (!newS) return;

  const rData = repS.getDataRange().getValues();
  const t1 = getColMap(tarS), t2 = getColMap(newS);
  const del = [];

  for (let i = 1; i < rData.length; i++) {
    if (rData[i][0] !== true) continue;
    const a = rData[i][4], b = rData[i][8];
    const name = newS.getRange(b, t2["이름"] + 1).getValue();
    const link = newS.getRange(b, t2["링크드인 페이지"] + 1).getRichTextValue();
    const pos  = newS.getRange(b, t2["직책"] + 1).getValue();

    tarS.getRange(a, t1["이름"] + 1).setValue(name);
    if (link && link.getLinkUrl()) {
      tarS.getRange(a, t1["링크드인 페이지"] + 1).setRichTextValue(
        SpreadsheetApp.newRichTextValue().setText("linkedin").setLinkUrl(link.getLinkUrl()).build()
      );
    }
    if (pos) {
      const c = tarS.getRange(a, t1["직책"] + 1);
      c.setNote((c.getNote() ? c.getNote() + "\n" : "") + "[LinkedIn] " + pos);
    }
    del.push(b);
  }

  [...new Set(del)].sort((x, y) => y - x).forEach(idx => newS.deleteRow(idx));
  repS.clear();
  ui.alert(`✅ 처리 완료: ${del.length}건`);
}

function mergeLinkedinIntoRemember() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();

  const repSheet = ss.getSheetByName(SHEET_DUP_REPORT);
  if (repSheet && repSheet.getLastRow() > 1) {
    const res = ui.alert('⚠️ 중복 리포트 미처리', '처리되지 않은 중복 데이터가 있습니다. 그래도 진행하시겠습니까?', ui.ButtonSet.YES_NO);
    if (res !== ui.Button.YES) return;
  }

  const remS = _pickSheet('📋 리멤버 시트 선택 (합칠 대상)', s => s.getName().startsWith('Remember_'));
  if (!remS) return;
  const liS = _pickSheet('📋 링크드인 시트 선택 (병합 후 숨김)', s => s.getName().startsWith('linkedin_'));
  if (!liS) return;

  const liData = liS.getDataRange().getValues().slice(1)
    .map(r => r.slice(0, 12));  // A~L(12열) 고정 — 헤더 없는 잉여 컬럼 유입 방지
  if (liData.length === 0) return ui.alert('링크드인 시트에 남은 데이터가 없습니다.');

  const t2 = getColMap(liS);
  const rtC = liS.getRange(2, t2["리멤버 페이지"]  + 1, liData.length, 1).getRichTextValues();
  const rtD = liS.getRange(2, t2["링크드인 페이지"] + 1, liData.length, 1).getRichTextValues();

  const startRow = remS.getLastRow() + 1;
  remS.getRange(startRow, 1, liData.length, 12).setValues(liData);
  const t1 = getColMap(remS);
  remS.getRange(startRow, t1["리멤버 페이지"]  + 1, liData.length, 1).setRichTextValues(rtC);
  remS.getRange(startRow, t1["링크드인 페이지"] + 1, liData.length, 1).setRichTextValues(rtD);

  liS.hideSheet();
  ui.alert(`✅ 합치기 완료: ${liData.length}건`);
}

// ── [기타 유틸리티] ───────────────────────────

function normalizeEngDateAndDuration(l) {
  l = l.replace(/(\d+)\s+yrs?\s+(\d+)\s+mos?/gi, (_, y, m) => `${y}년 ${m}개월`)
       .replace(/(\d+)\s+yrs?/gi, '$1년')
       .replace(/(\d+)\s+mos?/gi, '$1개월');
  const M = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  return l.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/gi,
    (_, mon, yr) => `${yr}.${M[mon.toLowerCase()]}`).replace(/\bPresent\b/gi, '현재');
}

function calcDurationBetween(sy, sm, ey, em) {
  const t = (ey * 12 + em) - (sy * 12 + sm) + 1;
  if (t <= 0) return "0개월";
  const y = Math.floor(t / 12), m = t % 12;
  return y === 0 ? `${m}개월` : m === 0 ? `${y}년` : `${y}년 ${m}개월`;
}

function isCurrentCompanyLine(l, k) {
  const c = l.toLowerCase().replace(/\s/g, '');
  return k.some(x => c.includes(x.toLowerCase().replace(/\s/g, '')));
}

function extractEarliestDate(ls) {
  let e = null;
  ls.forEach(l => {
    let n = normalizeEngDateAndDuration(l).replace(/(\d{4})년\s*(\d{1,2})월/g, (_, y, m) => y + '.' + m.padStart(2, '0'));
    [...n.matchAll(/(\d{4}\.\d{2})/g)].map(m => m[1]).forEach(d => { if (!e || d < e) e = d; });
  });
  return e;
}

function extractAprStartDate(t) {
  const m = String(t).match(/(\d{4}[.\-]\d{2})\s*~/);
  return m ? m[1].replace('-', '.') : '-';
}

function compareSurname(n1, n2) {
  const s1 = String(n1).trim().split('\n').pop().charAt(0);
  const s2 = String(n2).trim().split('\n').pop().charAt(0);
  return s1 !== "" && s1 === s2;
}

function comparePreviousCompanies(c1, c2) {
  const x1 = extractNonAprCompanies(String(c1)), x2 = extractNonAprCompanies(String(c2));
  return x1.some(a => x2.some(b => isSimilarText(a, b)));
}

function extractNonAprCompanies(t) {
  return t.split('\n').map(l => {
    const a = l.match(/\]\s*(.+)/); if (!a) return '';
    const c = a[1], p = c.indexOf('|'), d = c.indexOf(' - ');
    let e = c.length;
    if (p >= 0) e = Math.min(e, p);
    if (d >= 0) e = Math.min(e, d);
    return c.substring(0, e).trim();
  }).filter(n => n.length > 0 && !isExcludedCompany(n));
}

function compareEducation(e1, e2) {
  const s1 = extractSchools(String(e1)), s2 = extractSchools(String(e2));
  return s1.some(a => s2.some(b => isSimilarText(a, b)));
}

function extractSchools(t) {
  return t.split('\n').map(l => { const m = l.match(/^(.+?)\s*-\s*/); return m ? m[1].trim() : ''; }).filter(s => s.length > 0);
}

function isSimilarText(a, b) {
  const n1 = a.toLowerCase().replace(/[\s\-_·.,()]/g, '');
  const n2 = b.toLowerCase().replace(/[\s\-_·.,()]/g, '');
  return n1.length >= 2 && n2.length >= 2 && (n1.includes(n2) || n2.includes(n1));
}

function updateCurrentSheetCareer() {
  const s = SpreadsheetApp.getActiveSheet(), t = getColMap(s);
  const d = s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).getValues();
  const res = d.map(r => {
    let tot = 0;
    const comb = String(r[t["재직 기간"] !== undefined ? t["재직 기간"] : t["재직기간"]] || "") + "\n" + String(r[t["이전 경력"]] || "");
    [...comb.matchAll(/\((\d+년\s*\d+개월|\d+년|\d+개월)\)/g)].forEach(m => {
      const y = m[1].match(/(\d+)년/), mo = m[1].match(/(\d+)개월/);
      tot += (y ? parseInt(y[1]) * 12 : 0) + (mo ? parseInt(mo[1]) : 0);
    });
    return [tot > 0 ? (Math.floor(tot / 12) > 0 ? `${Math.floor(tot / 12)}년 ${tot % 12}개월`.replace(' 0개월', '') : `${tot % 12}개월`) : "-"];
  });
  s.getRange(2, t["총 경력"] + 1, res.length, 1).setValues(res);
}

function runRegionMapping() {
  const s = SpreadsheetApp.getActiveSheet(), t = getColMap(s);
  const res = s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).getValues().map(r => {
    const c = (String(r[t["팀"]] || "") + " " + String(r[t["직책"]] || "")).toLowerCase(), m = [];
    [
      {r:"북미",  k:["북미","us ","usa","미국","틱톡샵","north america","northamerica"]},
      {r:"일본",  k:["일본","japan","jp "]},
      {r:"한국",  k:["한국","국내","korea","kr "]},
      {r:"동남아", k:["sea","동남아","southeast asia","싱가포르","베트남","태국","인도네시아","말레이시아","필리핀","singapore","vietnam","thailand","indonesia","malaysia"]},
      {r:"중동",  k:["mena","중동","두바이","uae","사우디","middle east","north africa"]},
      {r:"남미",  k:["latam","중남미","라틴아메리카","latin america","브라질","멕시코","brazil","mexico"]},
      {r:"CIS",   k:["cis","러시아","카자흐스탄","russia","kazakhstan","중앙아시아"]},
      {r:"호주",  k:["호주","australia","aus","오세아니아","oceania"]},
      {r:"유럽",  k:["유럽","europe","eu ","영국","독일","프랑스","uk ","germany","france"]},
      {r:"중국",  k:["중국","china","cn ","차이나"]},
      {r:"글로벌",k:["글로벌","global","해외"]}
    ].forEach(rule => { if (rule.k.some(kw => c.includes(kw))) m.push(rule.r); });
    return [m.length > 0 ? [...new Set(m.filter(x => x !== "글로벌"))].join("|") || "글로벌" : "NA"];
  });
  const REGION_COL = 13;  // M열 고정 (getLastColumn() 동적 계산 금지 — 시트별 컬럼 수 차이로 위치 오염 발생)
  const col = t["Region"] !== undefined ? t["Region"] + 1 : REGION_COL;
  if (t["Region"] === undefined) s.getRange(1, col).setValue("Region");
  s.getRange(2, col, res.length, 1).setValues(res);
}

function clearAllColors() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [SHEET_DUP_REPORT, SHEET_CATEGORY_MAP].forEach(n => { const s = ss.getSheetByName(n); if (s) s.clear(); });
}

// ── [🆔 person_id 관리] ───────────────────────

/**
 * 모든 통합_ 시트의 M열에 person_id(UUID)를 일괄 생성.
 * - 이미 값이 있으면 보존 (불변)
 * - LinkedIn URL / Remember URL이 다른 시트에서 이미 사용된 ID면 동일 ID 사용 (cross-sheet 동일인)
 * - M1 헤더 "person_id" 없으면 자동 생성
 */
function generatePersonIds() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const targets = ss.getSheets().filter(s => s.getName().startsWith("통합_") && !s.isSheetHidden());
  if (targets.length === 0) return ui.alert("통합_ 시트가 없습니다.");

  const PERSON_ID_COL = 14;  // N열 (1-based)
  const urlMap = {};          // {url: person_id} — cross-sheet dedup용

  // 1단계: 기존 ID 수집 (보존)
  for (const sheet of targets) {
    const tMap = getColMap(sheet);
    if (!("person_id" in tMap)) continue;
    const data = sheet.getDataRange().getValues();
    const rts  = sheet.getDataRange().getRichTextValues();
    for (let i = 1; i < data.length; i++) {
      const pid = String(data[i][tMap["person_id"]] || "").trim();
      if (!pid) continue;
      const liUrl  = _extractRichUrl(rts[i][tMap["링크드인 페이지"]]);
      const remUrl = _extractRichUrl(rts[i][tMap["리멤버 페이지"]]);
      if (liUrl)  urlMap[liUrl]  = pid;
      if (remUrl) urlMap[remUrl] = pid;
    }
  }

  // 2단계: 미생성 ID 채우기
  let created = 0, skipped = 0;
  for (const sheet of targets) {
    const tMap = getColMap(sheet);
    const data = sheet.getDataRange().getValues();
    const rts  = sheet.getDataRange().getRichTextValues();

    // M1 헤더 없으면 추가
    if (!("person_id" in tMap)) {
      sheet.getRange(1, PERSON_ID_COL)
        .setValue("person_id")
        .setBackground("#efefef")
        .setFontWeight("bold");
      tMap["person_id"] = PERSON_ID_COL - 1;  // 0-based
    }

    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][tMap["이름"]] || "").trim();
      if (!name) continue;

      const existing = String(data[i][tMap["person_id"]] || "").trim();
      if (existing) { skipped++; continue; }

      const liUrl  = _extractRichUrl(rts[i][tMap["링크드인 페이지"]]);
      const remUrl = _extractRichUrl(rts[i][tMap["리멤버 페이지"]]);

      // cross-sheet 동일인 확인
      let pid = (liUrl && urlMap[liUrl]) || (remUrl && urlMap[remUrl]) || "";
      if (!pid) {
        pid = Utilities.getUuid();
        if (liUrl)  urlMap[liUrl]  = pid;
        if (remUrl) urlMap[remUrl] = pid;
      }

      sheet.getRange(i + 1, PERSON_ID_COL).setValue(pid);
      created++;
    }
    SpreadsheetApp.flush();
  }

  ui.alert(`✅ person_id 생성 완료\n신규: ${created}건 / 기존 유지: ${skipped}건\n\n* M열에 person_id가 채워졌습니다.\n* 이제 Supabase 업로드를 실행하세요.`);
}

// ── [☁️ Supabase 동기화] ──────────────────────

function syncCurrentSheetToSupabase() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const sheetName = sheet.getName();

  if (!sheetName.startsWith("통합_")) {
    ui.alert("⚠️ 통합_ 시트를 활성화한 뒤 실행하세요.\n현재 시트: " + sheetName);
    return;
  }

  const serviceKey = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!serviceKey) {
    ui.alert("⚠️ SUPABASE_SERVICE_KEY가 설정되지 않았습니다.\n스크립트 편집기 → 프로젝트 설정 → 스크립트 속성에서 추가하세요.");
    return;
  }

  const rows = _extractSheetForSupabase(sheet, sheetName);
  if (rows.length === 0) { ui.alert('동기화할 데이터가 없습니다.'); return; }

  const hasPid = rows.every(r => r.person_id);
  if (!hasPid) {
    ui.alert('⚠️ person_id가 없는 행이 있습니다.\n먼저 [🆔 person_id 일괄 생성]을 실행하세요.');
    return;
  }

  // person_id 기준 UPSERT (있으면 업데이트, 없으면 삽입)
  const headers = {
    'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal'
  };
  const url = SUPABASE_URL + '/rest/v1/talent_profiles?on_conflict=person_id';

  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const res = UrlFetchApp.fetch(url, {
      method: 'post', headers: headers, payload: JSON.stringify(rows.slice(i, i + BATCH_SIZE)), muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) { ui.alert('❌ 업로드 오류:\n' + res.getContentText()); return; }
  }
  ui.alert('✅ Supabase 동기화 완료\n시트: ' + sheetName + '\n총 ' + rows.length + '건 (upsert)');
}

function syncAllSheetsToSupabase() {
  const ui = SpreadsheetApp.getUi();
  const serviceKey = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!serviceKey) { ui.alert("⚠️ SUPABASE_SERVICE_KEY가 설정되지 않았습니다."); return; }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targets = ss.getSheets().filter(s => s.getName().startsWith("통합_") && !s.isSheetHidden());
  if (targets.length === 0) { ui.alert("통합_ 시트가 없습니다."); return; }

  const headers = {
    'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal'
  };
  const upsertUrl = SUPABASE_URL + '/rest/v1/talent_profiles?on_conflict=person_id';
  const results = [];

  for (const sheet of targets) {
    const sheetName = sheet.getName();
    const rows = _extractSheetForSupabase(sheet, sheetName);
    if (rows.length === 0) { results.push('⚠️ ' + sheetName + ': 데이터 없음'); continue; }

    const missingPid = rows.filter(r => !r.person_id).length;
    if (missingPid > 0) {
      results.push('⚠️ ' + sheetName + ': person_id 미생성 ' + missingPid + '건 — 건너뜀');
      continue;
    }

    let failed = false;
    for (let i = 0; i < rows.length; i += 500) {
      const res = UrlFetchApp.fetch(upsertUrl, {
        method: 'post', headers: headers, payload: JSON.stringify(rows.slice(i, i + 500)), muteHttpExceptions: true
      });
      if (res.getResponseCode() >= 300) {
        const errText = res.getContentText().slice(0, 200);
        results.push('❌ ' + sheetName + ' [' + res.getResponseCode() + '] ' + errText);
        failed = true; break;
      }
    }
    if (!failed) results.push('✅ ' + sheetName + ' — ' + rows.length + '건 (upsert)');
  }

  ui.alert('☁️ Supabase 일괄 동기화 완료\n\n' + results.join('\n'));
}

function _extractSheetForSupabase(sheet, sheetName) {
  const tMap = getColMap(sheet);
  const range = sheet.getDataRange();
  const values = range.getValues();
  const rts = range.getRichTextValues();
  const rows = [], now = new Date().toISOString();

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const name = (r[tMap["이름"]] || "").toString().trim();
    if (!name) continue;
    const tenureStr = (r[tMap["재직 기간"]] || "").toString().trim();
    const tsM = tenureStr.match(/(\d{4}\.\d{2})/);
    rows.push({
      person_id:    tMap["person_id"] !== undefined ? (r[tMap["person_id"]] || "").toString().trim() : "",
      source_sheet: sheetName,
      company:      (r[tMap["회사명"]]       || "").toString().trim(),
      name:         name,
      remember_url: _extractRichUrl(rts[i][tMap["리멤버 페이지"]]),
      linkedin_url: _extractRichUrl(rts[i][tMap["링크드인 페이지"]]),
      job_category: (r[tMap["대분류(직무)"]] || "").toString().trim(),
      team:         (r[tMap["팀"]]            || "").toString().trim(),
      role:         (r[tMap["직책"]]          || "").toString().trim(),
      total_career: (r[tMap["총 경력"]]       || "").toString().trim(),
      tenure:       tenureStr,
      tenure_start: tsM ? tsM[1] : "",
      prev_career:  (r[tMap["이전 경력"]]    || "").toString().trim(),
      education:    (r[tMap["학력"]]          || "").toString().trim(),
      region:       (r[tMap["Region"]]        || "").toString().trim(),
      synced_at:    now
    });
  }
  return rows;
}

function _extractRichUrl(rt) {
  if (!rt) return "";
  const main = rt.getLinkUrl(); if (main) return main;
  for (const run of rt.getRuns()) { const l = run.getLinkUrl(); if (l) return l; }
  return "";
}
