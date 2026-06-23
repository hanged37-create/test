const IDB_NAME = "healthLogDB";
const IDB_STORE = "sqlite";
const IDB_KEY = "dbfile";

const tabButtons = document.getElementById("tab-buttons");
const prevDayBtn = document.getElementById("prev-day-btn");
const nextDayBtn = document.getElementById("next-day-btn");
const dateLabel = document.getElementById("date-label");
const datePicker = document.getElementById("date-picker");
const todayBtn = document.getElementById("today-btn");
const logList = document.getElementById("log-list");
const dayTotal = document.getElementById("day-total");
const addForm = document.getElementById("add-form");
const entryInput = document.getElementById("entry-input");
const entrySuggestions = document.getElementById("entry-suggestions");
const backupBtn = document.getElementById("backup-btn");
const importBtn = document.getElementById("import-btn");
const importFileInput = document.getElementById("import-file-input");
const toast = document.getElementById("toast");
const calorieModal = document.getElementById("calorie-modal");
const calorieModalLabel = document.getElementById("calorie-modal-label");
const calorieModalInput = document.getElementById("calorie-modal-input");
const calorieModalSkip = document.getElementById("calorie-modal-skip");
const calorieModalSave = document.getElementById("calorie-modal-save");

const RECENT_DIET_KEY = "healthLogRecentDiet";
const RECENT_EXERCISE_KEY = "healthLogRecentExercise";
const MAX_RECENT = 5;

let toastTimer = null;
function showToast(message, duration = 3000) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

let db = null;
let logs = [];
let calorieMap = {};
let currentType = "diet";
let editingId = null;

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

let selectedDate = toDateKey(new Date());

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

