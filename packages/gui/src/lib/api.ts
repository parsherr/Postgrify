/**
 * Merkezi API istemcisi.
 *
 * Token yönetimi:
 *   - accessToken memory'den okunur (AuthContext ref üzerinden)
 *   - 401 alınca: refreshToken ile sessiz yenileme denenır, başarısızsa /login
 *
 * AuthContext circular import'tan kaçınmak için setter/getter fonksiyonları
 * AuthContext tarafından buraya inject edilir (setTokenAccessors).
 */

// ── Backup types ─────────────────────────────────────────────────────────────

export interface BackupMeta {
  id: string;
  db_name: string;
  file_path: string;
  size_bytes: number | null;
  status: "completed" | "failed" | "in_progress";
  created_at: string;
  error_msg: string | null;
}

export interface BackupScheduleConfig {
  cron: string;
  enabled: boolean;
  retain: number;
}

export const BASE_URL =
  (import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL ??
  "http://localhost:3000";

const REFRESH_TOKEN_KEY = "postgrify_refresh_token";

// AuthContext tarafından mount sırasında inject edilir
let _getToken: (() => string | null) | null = null;
let _setToken: ((token: string) => void) | null = null;

export function setTokenAccessors(
  getter: () => string | null,
  setter: (token: string) => void
) {
  _getToken = getter;
  _setToken = setter;
}

export function getToken(): string | null {
  return _getToken ? _getToken() : null;
}

// Eş zamanlı 401'lerde tek refresh isteği gönder
let refreshPromise: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${BASE_URL}/auth/admin/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      return null;
    }

    const data = (await res.json()) as { accessToken: string };
    if (_setToken) _setToken(data.accessToken);
    return data.accessToken;
  } catch {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    return null;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    // Sessiz yenileme: eş zamanlı 401'ler tek promise paylaşır
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
    }

    const newToken = await refreshPromise;

    if (!newToken) {
      // Refresh başarısız — login'e yönlendir
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      window.location.href = "/login";
      throw new Error("Unauthorized");
    }

    // Orijinal isteği yeni token ile tekrarla
    const retryHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${newToken}`,
    };
    const retryRes = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: retryHeaders,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (retryRes.status === 401) {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      window.location.href = "/login";
      throw new Error("Unauthorized");
    }

    if (!retryRes.ok) {
      let message = `${retryRes.status} ${retryRes.statusText}`;
      try {
        const err = (await retryRes.json()) as { error?: string; message?: string };
        message = err.error ?? err.message ?? message;
      } catch { /* ignore */ }
      throw new Error(message);
    }

    if (retryRes.status === 204) return undefined as unknown as T;
    return retryRes.json() as Promise<T>;
  }

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const err = (await res.json()) as { error?: string; message?: string };
      message = err.error ?? err.message ?? message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T = void>(path: string) => request<T>("DELETE", path),
};

// ── Setup API (auth gerektirmez, doğrudan fetch) ──────────────────────────────

export interface SetupStatus {
  configured: boolean;
}

export interface SetupPayload {
  adminEmail: string;
  adminPassword: string;
  pgHost: string;
  pgPort: number;
  pgUser: string;
  pgPassword: string;
}

export interface SetupResult {
  ok: boolean;
  message: string;
  accessToken?: string;
  refreshToken?: string | null;
  email?: string;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  // Network hatası veya !res.ok durumunda throw et — React Query retry mekanizması
  // devreye girsin. "API erişilemedi = kurulum gerekli" yanlış bir çıkarım:
  // API henüz başlamıyor olabilir ve kurulum gerçekte tamamlanmış durumda olabilir.
  const res = await fetch(`${BASE_URL}/setup/status`);
  if (!res.ok) throw new Error(`Setup status check failed: ${res.status}`);
  return res.json() as Promise<SetupStatus>;
}

export async function postSetup(payload: SetupPayload): Promise<SetupResult> {
  const res = await fetch(`${BASE_URL}/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const err = (await res.json()) as { error?: string; message?: string };
      message = err.error ?? err.message ?? message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  return res.json() as Promise<SetupResult>;
}

// ── Multipart upload helper ─────────────────────────────────────────────────

async function uploadFile<T>(path: string, file: File): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const body = new FormData();
  body.append("file", file);

  const res = await fetch(`${BASE_URL}${path}`, { method: "POST", headers, body });

  if (res.status === 401) {
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
    }
    const newToken = await refreshPromise;
    if (!newToken) {
      window.location.href = "/login";
      throw new Error("Session expired");
    }
    headers["Authorization"] = `Bearer ${newToken}`;
    const retry = await fetch(`${BASE_URL}${path}`, { method: "POST", headers, body });
    if (!retry.ok) throw new Error(await retry.text());
    return retry.json() as Promise<T>;
  }

  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = (JSON.parse(text) as { message?: string; error?: string }).message ?? (JSON.parse(text) as { error?: string }).error ?? text; } catch { /* keep raw */ }
    throw new Error(msg);
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ── Backup API ────────────────────────────────────────────────────────────────

export function listBackups(db: string): Promise<{ backups: BackupMeta[] }> {
  return api.get(`/db/${db}/backup/list`);
}

export function createBackup(db: string): Promise<BackupMeta> {
  return api.post(`/db/${db}/backup/create`, {});
}

export function deleteBackup(db: string, backupId: string): Promise<void> {
  return api.delete(`/db/${db}/backup/${backupId}`);
}

/** Returns the URL to download a specific saved backup file. */
export function downloadBackupUrl(db: string, backupId: string): string {
  const token = getToken();
  return `${BASE_URL}/db/${db}/backup/${backupId}/download${token ? `?token=${token}` : ""}`;
}

export function restoreBackup(db: string, file: File): Promise<{ restored: boolean; database: string }> {
  return uploadFile(`/db/${db}/backup/restore`, file);
}

export function getBackupSchedule(db: string): Promise<{ database: string; schedule: BackupScheduleConfig | null }> {
  return api.get(`/db/${db}/backup/schedule`);
}

export function setBackupSchedule(db: string, config: BackupScheduleConfig): Promise<{ database: string; schedule: BackupScheduleConfig }> {
  return api.put(`/db/${db}/backup/schedule`, config);
}

export function deleteBackupSchedule(db: string): Promise<void> {
  return api.delete(`/db/${db}/backup/schedule`);
}

// ── IP Allowlist ──────────────────────────────────────────────────────────────

export interface IpAllowlistConfig {
  mode: "everyone" | "same_network" | "allowlist";
  ips: string[];
}

export function getIpAllowlist(db: string): Promise<IpAllowlistConfig> {
  return api.get(`/admin/databases/${db}/ip-allowlist`);
}

export function setIpAllowlist(db: string, config: IpAllowlistConfig): Promise<{ ok: boolean; config: IpAllowlistConfig }> {
  return api.put(`/admin/databases/${db}/ip-allowlist`, config);
}

export function deleteIpAllowlist(db: string): Promise<{ ok: boolean }> {
  return api.delete(`/admin/databases/${db}/ip-allowlist`);
}
