/* ---------- DOM ---------- */
const authGate = document.getElementById("auth-gate");
const appRoot = document.getElementById("app-root");
const googleSigninBtn = document.getElementById("google-signin-btn");
const authStatus = document.getElementById("auth-status");
const userEmailEl = document.getElementById("user-email");
const signoutBtn = document.getElementById("signout-btn");

const migrateModal = document.getElementById("migrate-modal");
const migrateSkip = document.getElementById("migrate-skip");
const migrateImport = document.getElementById("migrate-import");

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
const settingsGenderInput = document.getElementById("settings-gender-input");
const settingsGoalInput = document.getElementById("settings-goal-input");
const settingsCarbInput = document.getElementById("settings-carb-input");
const settingsProteinInput = document.getElementById("settings-protein-input");
const settingsFatInput = document.getElementById("settings-fat-input");
const settingsModalCancel = document.getElementById("settings-modal-cancel");
const settingsModalSave = document.getElementById("settings-modal-save");

const RECENT_DIET_KEY = "healthLogRecentDiet";
const RECENT_EXERCISE_KEY = "healthLogRecentExercise";
const MAX_RECENT = 5;
const MIGRATION_DISMISSED_KEY = "healthLogMigrationDismissed";

let toastTimer = null;
function showToast(message, duration = 3000) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

let logs = [];
let calorieMap = {};
let cachedSettings = { goal: "maintain" };
let currentType = "diet";
let editingId = null;
let currentUser = null;
let logsLoaded = false;
let pendingMigrationData = null;
let unsubscribeLogs = null;
let unsubscribeDict = null;
let unsubscribeSettings = null;

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

let selectedDate = toDateKey(new Date());

/* ---------- Firebase 인증/Firestore ---------- */
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const firestoreDb = firebase.firestore();
firestoreDb.enablePersistence().catch(() => {
  /* 여러 탭이 열려있으면 실패할 수 있음 - 무시해도 됨 */
});

function logsCollection() {
  return firestoreDb.collection("users").doc(currentUser.uid).collection("logs");
}
function dictCollection() {
  return firestoreDb
    .collection("users")
    .doc(currentUser.uid)
    .collection("calorieDict");
}
function settingsDocRef() {
  return firestoreDb
    .collection("users")
    .doc(currentUser.uid)
    .collection("meta")
    .doc("settings");
}