async function persistDb() {
  const data = db.export();
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(data, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- SQLite 초기화 ---------- */
async function initDatabase() {
  const SQL = await initSqlJs({
    locateFile: (file) => `../vendor/${file}`,
  });

  const existing = await loadDbFile();
  if (existing) {
    db = new SQL.Database(existing);
    migrateSchema();
  } else {
    db = new SQL.Database();
    db.run(`
      CREATE TABLE logs (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        text TEXT NOT NULL,
        kcal REAL,
        createdAt TEXT NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE calorie_dict (
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        kcal REAL NOT NULL,
        PRIMARY KEY (type, text)
      );
    `);
    await persistDb();
  }

  loadCalorieDict();
  refreshLogsFromDb();
  render();
}

// 기존(칼로리 기능 추가 전)에 만들어진 DB라면 컬럼/테이블을 보강
function migrateSchema() {
  const cols = db.exec("PRAGMA table_info(logs)");
  const colNames = cols.length ? cols[0].values.map((row) => row[1]) : [];
  if (!colNames.includes("kcal")) {
    db.run("ALTER TABLE logs ADD COLUMN kcal REAL");
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS calorie_dict (
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      kcal REAL NOT NULL,
      PRIMARY KEY (type, text)
    );
  `);
  persistDb();
}

function dictKey(type, text) {
  return `${type}:::${text.trim().toLowerCase()}`;
}

function loadCalorieDict() {
  const result = db.exec("SELECT type, text, kcal FROM calorie_dict");
  calorieMap = {};
  if (result.length === 0) return;
  const { columns, values } = result[0];
  values.forEach((row) => {
    const obj = {};
    columns.forEach((col, i) => (obj[col] = row[i]));
    calorieMap[dictKey(obj.type, obj.text)] = obj.kcal;
  });
}

// undefined: 한 번도 입력된 적 없는 항목 / null: 입력 자체가 없었던 항목
function lookupCalorie(type, text) {
  return calorieMap[dictKey(type, text)];
}

function saveCalorie(type, text, kcal) {
  const normalized = text.trim().toLowerCase();
  db.run(`INSERT OR REPLACE INTO calorie_dict (type, text, kcal) VALUES (?, ?, ?)`, [
    type,
    normalized,
    kcal,
  ]);
  calorieMap[dictKey(type, text)] = kcal;
  persistDb();
}

/* ---------- 내장 사전 기반 칼로리 자동 추정(근사값) ---------- */
// 구체적인(긴) 키워드가 먼저 매칭되도록 길이순으로 정렬
const DIET_DICTIONARY = [
  ["들기름두부포케", 480],
  ["닭가슴살포케", 420],
  ["단호박치즈포케", 500],
  ["치즈계란베이글", 400],
  ["베이컨브리또", 450],
  ["배추쌀국수", 350],
  ["스트링치즈", 80],
  ["그릭요거트", 150],
  ["말차라떼", 150],
  ["단백질바", 200],
  ["팥빙수", 500],
  ["샤브샤브", 500],
  ["그래놀라", 200],
  ["치킨너겟", 50],
  ["베이글", 300],
  ["연두부", 80],
  ["반숙란", 70],
  ["초코렛", 50],
  ["초콜릿", 50],
  ["소세지", 100],
  ["소시지", 100],
  ["회식", 700],
  ["킷캣", 100],
  ["킷켓", 100],
  ["포케", 450],
  ["사탕", 20],
  ["토마토", 5],
  ["방토", 5],
  ["블랙커피", 5],
  ["커피", 5],
].sort((a, b) => b[0].length - a[0].length);

function estimateDietCalories(text) {
  const chunks = text
    .split(/\+/)
    .map((c) => c.trim())
    .filter(Boolean);
  let total = 0;
  let matchedAny = false;

  chunks.forEach((chunk) => {
    const entry = DIET_DICTIONARY.find(([keyword]) => chunk.includes(keyword));
    if (!entry) return;
    matchedAny = true;
    const qtyMatch = chunk.match(/(\d+)\s*(개|알|조각|장|줄|컵|잔|인분)/);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
    total += entry[1] * qty;
  });

  return matchedAny ? total : null;
}

function estimateExerciseCalories(text) {
  if (text.includes("계단")) {
    const floors = [...text.matchAll(/(\d+)\s*층/g)].map((m) =>
      parseInt(m[1], 10)
    );
    let count = 1;
    if (floors.length >= 2) {
      count =
        Math.abs(floors[floors.length - 1] - floors[0]) +
        (text.includes("지하") ? 1 : 0);
    }
    return Math.max(count, 1) * 7;
  }

  if (text.includes("런닝머신") || text.includes("트레드밀")) {
    const m = text.match(/(\d+)\s*분/);
    const minutes = m ? parseInt(m[1], 10) : 10;
    return minutes * 8;
  }

  const kgMatch = text.match(/(\d+)\s*kg/i);
  const repsMatch = text.match(/(\d+)\s*회/);
  if (kgMatch && repsMatch) {
    const weight = parseInt(kgMatch[1], 10);
    const reps = parseInt(repsMatch[1], 10);
    return Math.round(reps * 0.3 + weight * 0.25);
  }
  if (repsMatch) {
    return Math.round(parseInt(repsMatch[1], 10) * 0.4);
  }

  const minMatch = text.match(/(\d+)\s*분/);
  if (minMatch) {
    return parseInt(minMatch[1], 10) * 6;
  }

  return null;
}

function estimateCalorie(type, text) {
  return type === "diet"
    ? estimateDietCalories(text)
    : estimateExerciseCalories(text);
}

function insertLogRow(l) {
  db.run(
    `INSERT INTO logs (id, type, date, time, text, kcal, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [l.id, l.type, l.date, l.time, l.text, l.kcal ?? null, l.createdAt]
  );
}

function refreshLogsFromDb() {
  const result = db.exec(
    "SELECT id, type, date, time, text, kcal, createdAt FROM logs"
  );
  if (result.length === 0) {
    logs = [];
    return;
  }
  const { columns, values } = result[0];
  logs = values.map((row) => {
    const obj = {};
    columns.forEach((col, i) => (obj[col] = row[i]));
    return obj;
  });
}

function persistAndRender() {
  refreshLogsFromDb();
  persistDb();
  render();
}

function nowTimeStr() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
}

function addLog(text, kcal) {
  if (!db) return;
  insertLogRow({
    id: Date.now(),
    type: currentType,
    date: selectedDate,
    time: nowTimeStr(),
    text,
    kcal: kcal ?? null,
    createdAt: new Date().toISOString(),
  });
  persistAndRender();
}

function updateLog(id, text, kcal) {
  if (!db) return;
  const log = logs.find((l) => l.id === id);
  db.run("UPDATE logs SET text = ?, kcal = ? WHERE id = ?", [
    text,
    kcal ?? null,
    id,
  ]);
  if (kcal !== null && kcal !== undefined && log) {
    saveCalorie(log.type, text, kcal);
  }
  editingId = null;
  persistAndRender();
}

function deleteLog(id) {
  if (!db) return;
  db.run("DELETE FROM logs WHERE id = ?", [id]);
  persistAndRender();
}

/* ---------- 최근 입력값(자동완성) ---------- */
function recentKeyForType(type) {
  return type === "diet" ? RECENT_DIET_KEY : RECENT_EXERCISE_KEY;
}

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
}

function renderSuggestions() {
  const typed = entryInput.value.trim().toLowerCase();
  const recent = getRecentList(recentKeyForType(currentType));
  const matches = typed
    ? recent.filter((v) => v.toLowerCase().includes(typed))
    : recent;

  if (matches.length === 0) {
    entrySuggestions.hidden = true;
    return;
  }

  entrySuggestions.innerHTML = "";
  matches.forEach((value) => {
    const li = document.createElement("li");
    li.textContent = value;
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      entryInput.value = value;
      entrySuggestions.hidden = true;
    });
    entrySuggestions.appendChild(li);
  });
  entrySuggestions.hidden = false;
}

