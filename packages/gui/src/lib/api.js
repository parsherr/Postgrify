/**
 * Merkezi API istemcisi — her isteğe Bearer token ekler, 401'de login'e yönlendirir.
 */
const TOKEN_KEY = "postgrify_token";
function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}
const BASE_URL = import.meta.env
    .VITE_API_URL ?? "http://localhost:3000";
async function request(method, path, body) {
    const token = getToken();
    const headers = {
        "Content-Type": "application/json",
    };
    if (token)
        headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = "/login";
        throw new Error("Unauthorized");
    }
    if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        try {
            const err = await res.json();
            message = err.error ?? err.message ?? message;
        }
        catch {
            // JSON parse hatası — orijinal mesajı kullan
        }
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
