const STORAGE_KEY = "todos"; // 예전 localStorage 버전 데이터 마이그레이션용
const IDB_NAME = "todoAppDB";
const IDB_STORE = "sqlite";
const IDB_KEY = "dbfile";

const todoForm = document.getElementById("todo-form");
const todoInput = document.getElementById("todo-input");
const clientInput = document.getElementById("client-input");
const categorySelect = document.getElementById("category-select");
const prioritySelect = document.getElementById("priority-select");
const dueDateInput = document.getElementById("due-date-input");
const recurringCheckbox = document.getElementById("recurring-checkbox");
const todoList = document.getElementById("todo-list");
const filterButtons = document.getElementById("filter-buttons");
const categoryFilterButtons = document.getElementById(
  "category-filter-buttons"
);
const sortSelect = document.getElementById("sort-select");
const itemsLeft = document.getElementById("items-left");
const clearCompletedBtn = document.getElementById("clear-completed");
const dateFilterBar = document.getElementById("date-filter-bar");
const dateFilterLabel = document.getElementById("date-filter-label");
const dateFilterClearBtn = document.getElementById("date-filter-clear");
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFileInput = document.getElementById("import-file-input");

let todos = [];
let db = null;
let currentFilter = "all";
let currentCategoryFilter = "all";
let currentSort = "default";
let selectedDateFilter = null; // "YYYY-MM-DD" | null
let editingId = null;

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
    locateFile: (file) => `vendor/${file}`,
  });

  const existing = await loadDbFile();
  if (existing) {
    db = new SQL.Database(existing);
  } else {
    db = new SQL.Database();
    db.run(`
      CREATE TABLE todos (
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL,
        client TEXT,
        category TEXT,
        priority TEXT,
        dueDate TEXT,
        recurring INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        completedAt TEXT
      );
    `);
    migrateFromLocalStorage();
    await persistDb();
  }

  refreshTodosFromDb();
  render();
}

// 이전 버전(localStorage)에 저장된 데이터가 있으면 SQLite로 옮겨옴
function migrateFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const oldTodos = JSON.parse(raw);
    oldTodos.forEach((t) => insertTodoRow(t));
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 마이그레이션할 데이터가 없거나 손상된 경우 무시
  }
}

function insertTodoRow(t) {
  db.run(
    `INSERT INTO todos (id, text, client, category, priority, dueDate, recurring, completed, completedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      t.id,
      t.text,
      t.client || "",
      t.category || null,
      t.priority || null,
      t.dueDate || null,
      t.recurring ? 1 : 0,
      t.completed ? 1 : 0,
      t.completedAt || null,
    ]
  );
}

function refreshTodosFromDb() {
  const result = db.exec(
    "SELECT id, text, client, category, priority, dueDate, recurring, completed, completedAt FROM todos"
  );
  if (result.length === 0) {
    todos = [];
    return;
  }
  const { columns, values } = result[0];
  todos = values.map((row) => {
    const obj = {};
    columns.forEach((col, i) => (obj[col] = row[i]));
    obj.recurring = !!obj.recurring;
    obj.completed = !!obj.completed;
    return obj;
  });
}

function persistAndRender() {
  refreshTodosFromDb();
  persistDb();
  render();
}

function addTodo({ text, client, category, priority, dueDate, recurring }) {
  if (!db) return;
  insertTodoRow({
    id: Date.now(),
    text,
    client: client || "",
    category,
    priority,
    dueDate: dueDate || null,
    recurring: !!recurring,
    completed: false,
    completedAt: null,
  });
  persistAndRender();
}

// 같은 날짜(말일은 보정)로 한 달 뒤의 날짜 문자열("YYYY-MM-DD")을 반환
function getNextMonthDueDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  let nextYear = y;
  let nextMonth = m + 1; // 1~13
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const lastDay = new Date(nextYear, nextMonth, 0).getDate();
  const day = Math.min(d, lastDay);
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(
    day
  ).padStart(2, "0")}`;
}

function updateTodo(id, updates) {
  if (!db) return;
  const fields = Object.keys(updates);
  if (fields.length === 0) return;
  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => updates[f]);
  db.run(`UPDATE todos SET ${setClause} WHERE id = ?`, [...values, id]);
  editingId = null;
  persistAndRender();
}

