/**
 * Postgrify Todo App — API entegrasyon testi
 * Vanilla JS, framework yok.
 */

const DB_NAME = "test";
const TABLE_NAME = "todos";
const LS_TOKEN = "postgrify_todo_token";
const LS_API   = "postgrify_todo_api";

let token = null;
let apiUrl = localStorage.getItem(LS_API) || "http://localhost:3000";

// ─── DOM ─────────────────────────────────────────────────────────────────────

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const apiInput    = $("#api-url");
const secretInput = $("#secret");
const connectBtn  = $("#connect-btn");
const statusBar   = $("#status-bar");
const todoSection = $("#todo-section");
const todoInput   = $("#todo-input");
const addBtn      = $("#add-btn");
const todoList    = $("#todo-list");
const h1Badge     = $("#connected-badge");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function showStatus(msg, type = "info") {
  statusBar.textContent = msg;
  statusBar.className = `status-bar show ${type}`;
}

function hideStatus() {
  statusBar.className = "status-bar";
}

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${apiUrl}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ─── API işlemleri ───────────────────────────────────────────────────────────

async function getToken(secret) {
  const data = await apiFetch("/auth/token", {
    method: "POST",
    body: JSON.stringify({
      database: DB_NAME,
      secret,
      scope: ["read", "write", "delete", "schema"],
    }),
  });
  return data.token;
}

async function ensureTable() {
  const { tables } = await apiFetch(`/db/${DB_NAME}/tables`);
  const exists = tables.some((t) => t.name === TABLE_NAME);
  if (exists) return;

  await apiFetch(`/db/${DB_NAME}/tables`, {
    method: "POST",
    body: JSON.stringify({
      name: TABLE_NAME,
      columns: [
        { name: "id",         type: "serial",      primaryKey: true },
        { name: "title",      type: "text",         nullable: false },
        { name: "done",       type: "boolean",      default: "false" },
        { name: "created_at", type: "timestamptz",  default: "now()" },
      ],
    }),
  });
}

async function loadTodos() {
  const data = await apiFetch(
    `/db/${DB_NAME}/${TABLE_NAME}?order=created_at.desc&limit=100`
  );
  return data.rows || [];
}

async function addTodo(title) {
  await apiFetch(`/db/${DB_NAME}/${TABLE_NAME}`, {
    method: "POST",
    body: JSON.stringify({ title, done: false }),
  });
}

async function toggleTodo(id, done) {
  await apiFetch(`/db/${DB_NAME}/${TABLE_NAME}/${id}`, {
    method: "PUT",
    body: JSON.stringify({ done }),
  });
}

async function deleteTodo(id) {
  await apiFetch(`/db/${DB_NAME}/${TABLE_NAME}/${id}`, {
    method: "DELETE",
  });
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderTodos(todos) {
  if (!todos.length) {
    todoList.innerHTML = `<div class="empty-state">Henüz todo yok. Bir tane ekle ✨</div>`;
    return;
  }

  todoList.innerHTML = todos
    .map(
      (t) => `
    <li class="todo-item" data-id="${t.id}">
      <input type="checkbox" ${t.done ? "checked" : ""} data-id="${t.id}" />
      <span class="todo-text ${t.done ? "done" : ""}">${escapeHtml(t.title)}</span>
      <span class="todo-date">${formatDate(t.created_at)}</span>
      <button class="btn btn-danger delete-btn" data-id="${t.id}">Sil</button>
    </li>`
    )
    .join("");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function refreshList() {
  try {
    const todos = await loadTodos();
    renderTodos(todos);
  } catch (err) {
    showStatus(`Liste yüklenemedi: ${err.message}`, "error");
  }
}

// ─── Bağlan ──────────────────────────────────────────────────────────────────

async function connect() {
  const secret = secretInput.value.trim();
  apiUrl = apiInput.value.trim() || "http://localhost:3000";
  localStorage.setItem(LS_API, apiUrl);

  if (!secret) { showStatus("Secret boş olamaz.", "error"); return; }

  connectBtn.disabled = true;
  connectBtn.innerHTML = `<span class="spinner"></span> Bağlanıyor…`;
  showStatus("Token alınıyor…", "info");

  try {
    token = await getToken(secret);
    localStorage.setItem(LS_TOKEN, token);

    showStatus("Tablo kontrol ediliyor…", "info");
    await ensureTable();

    showStatus("Bağlandı!", "success");
    h1Badge.style.display = "inline-flex";
    todoSection.style.display = "block";
    secretInput.value = "";

    await refreshList();
    hideStatus();
  } catch (err) {
    showStatus(`Bağlantı hatası: ${err.message}`, "error");
    token = null;
    h1Badge.style.display = "none";
    todoSection.style.display = "none";
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = "Bağlan";
  }
}

// ─── Events ──────────────────────────────────────────────────────────────────

connectBtn.addEventListener("click", connect);

secretInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") connect();
});

addBtn.addEventListener("click", async () => {
  const title = todoInput.value.trim();
  if (!title) return;

  addBtn.disabled = true;
  try {
    await addTodo(title);
    todoInput.value = "";
    await refreshList();
  } catch (err) {
    showStatus(`Eklenemedi: ${err.message}`, "error");
  } finally {
    addBtn.disabled = false;
  }
});

todoInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addBtn.click();
});

todoList.addEventListener("change", async (e) => {
  if (e.target.type !== "checkbox") return;
  const id = e.target.dataset.id;
  const done = e.target.checked;

  const item = e.target.closest(".todo-item");
  const text = item?.querySelector(".todo-text");
  if (text) text.classList.toggle("done", done);

  try {
    await toggleTodo(id, done);
  } catch (err) {
    showStatus(`Güncellenemedi: ${err.message}`, "error");
    e.target.checked = !done;
    if (text) text.classList.toggle("done", !done);
  }
});

todoList.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("delete-btn")) return;
  const id = e.target.dataset.id;

  const item = e.target.closest(".todo-item");
  if (item) item.style.opacity = "0.4";

  try {
    await deleteTodo(id);
    await refreshList();
  } catch (err) {
    showStatus(`Silinemedi: ${err.message}`, "error");
    if (item) item.style.opacity = "1";
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

apiInput.value = apiUrl;
todoSection.style.display = "none";
h1Badge.style.display = "none";