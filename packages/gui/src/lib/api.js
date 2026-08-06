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
async function request(method, path, body) {
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token)
        headers["Authorization"] = `Bearer ${token}`;
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
        const retryHeaders = {
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
                const err = (await retryRes.json());
                message = err.error ?? err.message ?? message;
            }
            catch { /* ignore */ }
            throw new Error(message);
        }
        if (retryRes.status === 204)
            return undefined;
        return retryRes.json();
    }
    if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        try {
            const err = (await res.json());
            message = err.error ?? err.message ?? message;
        }
        catch { /* ignore */ }
        throw new Error(message);
    }
    if (res.status === 204)
        return undefined;
    return res.json();
}
export const api = {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    patch: (path, body) => request("PATCH", path, body),
    delete: (path) => request("DELETE", path),
};
export async function getSetupStatus() {
    const res = await fetch(`${BASE_URL}/setup/status`);
    if (!res.ok) {
        // API erişilemiyorsa → setup gerekiyor gibi davran
        return { configured: false };
    }
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