function toggleTodo(id) {
  if (!db) return;
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  const wasCompleted = todo.completed;
  const nowCompleted = !wasCompleted;
  const completedAt = nowCompleted ? new Date().toISOString() : null;
  db.run("UPDATE todos SET completed = ?, completedAt = ? WHERE id = ?", [
    nowCompleted ? 1 : 0,
    completedAt,
    id,
  ]);

  // 매월 반복 항목을 완료하면 다음 달 같은 날짜로 새 항목을 자동 생성
  if (nowCompleted && !wasCompleted && todo.recurring && todo.dueDate) {
    insertTodoRow({
      id: Date.now(),
      text: todo.text,
      client: todo.client,
      category: todo.category,
      priority: todo.priority,
      dueDate: getNextMonthDueDate(todo.dueDate),
      recurring: true,
      completed: false,
      completedAt: null,
    });
  }

  persistAndRender();
}

function deleteTodo(id) {
  if (!db) return;
  db.run("DELETE FROM todos WHERE id = ?", [id]);
  persistAndRender();
}

function clearCompleted() {
  if (!db) return;
  db.run("DELETE FROM todos WHERE completed = 1");
  persistAndRender();
}

// file://에서 내보낸 todos-backup.json을 읽어 SQLite로 가져옴 (id 충돌 시 덮어씀)
function importTodosFromJSON(jsonText) {
  if (!db) return;
  let imported;
  try {
    imported = JSON.parse(jsonText);
  } catch {
    alert("올바른 JSON 파일이 아닙니다.");
    return;
  }
  if (!Array.isArray(imported)) {
    alert("올바른 백업 파일 형식이 아닙니다.");
    return;
  }

  imported.forEach((t) => {
    db.run(
      `INSERT OR REPLACE INTO todos (id, text, client, category, priority, dueDate, recurring, completed, completedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        t.id,
        t.text,
        t.client || "",
        t.category || null,
        t.priority || null,
        t.dueDate || null,
        t.recurring ? 1 : 0,
        t.completed ? 1 : 0,
        t.completedAt || null,
      ]
    );
  });

  persistAndRender();
  alert(`${imported.length}개 항목을 가져왔습니다.`);
}

const priorityRank = { high: 3, medium: 2, low: 1 };

function compareByDueDate(a, b) {
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return new Date(a.dueDate) - new Date(b.dueDate);
}

function compareByClient(a, b) {
  const ac = a.client || "";
  const bc = b.client || "";
  if (!ac && !bc) return compareByDueDate(a, b);
  if (!ac) return 1;
  if (!bc) return -1;
  return ac.localeCompare(bc, "ko") || compareByDueDate(a, b);
}

function getComparator(sortKey) {
  if (sortKey === "priority-desc") {
    return (a, b) =>
      priorityRank[b.priority] - priorityRank[a.priority] ||
      compareByDueDate(a, b);
  }
  if (sortKey === "priority-asc") {
    return (a, b) =>
      priorityRank[a.priority] - priorityRank[b.priority] ||
      compareByDueDate(a, b);
  }
  if (sortKey === "client-asc") {
    return compareByClient;
  }
  // "default" 와 "due-asc" 모두 마감일이 빠른 순으로 정렬
  return compareByDueDate;
}

function getFilteredAndSortedTodos() {
  let result = todos;

  if (currentFilter === "active") {
    result = result.filter((t) => !t.completed);
  } else if (currentFilter === "completed") {
    result = result.filter((t) => t.completed);
  }

  if (currentCategoryFilter !== "all") {
    result = result.filter((t) => t.category === currentCategoryFilter);
  }

  if (selectedDateFilter) {
    result = result.filter((t) => t.dueDate === selectedDateFilter);
  }

  const comparator = getComparator(currentSort);

  // 완료된 업무는 항상 맨 아래로, 그 안에서도 마감일이 늦을수록 더 아래로
  const incomplete = result.filter((t) => !t.completed).sort(comparator);
  const completed = result.filter((t) => t.completed).sort(comparator);

  return [...incomplete, ...completed];
}

const priorityLabel = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

const categoryLabel = {
  outsourcing: "아웃소싱",
  education: "교육 및 개발",
  withholding: "원천세",
  vat: "부가세",
  corporate: "법인세",
  income: "소득세",
  civil: "민원",
  property: "재산세",
  consult: "상담",
  etc: "기타",
};

function formatDate(isoOrDateStr) {
  const d = new Date(isoOrDateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}.${String(d.getDate()).padStart(2, "0")}`;
}

// 마감일까지 남은 일수를 기준으로 긴급도 분류: 지남(overdue) / D-3 이내(soon) / 평상(null)
function getDueUrgency(dueDateStr) {
  if (!dueDateStr) return null;
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / 86400000);

  if (diffDays < 0) return "overdue";
  if (diffDays <= 3) return "soon";
  return null;
}

function render() {
  const visibleTodos = getFilteredAndSortedTodos();
  todoList.innerHTML = "";

  if (visibleTodos.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "표시할 항목이 없습니다.";
    todoList.appendChild(empty);
  } else {
    visibleTodos.forEach((todo) => {
      const li = document.createElement("li");
      li.className = `todo-item priority-${todo.priority}${
        todo.completed ? " completed" : ""
      }`;

      if (todo.id === editingId) {
        li.appendChild(buildEditForm(todo));
        todoList.appendChild(li);
        return;
      }

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = todo.completed;
      checkbox.addEventListener("change", () => toggleTodo(todo.id));
      li.appendChild(checkbox);

      if (todo.client) {
        const clientTag = document.createElement("span");
        clientTag.className = "client-tag";
        clientTag.textContent = `[${todo.client}]`;
        li.appendChild(clientTag);
      }

      if (todo.category) {
        const catBadge = document.createElement("span");
        catBadge.className = `category-badge ${todo.category}`;
        catBadge.textContent = categoryLabel[todo.category];
        li.appendChild(catBadge);
      }

      const span = document.createElement("span");
      span.className = "todo-text";
      span.textContent = todo.text;
      span.title = todo.text;
      li.appendChild(span);

      if (todo.recurring) {
        const recurBadge = document.createElement("span");
        recurBadge.className = "recurring-badge";
        recurBadge.textContent = "반복";
        recurBadge.title = "매월 반복";
        li.appendChild(recurBadge);
      }

      if (todo.dueDate) {
        const urgency = todo.completed ? null : getDueUrgency(todo.dueDate);
        const due = document.createElement("span");
        due.className = `due-date${urgency ? ` ${urgency}` : ""}`;
        due.textContent = `마감 ${formatDate(todo.dueDate)}`;
        li.appendChild(due);
      }

      if (todo.completedAt) {
        const completed = document.createElement("span");
        completed.className = "completed-date";
        completed.textContent = `완료 ${formatDate(todo.completedAt)}`;
        li.appendChild(completed);
      }

      const badge = document.createElement("span");
      badge.className = `priority-badge ${todo.priority}`;
      badge.textContent = priorityLabel[todo.priority];
      li.appendChild(badge);

      const editBtn = document.createElement("button");
      editBtn.className = "edit-btn";
      editBtn.textContent = "수정";
      editBtn.title = "수정";
      editBtn.addEventListener("click", () => {
        editingId = todo.id;
        render();
      });
      li.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = "✕";
      deleteBtn.title = "삭제";
      deleteBtn.addEventListener("click", () => deleteTodo(todo.id));
      li.appendChild(deleteBtn);

      todoList.appendChild(li);
    });
  }

  const activeCount = todos.filter((t) => !t.completed).length;
  itemsLeft.textContent = `${activeCount}개 남음`;

  renderDateFilterBar();
  renderCalendar();
  updateCategoryCounts();
}

// 카테고리 필터 탭에 카테고리별 잔여(미완료) 항목 수 표시
function updateCategoryCounts() {
  const activeTodos = todos.filter((t) => !t.completed);
  const counts = { all: activeTodos.length };
  Object.keys(categoryLabel).forEach((key) => {
    counts[key] = activeTodos.filter((t) => t.category === key).length;
  });

  categoryFilterButtons.querySelectorAll(".cat-count").forEach((span) => {
    const key = span.dataset.cat;
    const count = counts[key] || 0;
    span.textContent = count > 0 ? ` (${count})` : "";
  });
}

function buildEditForm(todo) {
  const form = document.createElement("div");
  form.className = "todo-edit-form";

  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.value = todo.text;

  const row1 = document.createElement("div");
  row1.className = "todo-edit-row";

  const clientEditInput = document.createElement("input");
  clientEditInput.type = "text";
  clientEditInput.placeholder = "거래처명";
  clientEditInput.value = todo.client || "";

  const categoryEditSelect = document.createElement("select");
  Object.entries(categoryLabel).forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === todo.category) opt.selected = true;
    categoryEditSelect.appendChild(opt);
  });

  row1.appendChild(clientEditInput);
  row1.appendChild(categoryEditSelect);

  const row2 = document.createElement("div");
  row2.className = "todo-edit-row";

  const priorityEditSelect = document.createElement("select");
  Object.entries(priorityLabel).forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === todo.priority) opt.selected = true;
    priorityEditSelect.appendChild(opt);
  });

  const dueEditInput = document.createElement("input");
  dueEditInput.type = "date";
  dueEditInput.value = todo.dueDate || "";

  row2.appendChild(priorityEditSelect);
  row2.appendChild(dueEditInput);

  const actions = document.createElement("div");
  actions.className = "todo-edit-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "edit-save-btn";
  saveBtn.textContent = "저장";
  saveBtn.addEventListener("click", () => {
    const text = textInput.value.trim();
    if (!text) return;
    updateTodo(todo.id, {
      text,
      client: clientEditInput.value.trim(),
      category: categoryEditSelect.value,
      priority: priorityEditSelect.value,
      dueDate: dueEditInput.value || null,
    });
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "edit-cancel-btn";
  cancelBtn.textContent = "취소";
  cancelBtn.addEventListener("click", () => {
    editingId = null;
    render();
  });

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);

  form.appendChild(textInput);
  form.appendChild(row1);
  form.appendChild(row2);
  form.appendChild(actions);

  return form;
}

