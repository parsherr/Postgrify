/**
 * Postgrify Auth Test App
 *
 * API endpoints:
 *   POST /auth/admin/login              → admin accessToken
 *   POST /db/test/auth/users            → kullanıcı oluştur (admin token)
 *   POST /db/test/auth/login            → DB kullanıcısı login → accessToken + refreshToken
 *   POST /db/test/auth/refresh          → token yenile
 *   POST /db/test/auth/logout           → oturumu sonlandır
 */

const API = "http://localhost:3000";
const DB  = "test";

// ── State ──────────────────────────────────────────────────────────────────────
let state = {
  accessToken:  null,
  refreshToken: null,
  user:         null,   // { id, email, role, is_active }
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const panels = {
  setup:     document.getElementById("panel-setup"),
  login:     document.getElementById("panel-login"),
  dashboard: document.getElementById("panel-dashboard"),
};

// ── Panel switcher ─────────────────────────────────────────────────────────────
function showPanel(name) {
  Object.values(panels).forEach(p => p.classList.add("hidden"));
  panels[name].classList.remove("hidden");
  panels[name].style.animation = "none";
  requestAnimationFrame(() => { panels[name].style.animation = ""; });
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function toast(msg, type = "info", duration = 4000) {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const icons = { success: "✓", error: "✕", info: "ℹ" };
  el.innerHTML = `<span>${icons[type] ?? "ℹ"}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .3s";
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── Generic API fetch ─────────────────────────────────────────────────────────
async function apiFetch(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

// ── Loading state helper ───────────────────────────────────────────────────────
function setLoading(btn, loading) {
  if (loading) {
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> Bekleniyor…`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
    btn.disabled = false;
  }
}

// ── Session management ────────────────────────────────────────────────────────
function saveSession(accessToken, refreshToken, user) {
  state.accessToken  = accessToken;
  state.refreshToken = refreshToken;
  state.user         = user;
  sessionStorage.setItem("pf_access",  accessToken);
  sessionStorage.setItem("pf_refresh", refreshToken);
  sessionStorage.setItem("pf_user",    JSON.stringify(user));
  updateNavbar(user);
}

function clearSession() {
  state = { accessToken: null, refreshToken: null, user: null };
  sessionStorage.removeItem("pf_access");
  sessionStorage.removeItem("pf_refresh");
  sessionStorage.removeItem("pf_user");
  updateNavbar(null);
}

function loadSession() {
  const access  = sessionStorage.getItem("pf_access");
  const refresh = sessionStorage.getItem("pf_refresh");
  const user    = sessionStorage.getItem("pf_user");
  if (access && user) {
    state.accessToken  = access;
    state.refreshToken = refresh;
    state.user         = JSON.parse(user);
    return true;
  }
  return false;
}

function updateNavbar(user) {
  const navUser  = document.getElementById("navbar-user");
  const navEmail = document.getElementById("navbar-email");
  const navRole  = document.getElementById("navbar-role");
  if (user) {
    navEmail.textContent = user.email;
    navRole.textContent  = user.role;
    navRole.setAttribute("data-role", user.role);
    navUser.classList.remove("hidden");
  } else {
    navUser.classList.add("hidden");
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function showDashboard(accessToken, refreshToken, user) {
  saveSession(accessToken, refreshToken, user);

  document.getElementById("dash-email").textContent = user.email;
  document.getElementById("dash-role").textContent  = user.role;

  const preview = accessToken.slice(0, 24) + "…" + accessToken.slice(-8);
  document.getElementById("dash-token").textContent = preview;
  document.getElementById("dash-token-full").value  = accessToken;

  // Role renk
  const roleEl = document.getElementById("dash-role");
  roleEl.className = "stat-value role-badge";
  roleEl.setAttribute("data-role", user.role);

  showPanel("dashboard");
}

// ── Form: Setup (admin login + create user) ────────────────────────────────────
document.getElementById("form-setup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  const resultEl = document.getElementById("setup-result");
  resultEl.classList.add("hidden");
  resultEl.className = "result hidden";

  const adminEmail    = document.getElementById("setup-admin-email").value.trim();
  const adminPassword = document.getElementById("setup-admin-password").value;
  const userEmail     = document.getElementById("setup-user-email").value.trim();
  const userPassword  = document.getElementById("setup-user-password").value;
  const userRole      = document.getElementById("setup-user-role").value;

  setLoading(btn, true);
  try {
    // 1. Admin login
    const loginRes = await apiFetch("POST", "/auth/admin/login", {
      email: adminEmail,
      password: adminPassword,
    });
    const adminToken = loginRes.accessToken;

    // 2. Kullanıcı oluştur
    const user = await apiFetch("POST", `/db/${DB}/auth/users`, {
      email:    userEmail,
      password: userPassword,
      role:     userRole,
    }, adminToken);

    resultEl.className  = "result success";
    resultEl.textContent = `✓ Kullanıcı oluşturuldu: ${user.email} (${user.role})`;
    resultEl.classList.remove("hidden");

    toast(`${user.email} başarıyla eklendi`, "success");

    // Form'u temizle ve login'e yönlendir
    setTimeout(() => {
      document.getElementById("login-email").value    = userEmail;
      document.getElementById("login-password").value = userPassword;
      showPanel("login");
    }, 1800);

  } catch (err) {
    resultEl.className  = "result error";
    resultEl.textContent = `✕ ${err.message}`;
    resultEl.classList.remove("hidden");
    toast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
});

// ── Form: Login ────────────────────────────────────────────────────────────────
document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn     = e.target.querySelector("button[type=submit]");
  const errorEl = document.getElementById("login-error");
  errorEl.classList.add("hidden");

  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  setLoading(btn, true);
  try {
    const res = await apiFetch("POST", `/db/${DB}/auth/login`, { email, password });
    toast("Giriş başarılı!", "success");
    showDashboard(res.accessToken, res.refreshToken, res.user);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
    toast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
});

// ── Token Yenile ───────────────────────────────────────────────────────────────
document.getElementById("btn-refresh-token").addEventListener("click", async () => {
  const btn      = document.getElementById("btn-refresh-token");
  const resultEl = document.getElementById("refresh-result");
  resultEl.classList.add("hidden");

  if (!state.refreshToken) {
    toast("Refresh token bulunamadı", "error");
    return;
  }

  setLoading(btn, true);
  try {
    const res = await apiFetch("POST", `/db/${DB}/auth/refresh`, {
      refreshToken: state.refreshToken,
    });

    // Token rotation: yeni refresh token geldi
    state.accessToken  = res.accessToken;
    state.refreshToken = res.refreshToken;
    sessionStorage.setItem("pf_access",  res.accessToken);
    sessionStorage.setItem("pf_refresh", res.refreshToken);

    document.getElementById("dash-token-full").value = res.accessToken;
    const preview = res.accessToken.slice(0, 24) + "…" + res.accessToken.slice(-8);
    document.getElementById("dash-token").textContent = preview;

    resultEl.className  = "result success";
    resultEl.textContent = "✓ Token başarıyla yenilendi (rotation: eski token geçersiz)";
    resultEl.classList.remove("hidden");
    toast("Token yenilendi", "success");
  } catch (err) {
    resultEl.className  = "result error";
    resultEl.textContent = `✕ ${err.message}`;
    resultEl.classList.remove("hidden");
    toast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
});

// ── Copy Token ────────────────────────────────────────────────────────────────
document.getElementById("btn-copy-token").addEventListener("click", () => {
  const text = document.getElementById("dash-token-full").value;
  navigator.clipboard.writeText(text).then(() => toast("Token kopyalandı", "info"));
});

// ── Logout ────────────────────────────────────────────────────────────────────
async function doLogout() {
  if (state.refreshToken) {
    try {
      await apiFetch("POST", `/db/${DB}/auth/logout`, {
        refreshToken: state.refreshToken,
      });
    } catch {
      // logout hata verse de session'ı temizle
    }
  }
  clearSession();
  toast("Çıkış yapıldı", "info");
  showPanel("login");
}

document.getElementById("btn-logout").addEventListener("click", doLogout);
document.getElementById("btn-logout-dash").addEventListener("click", doLogout);

// ── Navigation ────────────────────────────────────────────────────────────────
document.getElementById("btn-goto-login").addEventListener("click", () => showPanel("login"));
document.getElementById("btn-goto-setup").addEventListener("click", () => showPanel("setup"));

// ── Init ──────────────────────────────────────────────────────────────────────
(function init() {
  if (loadSession()) {
    showDashboard(state.accessToken, state.refreshToken, state.user);
    toast("Oturum geri yüklendi", "info");
  } else {
    showPanel("login");
  }
})();