/**
 * Merkezi API istemcisi — her isteğe Bearer token ekler, 401'de login'e yönlendirir.
 */

const TOKEN_KEY = "postgrify_token";

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

const BASE_URL = (import.meta as unknown as { env: { VITE_API_URL?: string } }).env
  .VITE_API_URL ?? "http://localhost:3000";

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

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
      const err = await res.json() as { error?: string; message?: string };
      message = err.error ?? err.message ?? message;
    } catch {
      // JSON parse hatası — orijinal mesajı kullan
    }
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