function renderDateFilterBar() {
  if (selectedDateFilter) {
    dateFilterBar.hidden = false;
    dateFilterLabel.textContent = `${selectedDateFilter} 마감 항목만 표시 중`;
  } else {
    dateFilterBar.hidden = true;
  }
}

/* ---------- 캘린더 ---------- */
const calMonthLabel = document.getElementById("cal-month-label");
const calGrid = document.getElementById("calendar-grid");
const calPrevBtn = document.getElementById("cal-prev");
const calNextBtn = document.getElementById("cal-next");
const calendarTooltip = document.getElementById("calendar-tooltip");

const priorityDotColor = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };

let calendarViewDate = new Date();
calendarViewDate.setDate(1);

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDateDotColor(dateKey) {
  const urgency = getDueUrgency(dateKey);
  if (urgency === "overdue") return "#dc2626";
  if (urgency === "soon") return "#f97316";
  return "#6366f1";
}

function renderCalendar() {
  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();

  calMonthLabel.textContent = `${year}년 ${month + 1}월`;

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayKey = toDateKey(today);

  // 날짜별 마감 todo 모으기 (미완료만 표시)
  const dueMap = {};
  todos
    .filter((t) => t.dueDate && !t.completed)
    .forEach((t) => {
      (dueMap[t.dueDate] = dueMap[t.dueDate] || []).push(t);
    });

  calGrid.innerHTML = "";

  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement("div");
    empty.className = "calendar-day empty";
    calGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(year, month, day);
    const key = toDateKey(cellDate);

    const cell = document.createElement("div");
    cell.className = `calendar-day${key === todayKey ? " today" : ""}${
      key === selectedDateFilter ? " selected" : ""
    }`;
    cell.addEventListener("click", () => {
      selectedDateFilter = selectedDateFilter === key ? null : key;
      render();
    });

    const num = document.createElement("span");
    num.textContent = day;
    cell.appendChild(num);

    const dueTodos = dueMap[key];
    if (dueTodos && dueTodos.length > 0) {
      const dot = document.createElement("span");
      dot.className = "due-dot";
      dot.style.backgroundColor = getDateDotColor(key);
      cell.appendChild(dot);

      cell.addEventListener("mouseenter", () =>
        showCalendarTooltip(cell, key, dueTodos)
      );
      cell.addEventListener("mouseleave", hideCalendarTooltip);
    }

    calGrid.appendChild(cell);
  }
}

