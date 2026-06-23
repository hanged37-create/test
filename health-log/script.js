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
const calorieModalMacros = document.getElementById("calorie-modal-macros");
const calorieModalCarb = document.getElementById("calorie-modal-carb");
const calorieModalProtein = document.getElementById("calorie-modal-protein");
const calorieModalFat = document.getElementById("calorie-modal-fat");
const calorieModalSkip = document.getElementById("calorie-modal-skip");
const calorieModalSave = document.getElementById("calorie-modal-save");

const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const settingsBmrInput = document.getElementById("settings-bmr-input");
const settingsAgeInput = document.getElementById("settings-age-input");
const settingsModalCancel = document.getElementById("settings-modal-cancel");
const settingsModalSave = document.getElementById("settings-modal-save");

const RECENT_DIET_KEY = "healthLogRecentDiet";
const RECENT_EXERCISE_KEY = "healthLogRecentExercise";
const MAX_RECENT = 5;
const BMR_KEY = "healthLogBMR";
const AGE_KEY = "healthLogAge";

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
        carb REAL,
        protein REAL,
        fat REAL,
        createdAt TEXT NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE calorie_dict (
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        kcal REAL NOT NULL,
        carb REAL,
        protein REAL,
        fat REAL,
        PRIMARY KEY (type, text)
      );
    `);
    await persistDb();
  }

  loadCalorieDict();
  refreshLogsFromDb();
  render();
}

// 기존 DB라면 누락된 컬럼/테이블을 보강
function migrateSchema() {
  const cols = db.exec("PRAGMA table_info(logs)");
  const colNames = cols.length ? cols[0].values.map((row) => row[1]) : [];
  if (!colNames.includes("kcal")) {
    db.run("ALTER TABLE logs ADD COLUMN kcal REAL");
  }
  ["carb", "protein", "fat"].forEach((col) => {
    if (!colNames.includes(col)) {
      db.run(`ALTER TABLE logs ADD COLUMN ${col} REAL`);
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS calorie_dict (
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      kcal REAL NOT NULL,
      carb REAL,
      protein REAL,
      fat REAL,
      PRIMARY KEY (type, text)
    );
  `);
  const dictCols = db.exec("PRAGMA table_info(calorie_dict)");
  const dictColNames = dictCols.length
    ? dictCols[0].values.map((row) => row[1])
    : [];
  ["carb", "protein", "fat"].forEach((col) => {
    if (!dictColNames.includes(col)) {
      db.run(`ALTER TABLE calorie_dict ADD COLUMN ${col} REAL`);
    }
  });
  persistDb();
}

function dictKey(type, text) {
  return `${type}:::${text.trim().toLowerCase()}`;
}

function loadCalorieDict() {
  const result = db.exec("SELECT type, text, kcal, carb, protein, fat FROM calorie_dict");
  calorieMap = {};
  if (result.length === 0) return;
  const { columns, values } = result[0];
  values.forEach((row) => {
    const obj = {};
    columns.forEach((col, i) => (obj[col] = row[i]));
    calorieMap[dictKey(obj.type, obj.text)] = {
      kcal: obj.kcal,
      carb: obj.carb,
      protein: obj.protein,
      fat: obj.fat,
    };
  });
}

// undefined: 한 번도 입력된 적 없는 항목 / null: 입력 자체가 없었던 항목
function lookupNutrition(type, text) {
  return calorieMap[dictKey(type, text)];
}