entryInput.addEventListener("focus", renderSuggestions);
entryInput.addEventListener("input", renderSuggestions);
entryInput.addEventListener("blur", () => {
  setTimeout(() => {
    entrySuggestions.hidden = true;
  }, 150);
});
entryInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") entrySuggestions.hidden = true;
});

/* ---------- 칼로리 입력 모달 ---------- */
function askCalorie(text) {
  return new Promise((resolve) => {
    calorieModalLabel.textContent = `"${text}" 칼로리(kcal)를 입력해주세요. (모르면 건너뛰기)`;
    calorieModalInput.value = "";
    calorieModal.hidden = false;
    calorieModalInput.focus();

    function cleanup(result) {
      calorieModal.hidden = true;
      calorieModalSave.removeEventListener("click", onSave);
      calorieModalSkip.removeEventListener("click", onSkip);
      calorieModalInput.removeEventListener("keydown", onKeydown);
      resolve(result);
    }
    function onSave() {
      const v = parseFloat(calorieModalInput.value);
      cleanup(Number.isFinite(v) && v >= 0 ? v : null);
    }
    function onSkip() {
      cleanup(null);
    }
    function onKeydown(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        onSave();
      }
    }
    calorieModalSave.addEventListener("click", onSave);
    calorieModalSkip.addEventListener("click", onSkip);
    calorieModalInput.addEventListener("keydown", onKeydown);
  });
}

const weekdayLabel = ["일", "월", "화", "수", "목", "금", "토"];

function formatDateLabel(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const isToday = dateKey === toDateKey(new Date());
  return `${y}년 ${m}월 ${d}일 (${weekdayLabel[date.getDay()]})${
    isToday ? " · 오늘" : ""
  }`;
}

function shiftSelectedDate(days) {
  const [y, m, d] = selectedDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  selectedDate = toDateKey(date);
  render();
}

function getVisibleLogs() {
  return logs
    .filter((l) => l.type === currentType && l.date === selectedDate)
    .sort((a, b) => a.id - b.id);
}

function buildEditForm(log) {
  const form = document.createElement("div");
  form.className = "log-edit-form";

  const input = document.createElement("input");
  input.type = "text";
  input.value = log.text;

  const kcalInput = document.createElement("input");
  kcalInput.type = "number";
  kcalInput.className = "log-edit-kcal";
  kcalInput.placeholder = "kcal";
  kcalInput.min = "0";
  kcalInput.value = log.kcal != null ? log.kcal : "";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = "저장";
  saveBtn.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) return;
    const kcalVal = kcalInput.value === "" ? null : parseFloat(kcalInput.value);
    updateLog(log.id, text, kcalVal);
  });

  form.appendChild(input);
  form.appendChild(kcalInput);
  form.appendChild(saveBtn);
  return form;
}