googleSigninBtn.addEventListener("click", async () => {
  authStatus.textContent = "";
  try {
    await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (err) {
    authStatus.textContent = `로그인에 실패했습니다: ${err.message}`;
  }
});

signoutBtn.addEventListener("click", () => auth.signOut());

auth.onAuthStateChanged((user) => {
  detachListeners();
  if (user) {
    currentUser = user;
    authGate.hidden = true;
    appRoot.hidden = false;
    userEmailEl.textContent = user.email || "";
    render();
    attachListeners();
  } else {
    currentUser = null;
    logs = [];
    calorieMap = {};
    cachedSettings = { goal: "maintain" };
    authGate.hidden = false;
    appRoot.hidden = true;
  }
});

function attachListeners() {
  logsLoaded = false;
  unsubscribeLogs = logsCollection().onSnapshot((snapshot) => {
    logs = snapshot.docs.map((d) => d.data());
    if (!logsLoaded) {
      logsLoaded = true;
      maybeOfferMigration();
    }
    render();
  });

  unsubscribeDict = dictCollection().onSnapshot((snapshot) => {
    calorieMap = {};
    snapshot.docs.forEach((d) => {
      calorieMap[d.id] = d.data();
    });
  });

  unsubscribeSettings = settingsDocRef().onSnapshot((snap) => {
    cachedSettings = snap.exists ? snap.data() : { goal: "maintain" };
    render();
  });
}

function detachListeners() {
  if (unsubscribeLogs) unsubscribeLogs();
  if (unsubscribeDict) unsubscribeDict();
  if (unsubscribeSettings) unsubscribeSettings();
  unsubscribeLogs = unsubscribeDict = unsubscribeSettings = null;
}

/* ---------- 기존 기기에 남아있던 SQLite 기록을 한 번만 가져오기 ---------- */
function openOldIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("healthLogDB", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("sqlite");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readOldSqliteData() {
  try {
    const idb = await openOldIDB();
    const fileData = await new Promise((resolve, reject) => {
      const tx = idb.transaction("sqlite", "readonly");
      const req = tx.objectStore("sqlite").get("dbfile");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    idb.close();
    if (!fileData) return null;

    const SQL = await initSqlJs({ locateFile: (f) => `../vendor/${f}` });
    const oldDb = new SQL.Database(fileData);
    const toObjs = (result) => {
      if (!result.length) return [];
      const { columns, values } = result[0];
      return values.map((row) => {
        const obj = {};
        columns.forEach((c, i) => (obj[c] = row[i]));
        return obj;
      });
    };
    const logsData = toObjs(
      oldDb.exec(
        "SELECT id, type, date, time, text, kcal, carb, protein, fat, createdAt FROM logs"
      )
    );
    const dictData = toObjs(
      oldDb.exec("SELECT type, text, kcal, carb, protein, fat FROM calorie_dict")
    );
    return { logs: logsData, dict: dictData };
  } catch {
    return null;
  }
}

async function maybeOfferMigration() {
  if (logs.length > 0) return;
  if (localStorage.getItem(MIGRATION_DISMISSED_KEY)) return;
  const oldData = await readOldSqliteData();
  if (!oldData || (oldData.logs.length === 0 && oldData.dict.length === 0)) return;
  pendingMigrationData = oldData;
  migrateModal.hidden = false;
}

migrateSkip.addEventListener("click", () => {
  localStorage.setItem(MIGRATION_DISMISSED_KEY, "1");
  migrateModal.hidden = true;
  pendingMigrationData = null;
});

migrateImport.addEventListener("click", async () => {
  if (!pendingMigrationData || !currentUser) return;
  migrateModal.hidden = true;
  const batch = firestoreDb.batch();
  pendingMigrationData.logs.forEach((l) => {
    batch.set(logsCollection().doc(String(l.id)), {
      id: l.id,
      type: l.type,
      date: l.date,
      time: l.time ?? null,
      text: l.text,
      kcal: l.kcal ?? null,
      carb: l.carb ?? null,
      protein: l.protein ?? null,
      fat: l.fat ?? null,
      createdAt: l.createdAt || new Date().toISOString(),
    });
  });
  pendingMigrationData.dict.forEach((d) => {
    batch.set(dictCollection().doc(dictKey(d.type, d.text)), {
      type: d.type,
      text: d.text,
      kcal: d.kcal ?? null,
      carb: d.carb ?? null,
      protein: d.protein ?? null,
      fat: d.fat ?? null,
    });
  });
  const count = pendingMigrationData.logs.length;
  try {
    await batch.commit();
    localStorage.setItem(MIGRATION_DISMISSED_KEY, "1");
    showToast(`${count}개 항목을 가져왔습니다.`);
  } catch (err) {
    showToast(`가져오기 실패: ${err.message}`);
  }
  pendingMigrationData = null;
});

function dictKey(type, text) {
  return `${type}:::${text.trim().toLowerCase()}`;
}

// undefined: 한 번도 입력된 적 없는 항목 / null: 입력 자체가 없었던 항목
function lookupNutrition(type, text) {
  return calorieMap[dictKey(type, text)];
}

function saveNutrition(type, text, nutrition) {
  if (!currentUser) return;
  const normalized = text.trim().toLowerCase();
  const key = dictKey(type, text);
  calorieMap[key] = nutrition;
  dictCollection().doc(key).set({
    type,
    text: normalized,
    kcal: nutrition.kcal,
    carb: nutrition.carb ?? null,
    protein: nutrition.protein ?? null,
    fat: nutrition.fat ?? null,
  });
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
  ["꼬북칩", 437, 50, 5, 21],
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

function nowTimeStr() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
}

function addLog(text, nutrition) {
  if (!currentUser) return;
  const n = nutrition || {};
  const id = Date.now();
  logsCollection()
    .doc(String(id))
    .set({
      id,
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
}

function updateLog(id, text, nutrition) {
  if (!currentUser) return;
  const log = logs.find((l) => l.id === id);
  const n = nutrition || {};
  logsCollection()
    .doc(String(id))
    .update({
      text,
      kcal: n.kcal ?? null,
      carb: n.carb ?? null,
      protein: n.protein ?? null,
      fat: n.fat ?? null,
    });
  if (n.kcal !== null && n.kcal !== undefined && log) {
    saveNutrition(log.type, text, n);
  }
  editingId = null;
  render();
}

function deleteLog(id) {
  if (!currentUser) return;
  logsCollection().doc(String(id)).delete();
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

/* ---------- 기초대사량/나이/성별/목표 설정 (Firestore에 저장 -> 기기 간 자동 동기화) ---------- */
function getSettings() {
  return {
    bmr: cachedSettings.bmr ?? null,
    age: cachedSettings.age ?? null,
    gender: cachedSettings.gender ?? null,
    goal: cachedSettings.goal || "maintain",
    carbTarget: cachedSettings.carbTarget ?? null,
    proteinTarget: cachedSettings.proteinTarget ?? null,
    fatTarget: cachedSettings.fatTarget ?? null,
  };
}

function saveSettings(bmr, age, gender, goal, carbTarget, proteinTarget, fatTarget) {
  if (!currentUser) return;
  settingsDocRef().set(
    {
      bmr,
      age,
      gender,
      goal: goal || "maintain",
      carbTarget,
      proteinTarget,
      fatTarget,
    },
    { merge: true }
  );
}

settingsBtn.addEventListener("click", () => {
  const { bmr, age, gender, goal, carbTarget, proteinTarget, fatTarget } =
    getSettings();
  settingsBmrInput.value = bmr ?? "";
  settingsAgeInput.value = age ?? "";
  settingsGenderInput.value = gender || "";
  settingsGoalInput.value = goal;
  settingsCarbInput.value = carbTarget ?? "";
  settingsProteinInput.value = proteinTarget ?? "";
  settingsFatInput.value = fatTarget ?? "";
  settingsModal.hidden = false;
});

settingsModalCancel.addEventListener("click", () => {
  settingsModal.hidden = true;
});

settingsModalSave.addEventListener("click", () => {
  saveSettings(
    positiveOrNull(settingsBmrInput.value),
    positiveOrNull(settingsAgeInput.value),
    settingsGenderInput.value || null,
    settingsGoalInput.value,
    positiveOrNull(settingsCarbInput.value),
    positiveOrNull(settingsProteinInput.value),
    positiveOrNull(settingsFatInput.value)
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
      : "⚙ 설정에서 기초대사량이나 탄단지 목표를 입력하면 부족한 영양소를 알려드려요.";
    dayTotal.appendChild(adviceLine);
  } else {
    const advice = computeExerciseAdvice(selectedDate);
    const adviceLine = document.createElement("div");
    adviceLine.className = `day-total-advice${advice.ok ? " ok" : ""}`;
    adviceLine.textContent = advice.message;
    dayTotal.appendChild(adviceLine);
  }
}

// 목표(다이어트/유지/벌크업)·나이·성별을 반영한 탄단지 목표치를 계산
function getMacroRatios({ age, gender, goal }) {
  const goalRatios = {
    lose: { protein: 0.35, fat: 0.3, carb: 0.35 },
    gain: { protein: 0.3, fat: 0.25, carb: 0.45 },
    maintain: { protein: 0.2, fat: 0.3, carb: 0.5 },
  };
  const base = goalRatios[goal] || goalRatios.maintain;

  let proteinRatio = base.protein;
  if (age != null && age >= 50) proteinRatio += 0.05;
  if (gender === "male") proteinRatio += 0.02;
  proteinRatio = Math.min(proteinRatio, 0.5);

  const remaining = 1 - proteinRatio;
  const baseRemaining = base.carb + base.fat;
  const carbRatio =
    baseRemaining > 0 ? (base.carb / baseRemaining) * remaining : remaining * 0.6;
  const fatRatio = remaining - carbRatio;

  return { carb: carbRatio, protein: proteinRatio, fat: fatRatio };
}

// 기초대사량(+그날 운동 소모량) 대비 식단 섭취량을 비교해 가장 부족한 영양소를 안내
function computeDietAdvice(dateKey, intake) {
  const { bmr, age, gender, goal, carbTarget, proteinTarget, fatTarget } =
    getSettings();
  const hasManualTarget = carbTarget || proteinTarget || fatTarget;
  if (!bmr && !hasManualTarget) return null;

  const exerciseKcal = logs
    .filter((l) => l.type === "exercise" && l.date === dateKey)
    .reduce((sum, l) => sum + (l.kcal || 0), 0);

  const budget = bmr ? bmr + exerciseKcal : null;
  const ratio = getMacroRatios({ age, gender, goal });

  // 직접 설정한 g 목표가 있으면 그걸 쓰고, 없으면 기초대사량 기반으로 계산
  const targets = {
    carb: carbTarget ?? (budget != null ? (budget * ratio.carb) / 4 : null),
    protein:
      proteinTarget ?? (budget != null ? (budget * ratio.protein) / 4 : null),
    fat: fatTarget ?? (budget != null ? (budget * ratio.fat) / 9 : null),
  };

  const pct = {};
  Object.keys(targets).forEach((key) => {
    if (targets[key] != null && targets[key] > 0) {
      pct[key] = intake[key] / targets[key];
    }
  });
  if (Object.keys(pct).length === 0) return null;

  const macroLabel = { carb: "탄수화물", protein: "단백질", fat: "지방" };
  const lowest = Object.keys(pct).reduce((a, b) => (pct[a] <= pct[b] ? a : b));
  const kcalDiff = budget != null ? Math.round(intake.kcal - budget) : null;

  let message;
  let ok = true;
  if (pct[lowest] < 0.8) {
    message = `${macroLabel[lowest]}이 부족해요 (${Math.round(
      intake[lowest]
    )}g / ${Math.round(targets[lowest])}g 목표)`;
    ok = false;
  } else if (kcalDiff === null) {
    message = "오늘 영양소 목표를 잘 채우셨어요";
  } else if (goal === "lose" && kcalDiff > 0) {
    message = `다이어트 중인데 오늘 기준치보다 ${kcalDiff.toLocaleString()}kcal 더 드셨어요`;
    ok = false;
  } else if (goal === "lose" && kcalDiff < -800) {
    message = "오늘 너무 적게 드셨어요. 무리한 감량은 건강에 안 좋아요";
    ok = false;
  } else if (goal === "gain" && kcalDiff < 0) {
    message = `근육량을 늘리려면 칼로리가 더 필요해요 (오늘 ${Math.abs(
      kcalDiff
    ).toLocaleString()}kcal 부족)`;
    ok = false;
  } else if (goal !== "lose" && goal !== "gain" && kcalDiff > 200) {
    message = `오늘 기준치보다 ${kcalDiff.toLocaleString()}kcal 더 드셨어요`;
    ok = false;
  } else if (goal !== "lose" && goal !== "gain" && kcalDiff < -500) {
    message = `오늘 기준치보다 ${Math.abs(kcalDiff).toLocaleString()}kcal 덜 드셨어요`;
    ok = false;
  } else {
    message =
      goal === "lose"
        ? "오늘 다이어트 식단 잘 지키셨어요 👍"
        : goal === "gain"
        ? "오늘 근육 늘리기 식단 잘 챙기셨어요 💪"
        : "오늘 영양소 균형이 양호해요";
  }

  return { kcalDiff, message, ok };
}

// 오늘 운동 기록을 부위별 키워드로 분류해 코멘트를 만듦
const EXERCISE_CATEGORIES = [
  { label: "하체", keywords: ["스쿼트", "레그", "런지", "카프", "하체", "다리"] },
  { label: "등", keywords: ["등", "풀업", "데드리프트", "로우", "랫풀"] },
  { label: "가슴", keywords: ["가슴", "벤치", "푸시업", "푸쉬업", "체스트"] },
  { label: "어깨", keywords: ["어깨", "숄더", "레터럴"] },
  { label: "팔", keywords: ["아령", "이두", "삼두", "컬", "덤벨", "팔"] },
  { label: "복근", keywords: ["복근", "플랭크", "윗몸일으키기", "크런치"] },
  {
    label: "유산소",
    keywords: [
      "계단",
      "런닝머신",
      "트레드밀",
      "걷기",
      "달리기",
      "자전거",
      "사이클",
      "수영",
      "줄넘기",
    ],
  },
];

const exercisePhrasing = {
  하체: "오늘 하체 운동을 많이 하셨군요! 🦵",
  등: "오늘 등 운동에 집중하셨네요!",
  가슴: "오늘 가슴 운동 빡세게 하셨네요! 💪",
  어깨: "오늘 어깨 운동 하셨네요!",
  팔: "오늘 팔 운동 하셨네요!",
  복근: "오늘 코어(복근) 운동 하셨네요!",
  유산소: "오늘은 유산소 위주로 움직이셨네요! 🏃",
};

function computeExerciseAdvice(dateKey) {
  const todayLogs = logs.filter(
    (l) => l.type === "exercise" && l.date === dateKey
  );
  if (todayLogs.length === 0) {
    return { message: "오늘은 아직 기록된 운동이 없어요.", ok: false };
  }

  const counts = {};
  todayLogs.forEach((log) => {
    EXERCISE_CATEGORIES.forEach(({ label, keywords }) => {
      if (keywords.some((kw) => log.text.includes(kw))) {
        counts[label] = (counts[label] || 0) + 1;
      }
    });
  });

  const labels = Object.keys(counts);
  if (labels.length === 0) {
    return { message: "오늘도 운동하셨네요! 잘하고 있어요 💪", ok: true };
  }

  const maxCount = Math.max(...labels.map((l) => counts[l]));
  const topLabels = labels.filter((l) => counts[l] === maxCount);

  if (topLabels.length >= 3) {
    return { message: "오늘 여러 부위를 골고루 운동하셨네요! 👏", ok: true };
  }

  return { message: topLabels.map((l) => exercisePhrasing[l]).join(" "), ok: true };
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
  if (!currentUser) return;
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

  const batch = firestoreDb.batch();
  imported.forEach((l) => {
    batch.set(logsCollection().doc(String(l.id)), {
      id: l.id,
      type: l.type,
      date: l.date,
      time: l.time ?? null,
      text: l.text,
      kcal: l.kcal ?? null,
      carb: l.carb ?? null,
      protein: l.protein ?? null,
      fat: l.fat ?? null,
      createdAt: l.createdAt || new Date().toISOString(),
    });
    if (l.kcal != null) {
      batch.set(dictCollection().doc(dictKey(l.type, l.text)), {
        type: l.type,
        text: l.text.trim().toLowerCase(),
        kcal: l.kcal,
        carb: l.carb ?? null,
        protein: l.protein ?? null,
        fat: l.fat ?? null,
      });
    }
  });

  batch
    .commit()
    .then(() => {
      showToast(`${imported.length}개 항목을 가져왔습니다.`);
    })
    .catch((err) => {
      showToast(`가져오기 실패: ${err.message}`);
    });
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
  if (!text || !currentUser) return;
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
