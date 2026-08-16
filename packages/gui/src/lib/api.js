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
export const BASE_URL = import.meta.env.VITE_API_URL ??
    "http://localhost:3000";
const REFRESH_TOKEN_KEY = "postgrify_refresh_token";
// AuthContext tarafından mount sırasında inject edilir
let _getToken = null;
let _setToken = null;
export function setTokenAccessors(getter, setter) {
    _getToken = getter;
    _setToken = setter;
}
export function getToken() {
    return _getToken ? _getToken() : null;
}
// Eş zamanlı 401'lerde tek refresh isteği gönder
let refreshPromise = null;
async function doRefresh() {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken)
        return null;
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
        const data = (await res.json());
        if (_setToken)
            _setToken(data.accessToken);
        return data.accessToken;
    }
    catch {
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        return null;
    }
}
async function parseBody(res) {
    if (res.status === 204)
        return undefined;
    return res.json();
}
async function request(method, path, body, options) {
    const token = getToken();
    const headers = {
        "Content-Type": "application/json",
        ...options?.headers,
    };
    if (token)
        headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401) {
        if (!refreshPromise) {
            refreshPromise = doRefresh().finally(() => {
                refreshPromise = null;
            });
        }
        const newToken = await refreshPromise;
        if (!newToken) {
            localStorage.removeItem(REFRESH_TOKEN_KEY);
            window.location.href = "/login";
            throw new Error("Unauthorized");
        }
        const retryHeaders = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${newToken}`,
            ...options?.headers,
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
                const err = (await retryRes.json());
                message = err.error ?? err.message ?? message;
            }
            catch {
                /* ignore */
            }
            throw new Error(message);
        }
        const data = await parseBody(retryRes);
        if (options?.withHeaders)
            return { data, headers: retryRes.headers };
        return data;
    }
    if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        try {
            const err = (await res.json());
            message = err.error ?? err.message ?? message;
        }
        catch {
            /* ignore */
        }
        throw new Error(message);
    }
    const data = await parseBody(res);
    if (options?.withHeaders)
        return { data, headers: res.headers };
    return data;
}
export const api = {
    get: (path, options) => request("GET", path, undefined, options),
    getWithHeaders: (path, options) => request("GET", path, undefined, { ...options, withHeaders: true }),
    post: (path, body, options) => request("POST", path, body, options),
    put: (path, body, options) => request("PUT", path, body, options),
    patch: (path, body, options) => request("PATCH", path, body, options),
    delete: (path, options) => request("DELETE", path, undefined, options),
};
export async function getSetupStatus() {
    // Network hatası veya !res.ok durumunda throw et — React Query retry mekanizması
    // devreye girsin. "API erişilemedi = kurulum gerekli" yanlış bir çıkarım:
    // API henüz başlamıyor olabilir ve kurulum gerçekte tamamlanmış durumda olabilir.
    const res = await fetch(`${BASE_URL}/setup/status`);
    if (!res.ok)
        throw new Error(`Setup status check failed: ${res.status}`);
    return res.json();
}
export async function postSetup(payload) {
    const res = await fetch(`${BASE_URL}/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        try {
            const err = (await res.json());
            message = err.error ?? err.message ?? message;
        }
        catch { /* ignore */ }
        throw new Error(message);
    }
    return res.json();
}
// ── Multipart upload helper ─────────────────────────────────────────────────
async function uploadFile(path, file) {
    const token = getToken();
    const headers = {};
    if (token)
        headers["Authorization"] = `Bearer ${token}`;
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
        if (!retry.ok)
            throw new Error(await retry.text());
        return retry.json();
    }
    if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
            msg = JSON.parse(text).message ?? JSON.parse(text).error ?? text;
        }
        catch { /* keep raw */ }
        throw new Error(msg);
    }
    if (res.status === 204)
        return undefined;
    return res.json();
}
// ── Backup API ────────────────────────────────────────────────────────────────
export function listBackups(db) {
    return api.get(`/db/${db}/backup/list`);
}
export function createBackup(db) {
    return api.post(`/db/${db}/backup/create`, {});
}
export function deleteBackup(db, backupId) {
    return api.delete(`/db/${db}/backup/${backupId}`);
}
/** Returns the URL to download a specific saved backup file. */
export function downloadBackupUrl(db, backupId) {
    const token = getToken();
    return `${BASE_URL}/db/${db}/backup/${backupId}/download${token ? `?token=${token}` : ""}`;
}
export function restoreBackup(db, file) {
    return uploadFile(`/db/${db}/backup/restore`, file);
}
export function getBackupSchedule(db) {
    return api.get(`/db/${db}/backup/schedule`);
}
export function setBackupSchedule(db, config) {
    return api.put(`/db/${db}/backup/schedule`, config);
}
export function deleteBackupSchedule(db) {
    return api.delete(`/db/${db}/backup/schedule`);
}
export function getIpAllowlist(db) {
    return api.get(`/admin/databases/${db}/ip-allowlist`);
}
export function setIpAllowlist(db, config) {
    return api.put(`/admin/databases/${db}/ip-allowlist`, config);
}
export function deleteIpAllowlist(db) {
    return api.delete(`/admin/databases/${db}/ip-allowlist`);
}