function render() {
  dateLabel.textContent = formatDateLabel(selectedDate);
  datePicker.value = selectedDate;
  todayBtn.hidden = selectedDate === toDateKey(new Date());

  const visible = getVisibleLogs();
  logList.innerHTML = "";

  if (visible.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent =
      currentType === "diet"
        ? "이 날 기록된 식단이 없습니다."
        : "이 날 기록된 운동이 없습니다.";
    logList.appendChild(empty);
    dayTotal.hidden = true;
    return;
  }

  visible.forEach((log) => {
    const li = document.createElement("li");
    li.className = `log-item ${log.type}`;

    if (log.id === editingId) {
      li.appendChild(buildEditForm(log));
      logList.appendChild(li);
      return;
    }

    const text = document.createElement("span");
    text.className = "log-text";
    text.textContent = log.text;
    li.appendChild(text);

    if (log.kcal != null) {
      const kcal = document.createElement("span");
      kcal.className = "log-kcal";
      kcal.textContent = `${Math.round(log.kcal).toLocaleString()}kcal`;
      li.appendChild(kcal);
    }

    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.textContent = "수정";
    editBtn.addEventListener("click", () => {
      editingId = log.id;
      render();
    });
    li.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", () => deleteLog(log.id));
    li.appendChild(deleteBtn);

    logList.appendChild(li);
  });

  const total = visible.reduce((sum, l) => sum + (l.kcal || 0), 0);
  dayTotal.hidden = false;
  dayTotal.textContent = `${
    currentType === "diet" ? "식단" : "운동"
  } 합계 ${Math.round(total).toLocaleString()} kcal`;
}

/* ---------- 백업 / 가져오기 ---------- */
function exportBackup() {
  if (logs.length === 0) {
    showToast("백업할 항목이 없습니다.");
    return;
  }
  const json = JSON.stringify(logs, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = toDateKey(new Date());
  a.href = url;
  a.download = `health-log-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`${logs.length}개 항목을 백업했습니다.`);
}

function importFromJSON(jsonText) {
  if (!db) return;
  let imported;
  try {
    imported = JSON.parse(jsonText);
  } catch {
    showToast("올바른 JSON 파일이 아닙니다.");
    return;
  }
  if (!Array.isArray(imported)) {
    showToast("올바른 백업 파일 형식이 아닙니다.");
    return;
  }

  imported.forEach((l) => {
    db.run(
      `INSERT OR REPLACE INTO logs (id, type, date, time, text, kcal, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [l.id, l.type, l.date, l.time, l.text, l.kcal ?? null, l.createdAt]
    );
    if (l.kcal != null) saveCalorie(l.type, l.text, l.kcal);
  });

  persistAndRender();
  showToast(`${imported.length}개 항목을 가져왔습니다.`);
}

/* ---------- 이벤트 ---------- */
tabButtons.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  currentType = btn.dataset.type;
  editingId = null;
  entrySuggestions.hidden = true;
  tabButtons
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  render();
});

prevDayBtn.addEventListener("click", () => shiftSelectedDate(-1));
nextDayBtn.addEventListener("click", () => shiftSelectedDate(1));

datePicker.addEventListener("change", () => {
  if (!datePicker.value) return;
  selectedDate = datePicker.value;
  render();
});

todayBtn.addEventListener("click", () => {
  selectedDate = toDateKey(new Date());
  render();
});

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = entryInput.value.trim();
  if (!text) return;
  entryInput.value = "";
  entrySuggestions.hidden = true;

  // 1) 이전에 직접 수정해서 기억된 값 > 2) 내장 사전 자동 추정 > 3) 직접 입력
  let kcal = lookupCalorie(currentType, text);
  let isEstimate = false;
  if (kcal === undefined) {
    kcal = estimateCalorie(currentType, text);
    if (kcal !== null) isEstimate = true;
  }
  if (kcal === null || kcal === undefined) {
    kcal = await askCalorie(text);
    if (kcal !== null) saveCalorie(currentType, text, kcal);
  }

  addLog(text, kcal ?? null);
  addToRecentList(recentKeyForType(currentType), text);
  if (isEstimate) {
    showToast(
      `자동 계산: 약 ${Math.round(kcal).toLocaleString()}kcal (틀리면 '수정'으로 고쳐주세요)`
    );
  }
  entryInput.focus();
});

backupBtn.addEventListener("click", exportBackup);
importBtn.addEventListener("click", () => importFileInput.click());
importFileInput.addEventListener("change", () => {
  const file = importFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importFromJSON(reader.result);
  reader.readAsText(file);
  importFileInput.value = "";
});

if (location.protocol === "file:") {
  document.querySelector(".app").insertAdjacentHTML(
    "afterbegin",
    `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:14px;margin:14px;font-size:0.85rem;color:#92400e;line-height:1.5;">
      이 위치(file://)에서는 SQLite 기능이 동작하지 않습니다. http://localhost:8000/health-log/ 로 열어서 사용해 주세요.
    </div>`
  );
} else {
  initDatabase();
}
