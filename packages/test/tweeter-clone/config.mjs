/**
 * Tweeter-Clone test yapılandırması.
 *
 * Ortam değişkenleri ile override edilebilir:
 *   API_URL      — API sunucusu (varsayılan: http://localhost:3000)
 *   DB_NAME      — Test veritabanı adı (varsayılan: tweetertest)
 *   ADMIN_SECRET — Admin secret (.env'deki ADMIN_SECRET ile aynı)
 */

export const API_URL = process.env.API_URL ?? "http://localhost:3000";
export const DB_NAME = process.env.DB_NAME ?? "tweetertest";
export const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "replace-with-min-16-char-admin-secret";

// Test kullanıcıları — setup.mjs bu kullanıcıları signup ile oluşturur
export const USERS = [
  { email: "alice@tweeter.test", password: "Alice123!", full_name: "Alice Wonderland" },
  { email: "bob@tweeter.test",   password: "Bob12345!",  full_name: "Bob Builder"      },
];

/**
 * API isteği gönderir. Token varsa Authorization header'ı ekler.
 * Başarısız yanıtlarda _httpStatus alanı eklenir.
 */
export async function api(method, path, body, token) {
  const url = `${API_URL}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  let json;
  try {
    json = await res.json();
  } catch {
    json = { _raw: await res.text().catch(() => "(empty)") };
  }

  if (!res.ok) json._httpStatus = res.status;
  return json;
}

/**
 * Kısa çıktı: uzun değerleri kırpar ve ✓/✗ ile işaretler.
 */
export function log(label, data) {
  const str = typeof data === "object"
    ? JSON.stringify(data).slice(0, 120)
    : String(data);
  console.log(`  ${label}: ${str}`);
}