function saveNutrition(type, text, nutrition) {
  const normalized = text.trim().toLowerCase();
  db.run(
    `INSERT OR REPLACE INTO calorie_dict (type, text, kcal, carb, protein, fat) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      type,
      normalized,
      nutrition.kcal,
      nutrition.carb ?? null,
      nutrition.protein ?? null,
      nutrition.fat ?? null,
    ]
  );
  calorieMap[dictKey(type, text)] = nutrition;
  persistDb();
}

/* ---------- 내장 사전 기반 칼로리·영양소 자동 추정(근사값) ---------- */
// [키워드, kcal, 탄수화물g, 단백질g, 지방g] / 구체적인(긴) 키워드가 먼저 매칭되도록 길이순 정렬
const DIET_DICTIONARY = [
  ["들기름두부포케", 480, 45, 25, 20],
  ["닭가슴살포케", 420, 40, 35, 12],
  ["단호박치즈포케", 500, 55, 20, 20],
  ["치즈계란베이글", 400, 45, 18, 15],
  ["베이컨브리또", 450, 40, 18, 22],
  ["배추쌀국수", 350, 55, 15, 8],
  ["스트링치즈", 80, 1, 7, 6],
  ["그릭요거트", 150, 9, 15, 5],
  ["말차라떼", 150, 22, 5, 4],
  ["단백질바", 200, 18, 20, 7],
  ["팥빙수", 500, 95, 10, 8],
  ["샤브샤브", 500, 20, 40, 25],
  ["그래놀라", 200, 30, 5, 7],
  ["치킨너겟", 50, 3, 3, 3],
  ["베이글", 300, 58, 11, 2],
  ["연두부", 80, 3, 8, 4],
  ["반숙란", 70, 0.5, 6, 5],
  ["초코렛", 50, 6, 1, 3],
  ["초콜릿", 50, 6, 1, 3],
  ["소세지", 100, 1, 6, 8],
  ["소시지", 100, 1, 6, 8],
  ["회식", 700, 60, 35, 35],
  ["킷캣", 100, 12, 1, 5],
  ["킷켓", 100, 12, 1, 5],
  ["포케", 450, 45, 25, 18],
  ["사탕", 20, 5, 0, 0],
  ["토마토", 5, 1, 0.2, 0],
  ["방토", 5, 1, 0.2, 0],
  ["블랙커피", 5, 0, 0.3, 0],
  ["커피", 5, 0, 0.3, 0],
].sort((a, b) => b[0].length - a[0].length);

function estimateDietNutrition(text) {
  const chunks = text
    .split(/\+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const total = { kcal: 0, carb: 0, protein: 0, fat: 0 };
  let matchedAny = false;

  chunks.forEach((chunk) => {
    const entry = DIET_DICTIONARY.find(([keyword]) => chunk.includes(keyword));
    if (!entry) return;
    matchedAny = true;
    const [, kcal, carb, protein, fat] = entry;
    const qtyMatch = chunk.match(/(\d+)\s*(개|알|조각|장|줄|컵|잔|인분)/);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
    total.kcal += kcal * qty;
    total.carb += carb * qty;
    total.protein += protein * qty;
    total.fat += fat * qty;
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

// 운동은 영양소가 없으므로 kcal만 있는 형태로 통일해서 반환
function estimateNutrition(type, text) {
  if (type === "diet") return estimateDietNutrition(text);
  const kcal = estimateExerciseCalories(text);
  return kcal === null ? null : { kcal, carb: null, protein: null, fat: null };
}

function insertLogRow(l) {
  db.run(
    `INSERT INTO logs (id, type, date, time, text, kcal, carb, protein, fat, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      l.id,
      l.type,
      l.date,
      l.time,
      l.text,
      l.kcal ?? null,
      l.carb ?? null,
      l.protein ?? null,
      l.fat ?? null,
      l.createdAt,
    ]
  );
}

