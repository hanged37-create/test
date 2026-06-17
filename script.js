const STORAGE_KEY = "todos";

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

let todos = loadTodos();
let currentFilter = "all";
let currentCategoryFilter = "all";
let currentSort = "default";
let selectedDateFilter = null; // "YYYY-MM-DD" | null
let editingId = null;

function loadTodos() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTodos() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
}

function addTodo({ text, client, category, priority, dueDate, recurring }) {
  todos.push({
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
  saveTodos();
  render();
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
  const todo = todos.find((t) => t.id === id);
  if (todo) Object.assign(todo, updates);
  saveTodos();
  editingId = null;
  render();
}

function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (todo) {
    const wasCompleted = todo.completed;
    todo.completed = !todo.completed;
    todo.completedAt = todo.completed ? new Date().toISOString() : null;

    // 매월 반복 항목을 완료하면 다음 달 같은 날짜로 새 항목을 자동 생성
    if (todo.completed && !wasCompleted && todo.recurring && todo.dueDate) {
      todos.push({
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
  }
  saveTodos();
  render();
}

function deleteTodo(id) {
  todos = todos.filter((t) => t.id !== id);
  saveTodos();
  render();
}

function clearCompleted() {
  todos = todos.filter((t) => !t.completed);
  saveTodos();
  render();
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
  high: "🔴 높음",
  medium: "🟡 보통",
  low: "🟢 낮음",
};

const categoryLabel = {
  vat: "부가세",
  income: "종합소득세",
  payroll: "급여",
  bookkeeping: "기장",
  etc: "기타",
};

const priorityPlainLabel = { high: "높음", medium: "보통", low: "낮음" };

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

      const main = document.createElement("div");
      main.className = "todo-main";

      const span = document.createElement("span");
      span.className = "todo-text";
      if (todo.client) {
        const clientTag = document.createElement("span");
        clientTag.className = "client-tag";
        clientTag.textContent = `[${todo.client}]`;
        span.appendChild(clientTag);
      }
      span.appendChild(document.createTextNode(todo.text));
      main.appendChild(span);

      if (todo.category) {
        const catBadge = document.createElement("span");
        catBadge.className = `category-badge ${todo.category}`;
        catBadge.textContent = categoryLabel[todo.category];
        main.appendChild(catBadge);
      }

      if (todo.recurring) {
        const recurBadge = document.createElement("span");
        recurBadge.className = "recurring-badge";
        recurBadge.textContent = "🔁 매월 반복";
        main.appendChild(recurBadge);
      }

      if (todo.dueDate || todo.completedAt) {
        const meta = document.createElement("div");
        meta.className = "todo-meta";

        if (todo.dueDate) {
          const urgency = todo.completed ? null : getDueUrgency(todo.dueDate);
          const due = document.createElement("span");
          due.className = `due-date${urgency ? ` ${urgency}` : ""}`;
          due.textContent = `📅 마감 ${formatDate(todo.dueDate)}`;
          meta.appendChild(due);
        }

        if (todo.completedAt) {
          const completed = document.createElement("span");
          completed.className = "completed-date";
          completed.textContent = `✅ 완료 ${formatDate(todo.completedAt)}`;
          meta.appendChild(completed);
        }

        main.appendChild(meta);
      }

      const badge = document.createElement("span");
      badge.className = `priority-badge ${todo.priority}`;
      badge.textContent = priorityLabel[todo.priority];

      const editBtn = document.createElement("button");
      editBtn.className = "edit-btn";
      editBtn.textContent = "✏️";
      editBtn.title = "수정";
      editBtn.addEventListener("click", () => {
        editingId = todo.id;
        render();
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = "✕";
      deleteBtn.title = "삭제";
      deleteBtn.addEventListener("click", () => deleteTodo(todo.id));

      li.appendChild(checkbox);
      li.appendChild(main);
      li.appendChild(badge);
      li.appendChild(editBtn);
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
    dateFilterLabel.textContent = `📅 ${selectedDateFilter} 마감 항목만 표시 중`;
  } else {
    dateFilterBar.hidden = true;
  }
}

/* ---------- 캘린더 ---------- */
const calMonthLabel = document.getElementById("cal-month-label");
const calGrid = document.getElementById("calendar-grid");
const calPrevBtn = document.getElementById("cal-prev");
const calNextBtn = document.getElementById("cal-next");

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
      dot.title = dueTodos.map((t) => t.text).join(", ");
      cell.appendChild(dot);
    }

    calGrid.appendChild(cell);
  }
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
    priorityPlainLabel[t.priority] || t.priority,
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

render();