// 우선순위가 높은 순, 동일 우선순위 내에서는 거래처명순으로 정렬해 보여줌
function showCalendarTooltip(cell, dateKey, dueTodos) {
  const sorted = [...dueTodos].sort(
    (a, b) =>
      priorityRank[b.priority] - priorityRank[a.priority] ||
      compareByClient(a, b)
  );

  calendarTooltip.innerHTML = "";

  const header = document.createElement("div");
  header.className = "calendar-tooltip-header";
  header.textContent = `${dateKey} 마감 (${sorted.length}건)`;
  calendarTooltip.appendChild(header);

  sorted.forEach((t) => {
    const item = document.createElement("div");
    item.className = "calendar-tooltip-item";

    const dot = document.createElement("span");
    dot.className = "calendar-tooltip-dot";
    dot.style.backgroundColor = priorityDotColor[t.priority];
    item.appendChild(dot);

    if (t.client) {
      const client = document.createElement("span");
      client.className = "calendar-tooltip-client";
      client.textContent = `[${t.client}]`;
      item.appendChild(client);
    }

    const text = document.createElement("span");
    text.className = "calendar-tooltip-text";
    text.textContent = t.text;
    item.appendChild(text);

    calendarTooltip.appendChild(item);
  });

  const rect = cell.getBoundingClientRect();
  calendarTooltip.style.left = `${Math.min(
    rect.left,
    window.innerWidth - 250
  )}px`;
  calendarTooltip.style.top = `${rect.bottom + 6}px`;
  calendarTooltip.style.display = "block";
}