function refreshLogsFromDb() {
  const result = db.exec(
    "SELECT id, type, date, time, text, kcal, carb, protein, fat, createdAt FROM logs"
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

function addLog(text, nutrition) {
  if (!db) return;
  const n = nutrition || {};
  insertLogRow({
    id: Date.now(),
    type: currentType,
    date: selectedDate,
    time: nowTimeStr(),
    text,
    kcal: n.kcal ?? null,
    carb: n.carb ?? null,
    protein: n.protein ?? null,
    fat: n.fat ?? null,
    createdAt: new Date().toISOString(),
  });
  persistAndRender();
}

function updateLog(id, text, nutrition) {
  if (!db) return;
  const log = logs.find((l) => l.id === id);
  const n = nutrition || {};
  db.run("UPDATE logs SET text = ?, kcal = ?, carb = ?, protein = ?, fat = ? WHERE id = ?", [
    text,
    n.kcal ?? null,
    n.carb ?? null,
    n.protein ?? null,
    n.fat ?? null,
    id,
  ]);
  if (n.kcal !== null && n.kcal !== undefined && log) {
    saveNutrition(log.type, text, n);
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

/* ---------- 칼로리·영양소 입력 모달 ---------- */
function positiveOrNull(value) {
  const v = parseFloat(value);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

function askNutrition(text, type) {
  return new Promise((resolve) => {
    calorieModalLabel.textContent = `"${text}" 칼로리(kcal)를 입력해주세요. (모르면 건너뛰기)`;
    calorieModalInput.value = "";
    calorieModalCarb.value = "";
    calorieModalProtein.value = "";
    calorieModalFat.value = "";
    calorieModalMacros.hidden = type !== "diet";
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
      const kcal = positiveOrNull(calorieModalInput.value);
      if (kcal === null) {
        cleanup(null);
        return;
      }
      cleanup({
        kcal,
        carb: type === "diet" ? positiveOrNull(calorieModalCarb.value) : null,
        protein:
          type === "diet" ? positiveOrNull(calorieModalProtein.value) : null,
        fat: type === "diet" ? positiveOrNull(calorieModalFat.value) : null,
      });
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

/* ---------- 기초대사량/나이 설정 ---------- */
function getSettings() {
  const bmr = parseFloat(localStorage.getItem(BMR_KEY));
  const age = parseFloat(localStorage.getItem(AGE_KEY));
  return {
    bmr: Number.isFinite(bmr) ? bmr : null,
    age: Number.isFinite(age) ? age : null,
  };
}

function saveSettings(bmr, age) {
  if (bmr === null) localStorage.removeItem(BMR_KEY);
  else localStorage.setItem(BMR_KEY, String(bmr));
  if (age === null) localStorage.removeItem(AGE_KEY);
  else localStorage.setItem(AGE_KEY, String(age));
}

settingsBtn.addEventListener("click", () => {
  const { bmr, age } = getSettings();
  settingsBmrInput.value = bmr ?? "";
  settingsAgeInput.value = age ?? "";
  settingsModal.hidden = false;
});

settingsModalCancel.addEventListener("click", () => {
  settingsModal.hidden = true;
});

settingsModalSave.addEventListener("click", () => {
  saveSettings(
    positiveOrNull(settingsBmrInput.value),
    positiveOrNull(settingsAgeInput.value)
  );
  settingsModal.hidden = true;
  render();
});

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

  const row1 = document.createElement("div");
  row1.className = "log-edit-row";

  const input = document.createElement("input");
  input.type = "text";
  input.value = log.text;

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = "저장";

  row1.appendChild(input);
  row1.appendChild(saveBtn);

  const row2 = document.createElement("div");
  row2.className = "log-edit-row";

  const kcalInput = document.createElement("input");
  kcalInput.type = "number";
  kcalInput.className = "log-edit-kcal";
  kcalInput.placeholder = "kcal";
  kcalInput.min = "0";
  kcalInput.value = log.kcal != null ? log.kcal : "";
  row2.appendChild(kcalInput);

  const macroInputs = ["carb", "protein", "fat"].map((field, i) => {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.className = "log-edit-kcal";
    inp.placeholder = ["탄(g)", "단(g)", "지(g)"][i];
    inp.min = "0";
    inp.value = log[field] != null ? log[field] : "";
    if (log.type === "diet") row2.appendChild(inp);
    return inp;
  });

  saveBtn.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) return;
    const kcalVal = kcalInput.value === "" ? null : parseFloat(kcalInput.value);
    const nutrition = { kcal: kcalVal };
    if (log.type === "diet") {
      ["carb", "protein", "fat"].forEach((field, i) => {
        nutrition[field] =
          macroInputs[i].value === "" ? null : parseFloat(macroInputs[i].value);
      });
    }
    updateLog(log.id, text, nutrition);
  });

  form.appendChild(row1);
  form.appendChild(row2);
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

  const total = visible.reduce(
    (acc, l) => {
      acc.kcal += l.kcal || 0;
      acc.carb += l.carb || 0;
      acc.protein += l.protein || 0;
      acc.fat += l.fat || 0;
      return acc;
    },
    { kcal: 0, carb: 0, protein: 0, fat: 0 }
  );

  dayTotal.hidden = false;
  dayTotal.innerHTML = "";

  const kcalLine = document.createElement("div");
  kcalLine.className = "day-total-kcal";
  kcalLine.textContent = `${
    currentType === "diet" ? "식단" : "운동"
  } 합계 ${Math.round(total.kcal).toLocaleString()} kcal`;
  dayTotal.appendChild(kcalLine);

  if (currentType === "diet") {
    const macroLine = document.createElement("div");
    macroLine.className = "day-total-macros";
    macroLine.textContent = `탄 ${Math.round(total.carb)}g · 단 ${Math.round(
      total.protein
    )}g · 지 ${Math.round(total.fat)}g`;
    dayTotal.appendChild(macroLine);

    const advice = computeDietAdvice(selectedDate, total);
    const adviceLine = document.createElement("div");
    adviceLine.className = `day-total-advice${advice && advice.ok ? " ok" : ""}`;
    adviceLine.textContent = advice
      ? advice.message
      : "⚙ 설정에서 기초대사량을 입력하면 부족한 영양소를 알려드려요.";
    dayTotal.appendChild(adviceLine);
  }
}

// 기초대사량(+그날 운동 소모량) 대비 식단 섭취량을 비교해 가장 부족한 영양소를 안내
function computeDietAdvice(dateKey, intake) {
  const { bmr, age } = getSettings();
  if (!bmr) return null;

  const exerciseKcal = logs
    .filter((l) => l.type === "exercise" && l.date === dateKey)
    .reduce((sum, l) => sum + (l.kcal || 0), 0);

  const budget = bmr + exerciseKcal;
  const proteinRatio = age != null && age >= 50 ? 0.25 : 0.2;
  const fatRatio = 0.3;
  const carbRatio = 1 - proteinRatio - fatRatio;

  const targets = {
    carb: (budget * carbRatio) / 4,
    protein: (budget * proteinRatio) / 4,
    fat: (budget * fatRatio) / 9,
  };

  const pct = {
    carb: targets.carb > 0 ? intake.carb / targets.carb : 1,
    protein: targets.protein > 0 ? intake.protein / targets.protein : 1,
    fat: targets.fat > 0 ? intake.fat / targets.fat : 1,
  };

  const macroLabel = { carb: "탄수화물", protein: "단백질", fat: "지방" };
  const lowest = Object.keys(pct).reduce((a, b) => (pct[a] <= pct[b] ? a : b));
  const kcalDiff = Math.round(intake.kcal - budget);

  let message;
  let ok = true;
  if (pct[lowest] < 0.8) {
    message = `${macroLabel[lowest]}이 부족해요 (${Math.round(
      intake[lowest]
    )}g / ${Math.round(targets[lowest])}g 목표)`;
    ok = false;
  } else if (kcalDiff > 200) {
    message = `오늘 기준치보다 ${kcalDiff.toLocaleString()}kcal 더 드셨어요`;
    ok = false;
  } else if (kcalDiff < -500) {
    message = `오늘 기준치보다 ${Math.abs(kcalDiff).toLocaleString()}kcal 덜 드셨어요`;
    ok = false;
  } else {
    message = "오늘 영양소 균형이 양호해요";
  }

  return { kcalDiff, message, ok };
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
      `INSERT OR REPLACE INTO logs (id, type, date, time, text, kcal, carb, protein, fat, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        l.id,
        l.type,
        l.date,
        l.time,
        l.text,
        l.kcal ?? null,
        l.carb ?? null,
        l.protein ?? null,
        l.fat ?? null,
        l.createdAt,
      ]
    );
    if (l.kcal != null) {
      saveNutrition(l.type, l.text, {
        kcal: l.kcal,
        carb: l.carb ?? null,
        protein: l.protein ?? null,
        fat: l.fat ?? null,
      });
    }
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
  let nutrition = lookupNutrition(currentType, text);
  let isEstimate = false;
  if (nutrition === undefined) {
    nutrition = estimateNutrition(currentType, text);
    if (nutrition !== null) isEstimate = true;
  }
  if (nutrition === null || nutrition === undefined) {
    nutrition = await askNutrition(text, currentType);
    if (nutrition !== null) saveNutrition(currentType, text, nutrition);
  }

  addLog(text, nutrition);
  addToRecentList(recentKeyForType(currentType), text);
  if (isEstimate && nutrition) {
    const macroPart =
      currentType === "diet"
        ? ` (탄${Math.round(nutrition.carb)} 단${Math.round(
            nutrition.protein
          )} 지${Math.round(nutrition.fat)})`
        : "";
    showToast(
      `자동 계산: 약 ${Math.round(
        nutrition.kcal
      ).toLocaleString()}kcal${macroPart} (틀리면 '수정'으로 고쳐주세요)`
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
