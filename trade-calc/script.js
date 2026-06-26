const IDB_NAME = "tradeCalcDB";
const IDB_STORE = "sqlite";
const IDB_KEY = "dbfile";

const tbody = document.getElementById("trade-tbody");
const totalKrwEl = document.getElementById("total-krw");
const toastEl = document.getElementById("toast");
const statusMsgEl = document.getElementById("status-msg");

let db = null;
let rows = [];
let nextId = 1;
let currencyList = [];
let currencyMap = {};

/* ---------- 알림 ---------- */
let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 3500);
}

let statusTimer = null;
function showStatus(message, isError = false) {
  statusMsgEl.textContent = message;
  statusMsgEl.style.color = isError ? "#b91c1c" : "#6b7280";
  statusMsgEl.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusMsgEl.hidden = true;
  }, 4000);
}

/* ---------- 최근 입력값(거래처명 자동완성) ---------- */
const RECENT_COUNTERPARTIES_KEY = "recentCounterparties";
const MAX_RECENT = 8;

function getRecentList(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

function addToRecentList(key, value) {
  if (!value) return;
  let list = getRecentList(key).filter((v) => v !== value);
  list.unshift(value);
  list = list.slice(0, MAX_RECENT);
  localStorage.setItem(key, JSON.stringify(list));
  renderCounterpartyDatalist();
}

function renderCounterpartyDatalist() {
  const datalist = document.getElementById("counterparty-list");
  if (!datalist) return;
  datalist.innerHTML = getRecentList(RECENT_COUNTERPARTIES_KEY)
    .map((v) => `<option value="${v}"></option>`)
    .join("");
}

/* ---------- 숫자 표시 ---------- */
function formatNumber(n) {
  if (n === null || n === undefined || n === "" || isNaN(n)) return "";
  return Number(n).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

/* ---------- 통화 목록 ---------- */
async function loadCurrencies() {
  const res = await fetch("/api/currencies");
  currencyList = await res.json();
  currencyMap = {};
  currencyList.forEach((c) => {
    currencyMap[c.code] = c;
  });
}

/* ---------- IndexedDB: sql.js가 만든 SQLite 파일(바이너리)을 저장/로드 ---------- */
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadDbFile() {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function persistDbNow() {
  const data = db.export();
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(data, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let persistTimer = null;
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistDbNow, 600);
}

/* ---------- SQLite 초기화 ---------- */
async function initDatabase() {
  const SQL = await initSqlJs({
    locateFile: (file) => `vendor/${file}`,
  });

  const existing = await loadDbFile();
  if (existing) {
    db = new SQL.Database(existing);
  } else {
    db = new SQL.Database();
    db.run(`
      CREATE TABLE trade_rows (
        id INTEGER PRIMARY KEY,
        doc_type TEXT,
        ti_date TEXT,
        clearance_date TEXT,
        currency TEXT,
        foreign_amount REAL,
        exchange_rate REAL,
        rate_is_fallback INTEGER DEFAULT 0,
        matched_date TEXT,
        customs_duty REAL,
        vat_amount REAL,
        tax_invoice_date TEXT,
        counterparty_name TEXT,
        counterparty_code TEXT,
        declaration_filename TEXT
      );
    `);
    await persistDbNow();
  }

  refreshRowsFromDb();
}

function refreshRowsFromDb() {
  const res = db.exec(`
    SELECT id, doc_type as docType, ti_date as tiDate, clearance_date as clearanceDate,
           currency, foreign_amount as foreignAmount, exchange_rate as exchangeRate,
           rate_is_fallback as rateIsFallback, matched_date as matchedDate,
           customs_duty as customsDuty, vat_amount as vatAmount, tax_invoice_date as taxInvoiceDate,
           counterparty_name as counterpartyName, counterparty_code as counterpartyCode,
           declaration_filename as declarationFilename
    FROM trade_rows ORDER BY id
  `);
  rows = [];
  if (res.length) {
    const columns = res[0].columns;
    res[0].values.forEach((vals) => {
      const obj = {};
      columns.forEach((col, i) => {
        obj[col] = vals[i];
      });
      obj.rateIsFallback = !!obj.rateIsFallback;
      computeRow(obj);
      rows.push(obj);
    });
  }
  nextId = rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
}

function newId() {
  return nextId++;
}

function insertRowToDb(row) {
  db.run(
    `INSERT INTO trade_rows
      (id, doc_type, ti_date, clearance_date, currency, foreign_amount, exchange_rate, rate_is_fallback, matched_date, customs_duty, vat_amount, tax_invoice_date, counterparty_name, counterparty_code, declaration_filename)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.docType,
      row.tiDate,
      row.clearanceDate,
      row.currency,
      row.foreignAmount,
      row.exchangeRate,
      row.rateIsFallback ? 1 : 0,
      row.matchedDate,
      row.customsDuty,
      row.vatAmount,
      row.taxInvoiceDate,
      row.counterpartyName,
      row.counterpartyCode,
      row.declarationFilename,
    ]
  );
  schedulePersist();
}

function updateRowInDb(row) {
  db.run(
    `UPDATE trade_rows SET
      doc_type=?, ti_date=?, clearance_date=?, currency=?, foreign_amount=?, exchange_rate=?,
      rate_is_fallback=?, matched_date=?, customs_duty=?, vat_amount=?, tax_invoice_date=?, counterparty_name=?, counterparty_code=?, declaration_filename=?
     WHERE id=?`,
    [
      row.docType,
      row.tiDate,
      row.clearanceDate,
      row.currency,
      row.foreignAmount,
      row.exchangeRate,
      row.rateIsFallback ? 1 : 0,
      row.matchedDate,
      row.customsDuty,
      row.vatAmount,
      row.taxInvoiceDate,
      row.counterpartyName,
      row.counterpartyCode,
      row.declarationFilename,
      row.id,
    ]
  );
  schedulePersist();
}

function deleteRowFromDb(id) {
  db.run(`DELETE FROM trade_rows WHERE id = ?`, [id]);
  schedulePersist();
}

function clearAllRowsFromDb() {
  db.run(`DELETE FROM trade_rows`);
  schedulePersist();
}

/* ---------- 계산 로직 ---------- */
function computeRow(row) {
  const amount = row.foreignAmount;
  const rate = row.exchangeRate;
  const duty = row.customsDuty || 0;
  const meta = row.currency ? currencyMap[row.currency] : null;
  const divisor = meta && meta.per100 ? 100 : 1;

  if (
    amount !== null &&
    amount !== undefined &&
    !isNaN(amount) &&
    rate !== null &&
    rate !== undefined &&
    !isNaN(rate)
  ) {
    row.krwAmount = (amount * rate) / divisor;
    row.totalKrw = row.krwAmount + duty;
    const symbol = row.currency === "USD" ? "$" : row.currency ? `${row.currency} ` : "";
    let note = `${symbol}${formatNumber(amount)} * ${formatNumber(rate)}`;
    if (duty) note += ` + 관세 ${formatNumber(duty)}`;
    row.note = note;
  } else {
    row.krwAmount = null;
    row.totalKrw = null;
    row.note = "";
  }
}

// 행 순서대로 통화 종류(수출/수입/미확인)별 번호를 다시 매긴다
function buildLabels(list) {
  const counters = {};
  return list.map((row) => {
    const key = row.docType || "unknown";
    counters[key] = (counters[key] || 0) + 1;
    const prefix = row.docType === "export" ? "수출" : row.docType === "import" ? "수입" : "건";
    return `${prefix}${counters[key]}`;
  });
}

/* ---------- 행 추가/삭제 ---------- */
function addRow(initial = {}) {
  const row = {
    id: newId(),
    docType: initial.docType || null,
    tiDate: initial.tiDate || null,
    clearanceDate: initial.clearanceDate || null,
    currency: initial.currency || null,
    foreignAmount: initial.foreignAmount ?? null,
    exchangeRate: initial.exchangeRate ?? null,
    rateIsFallback: false,
    matchedDate: null,
    customsDuty: initial.customsDuty ?? null,
    vatAmount: initial.vatAmount ?? null,
    taxInvoiceDate: initial.taxInvoiceDate || null,
    counterpartyName: initial.counterpartyName || null,
    counterpartyCode: initial.counterpartyCode || null,
    declarationFilename: null,
  };
  computeRow(row);
  rows.push(row);
  insertRowToDb(row);
  return row;
}

/* ---------- 환율 조회 ---------- */
async function fetchRateForRow(row, tr, statusEl) {
  if (!row.currency || !row.clearanceDate) return;
  if (statusEl) statusEl.textContent = "환율 조회 중...";
  try {
    const res = await fetch("/api/exchange-rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency: row.currency, date: row.clearanceDate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "환율 조회에 실패했습니다.");

    row.exchangeRate = data.rate;
    row.rateIsFallback = data.isFallback;
    row.matchedDate = data.matchedDate;

    const rateInput = tr.querySelector(".cell-rate");
    if (rateInput) rateInput.value = data.rate;
    const noteEl = tr.querySelector(".rate-note");
    if (noteEl) {
      noteEl.textContent = data.isFallback ? `${data.matchedDate} 기준(휴일 대체)` : "";
    }

    recalcAndPaintRow(row, tr);
    updateRowInDb(row);
    if (statusEl) statusEl.textContent = "";
  } catch (err) {
    if (statusEl) statusEl.textContent = "";
    showToast(err.message);
  }
}

/* ---------- 신고필증/세금계산서 OCR 업로드 (여러 파일 동시 가능) ---------- */
async function handleDeclarationUpload(files, row, ocrStatusEl) {
  if (ocrStatusEl) ocrStatusEl.textContent = "인식 중...";
  const formData = new FormData();
  Array.from(files).forEach((f) => formData.append("files", f));
  try {
    const res = await fetch("/api/ocr-declaration", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "문서 인식에 실패했습니다.");

    row.declarationFilename = Array.from(files)
      .map((f) => f.name)
      .join(", ");
    if (data.documentType) row.docType = data.documentType;
    if (data.currency) row.currency = data.currency;
    if (data.foreignAmount !== null && data.foreignAmount !== undefined) {
      row.foreignAmount = data.foreignAmount;
    }
    if (data.customsDuty !== null && data.customsDuty !== undefined) {
      row.customsDuty = data.customsDuty;
    }
    if (data.clearanceDate) row.clearanceDate = data.clearanceDate;
    if (data.vatAmount !== null && data.vatAmount !== undefined) {
      row.vatAmount = data.vatAmount;
    }
    if (data.taxInvoiceDate) row.taxInvoiceDate = data.taxInvoiceDate;
    computeRow(row);
    updateRowInDb(row);
    renderTable();
    showToast("문서 인식 완료 — 값을 확인해주세요.");

    const newTr = tbody.querySelector(`tr[data-id="${row.id}"]`);
    if (newTr) {
      await fetchRateForRow(row, newTr, newTr.querySelector(".ocr-status"));
    }
  } catch (err) {
    if (ocrStatusEl) ocrStatusEl.textContent = "";
    showToast(err.message);
  }
}

/* ---------- 화면 렌더링 ---------- */
function recalcAndPaintRow(row, tr) {
  computeRow(row);
  tr.querySelector(".cell-krw").value = formatNumber(row.krwAmount);
  tr.querySelector(".cell-total").value = formatNumber(row.totalKrw);
  tr.querySelector(".cell-note-text").value = row.note || "";
  updateTotalFooter();
}

function updateTotalFooter() {
  const total = rows.reduce((sum, r) => sum + (r.totalKrw || 0), 0);
  totalKrwEl.textContent = formatNumber(total);
}

function buildRowElement(row, label) {
  const tr = document.createElement("tr");
  tr.dataset.id = row.id;

  const currencyOptions = currencyList
    .map(
      (c) =>
        `<option value="${c.code}" ${c.code === row.currency ? "selected" : ""}>${c.code} - ${c.name}${
          c.per100 ? " (100)" : ""
        }</option>`
    )
    .join("");

  tr.innerHTML = `
    <td class="label-cell">${label}</td>
    <td><input type="date" class="cell-ti" value="${row.tiDate || ""}" /></td>
    <td><input type="date" class="cell-clearance" value="${row.clearanceDate || ""}" /></td>
    <td><input type="text" class="cell-tax-invoice-date" value="${row.taxInvoiceDate || ""}" readonly /></td>
    <td>
      <div class="declaration-cell">
        <label class="btn-file-sm">업로드<input type="file" class="cell-file" accept=".pdf,.png,.jpg,.jpeg" multiple hidden /></label>
        <span class="file-name">${row.declarationFilename || ""}</span>
        <span class="ocr-status"></span>
      </div>
    </td>
    <td>
      <select class="cell-currency">
        <option value="">-</option>
        ${currencyOptions}
      </select>
    </td>
    <td><input type="number" step="0.01" class="cell-amount" value="${row.foreignAmount ?? ""}" /></td>
    <td>
      <input type="number" step="0.01" class="cell-rate" value="${row.exchangeRate ?? ""}" />
      <span class="rate-note">${row.rateIsFallback ? `${row.matchedDate} 기준(휴일 대체)` : ""}</span>
    </td>
    <td><input type="text" class="cell-krw" value="${formatNumber(row.krwAmount)}" readonly /></td>
    <td><input type="number" step="1" class="cell-duty" value="${row.customsDuty ?? ""}" /></td>
    <td><input type="number" step="1" class="cell-vat" value="${row.vatAmount ?? ""}" /></td>
    <td><input type="text" class="cell-total" value="${formatNumber(row.totalKrw)}" readonly /></td>
    <td><input type="text" class="cell-counterparty-name" list="counterparty-list" value="${row.counterpartyName || ""}" /></td>
    <td><input type="text" class="cell-counterparty-code" value="${row.counterpartyCode || ""}" /></td>
    <td><input type="text" class="cell-note-text" value="${row.note || ""}" readonly /></td>
    <td><button type="button" class="row-delete-btn" title="삭제">✕</button></td>
  `;

  wireRowEvents(tr, row);
  return tr;
}

function wireRowEvents(tr, row) {
  const tiInput = tr.querySelector(".cell-ti");
  const clearanceInput = tr.querySelector(".cell-clearance");
  const fileInput = tr.querySelector(".cell-file");
  const currencySelect = tr.querySelector(".cell-currency");
  const amountInput = tr.querySelector(".cell-amount");
  const rateInput = tr.querySelector(".cell-rate");
  const dutyInput = tr.querySelector(".cell-duty");
  const vatInput = tr.querySelector(".cell-vat");
  const counterpartyNameInput = tr.querySelector(".cell-counterparty-name");
  const counterpartyCodeInput = tr.querySelector(".cell-counterparty-code");
  const deleteBtn = tr.querySelector(".row-delete-btn");
  const ocrStatus = tr.querySelector(".ocr-status");

  tiInput.addEventListener("change", () => {
    row.tiDate = tiInput.value || null;
    updateRowInDb(row);
  });

  clearanceInput.addEventListener("change", () => {
    row.clearanceDate = clearanceInput.value || null;
    updateRowInDb(row);
    fetchRateForRow(row, tr, ocrStatus);
  });

  currencySelect.addEventListener("change", () => {
    row.currency = currencySelect.value || null;
    recalcAndPaintRow(row, tr);
    updateRowInDb(row);
    fetchRateForRow(row, tr, ocrStatus);
  });

  amountInput.addEventListener("input", () => {
    row.foreignAmount = amountInput.value === "" ? null : parseFloat(amountInput.value);
    recalcAndPaintRow(row, tr);
    updateRowInDb(row);
  });

  rateInput.addEventListener("input", () => {
    row.exchangeRate = rateInput.value === "" ? null : parseFloat(rateInput.value);
    row.rateIsFallback = false;
    row.matchedDate = null;
    const noteEl = tr.querySelector(".rate-note");
    if (noteEl) noteEl.textContent = "";
    recalcAndPaintRow(row, tr);
    updateRowInDb(row);
  });

  dutyInput.addEventListener("input", () => {
    row.customsDuty = dutyInput.value === "" ? null : parseFloat(dutyInput.value);
    recalcAndPaintRow(row, tr);
    updateRowInDb(row);
  });

  vatInput.addEventListener("input", () => {
    row.vatAmount = vatInput.value === "" ? null : parseFloat(vatInput.value);
    updateRowInDb(row);
  });

  counterpartyNameInput.addEventListener("change", () => {
    row.counterpartyName = counterpartyNameInput.value || null;
    addToRecentList(RECENT_COUNTERPARTIES_KEY, row.counterpartyName);
    updateRowInDb(row);
  });

  counterpartyCodeInput.addEventListener("change", () => {
    row.counterpartyCode = counterpartyCodeInput.value || null;
    updateRowInDb(row);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) handleDeclarationUpload(fileInput.files, row, ocrStatus);
  });

  deleteBtn.addEventListener("click", () => {
    rows = rows.filter((r) => r.id !== row.id);
    deleteRowFromDb(row.id);
    renderTable();
  });
}

function renderTable() {
  tbody.innerHTML = "";
  const labels = buildLabels(rows);
  rows.forEach((row, i) => {
    tbody.appendChild(buildRowElement(row, labels[i]));
  });
  updateTotalFooter();
}

/* ---------- 엑셀 가져오기/내보내기 ---------- */
async function handleExcelImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  showStatus("엑셀 분석 중...");
  try {
    const res = await fetch("/api/parse-excel", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "엑셀 분석에 실패했습니다.");

    data.rows.forEach((r) => addRow({ tiDate: r.tiDate, clearanceDate: r.clearanceDate }));
    renderTable();
    showStatus(`${data.rows.length}건을 가져왔습니다.`);
    showToast(`${data.rows.length}건을 가져왔습니다.`);
  } catch (err) {
    showStatus(err.message, true);
    showToast(err.message);
  } finally {
    e.target.value = "";
  }
}

async function handleExport() {
  if (rows.length === 0) {
    showToast("내보낼 데이터가 없습니다.");
    return;
  }
  const labels = buildLabels(rows);
  const payload = rows.map((row, i) => ({
    label: labels[i],
    tiDate: row.tiDate || "",
    clearanceDate: row.clearanceDate || "",
    exchangeRate: row.exchangeRate ?? "",
    foreignAmount: row.foreignAmount ?? "",
    krwAmount: row.krwAmount !== null ? Math.round(row.krwAmount) : "",
    customsDuty: row.customsDuty ?? "",
    totalKrw: row.totalKrw !== null ? Math.round(row.totalKrw) : "",
    note: row.note || "",
  }));

  try {
    const res = await fetch("/api/export-excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: payload }),
    });
    if (!res.ok) throw new Error("엑셀 내보내기에 실패했습니다.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `수출입계산_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message);
  }
}

async function handleExportJournal() {
  if (rows.length === 0) {
    showToast("내보낼 데이터가 없습니다.");
    return;
  }
  const payload = rows.map((row) => ({
    docType: row.docType,
    tiDate: row.tiDate || "",
    totalKrw: row.totalKrw,
    counterpartyName: row.counterpartyName || "",
    counterpartyCode: row.counterpartyCode || "",
    note: row.note || "",
  }));

  try {
    const res = await fetch("/api/export-journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: payload }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "일반전표 내보내기에 실패했습니다.");
    }
    const skipped = Number(res.headers.get("X-Skipped-Export-Count") || 0);
    const written = Number(res.headers.get("X-Written-Count") || 0);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `일반전표_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(skipped > 0 ? `수입 ${written}건 내보냄 (수출 ${skipped}건은 제외됨)` : `수입 ${written}건 내보냄`);
  } catch (err) {
    showToast(err.message);
  }
}

/* ---------- 초기화 ---------- */
function bindToolbarEvents() {
  document.getElementById("add-row-btn").addEventListener("click", () => {
    addRow();
    renderTable();
  });

  document.getElementById("clear-btn").addEventListener("click", () => {
    if (rows.length === 0) return;
    if (!confirm("모든 행을 삭제하시겠습니까?")) return;
    rows = [];
    clearAllRowsFromDb();
    renderTable();
  });

  document.getElementById("excel-input").addEventListener("change", handleExcelImport);
  document.getElementById("export-btn").addEventListener("click", handleExport);
  document.getElementById("export-journal-btn").addEventListener("click", handleExportJournal);
}

async function init() {
  await loadCurrencies();
  await initDatabase();
  renderCounterpartyDatalist();
  bindToolbarEvents();
  renderTable();
}

document.addEventListener("DOMContentLoaded", init);