function hideCalendarTooltip() {
  calendarTooltip.style.display = "none";
}

function escapeCsvField(field) {
  const str = String(field);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// 캘린더에 표시된 달을 기준으로 마감일이 그 달인 항목을 CSV로 내보냄
function exportMonthToCSV() {
  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();

  const monthTodos = todos.filter((t) => {
    if (!t.dueDate) return false;
    const [y, m] = t.dueDate.split("-").map(Number);
    return y === year && m === month + 1;
  });

  if (monthTodos.length === 0) {
    alert(`${year}년 ${month + 1}월에 마감일이 있는 항목이 없습니다.`);
    return;
  }

  const headers = [
    "거래처명",
    "카테고리",
    "할 일",
    "우선순위",
    "마감일",
    "완료여부",
    "완료일",
  ];

  const rows = monthTodos.map((t) => [
    t.client || "",
    categoryLabel[t.category] || "",
    t.text,
    priorityLabel[t.priority] || t.priority,
    t.dueDate || "",
    t.completed ? "완료" : "미완료",
    t.completedAt ? formatDate(t.completedAt) : "",
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\r\n");

  // BOM 추가: 엑셀에서 한글이 깨지지 않도록 처리
  const BOM = "﻿";
  const blob = new Blob([BOM + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `업무기록_${year}-${String(month + 1).padStart(2, "0")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

exportBtn.addEventListener("click", exportMonthToCSV);

importBtn.addEventListener("click", () => importFileInput.click());

importFileInput.addEventListener("change", () => {
  const file = importFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importTodosFromJSON(reader.result);
  reader.readAsText(file);
  importFileInput.value = "";
});

calPrevBtn.addEventListener("click", () => {
  calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
  renderCalendar();
});

calNextBtn.addEventListener("click", () => {
  calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
  renderCalendar();
});

todoForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (!text) return;
  addTodo({
    text,
    client: clientInput.value.trim(),
    category: categorySelect.value,
    priority: prioritySelect.value,
    dueDate: dueDateInput.value,
    recurring: recurringCheckbox.checked,
  });
  todoInput.value = "";
  clientInput.value = "";
  dueDateInput.value = "";
  recurringCheckbox.checked = false;
  todoInput.focus();
});

filterButtons.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  filterButtons
    .querySelectorAll(".filter-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  render();
});

categoryFilterButtons.addEventListener("click", (e) => {
  const btn = e.target.closest(".category-filter-btn");
  if (!btn) return;
  currentCategoryFilter = btn.dataset.category;
  categoryFilterButtons
    .querySelectorAll(".category-filter-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  render();
});

dateFilterClearBtn.addEventListener("click", () => {
  selectedDateFilter = null;
  render();
});

sortSelect.addEventListener("change", () => {
  currentSort = sortSelect.value;
  render();
});

clearCompletedBtn.addEventListener("click", clearCompleted);

// file://로 열린 경우 SQLite(sql.js)가 fetch 제약 때문에 동작할 수 없으므로,
// 이 파일에 남아있는 예전 localStorage 데이터를 내보낼 수 있는 안내만 보여줌
function showFileProtocolExportNotice() {
  const banner = document.createElement("div");
  banner.style.cssText =
    "background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:14px 18px;margin-bottom:16px;font-size:0.85rem;color:#92400e;line-height:1.5;";

  const raw = localStorage.getItem(STORAGE_KEY);
  let count = 0;
  try {
    count = raw ? JSON.parse(raw).length : 0;
  } catch {
    count = 0;
  }

  if (!raw || count === 0) {
    banner.textContent =
      "이 위치(file://)에서는 SQLite 기능이 동작하지 않습니다. http://localhost:8000 으로 열어서 사용해 주세요. (이 페이지의 localStorage에서 예전 데이터는 찾지 못했습니다.)";
    document.querySelector(".app").prepend(banner);
    return;
  }

  const msg = document.createElement("p");
  msg.textContent = `이 위치(file://)에서는 SQLite가 동작하지 않지만, 이 페이지에 저장된 예전 데이터 ${count}건을 찾았습니다. 아래 버튼으로 내보낸 뒤 http://localhost:8000 앱의 "데이터 가져오기"로 불러오세요.`;

  const btn = document.createElement("button");
  btn.textContent = "JSON 파일로 내보내기";
  btn.style.cssText =
    "margin-top:8px;padding:8px 16px;border:none;border-radius:6px;background:#f59e0b;color:#fff;cursor:pointer;font-weight:600;";
  btn.addEventListener("click", () => {
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "todos-backup.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  banner.appendChild(msg);
  banner.appendChild(btn);
  document.querySelector(".app").prepend(banner);
}

if (location.protocol === "file:") {
  showFileProtocolExportNotice();
} else {
  initDatabase();
}
