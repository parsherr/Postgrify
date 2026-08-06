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
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const res = await fetch(`${BASE_URL}/setup/status`);
  if (!res.ok) {
    // API erişilemiyorsa → setup gerekiyor gibi davran
    return { configured: false };
  }
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