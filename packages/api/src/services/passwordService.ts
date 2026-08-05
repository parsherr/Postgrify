/**
 * Password Service — argon2id ile hash ve doğrulama.
 * @node-rs/argon2 kullanılır: Rust binding, sıfır native build sorunu.
 *
 * OWASP önerisi: argon2id, m=65536 (64MB), t=3, p=4
 */

import { hash, verify } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

/**
 * Verilen plain-text şifreyi argon2id ile hash'ler.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Plain-text şifreyi hash ile karşılaştırır.
 * Timing-safe: verify işlevi her durumda sabit süre çalışır.
 */
export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await verify(hash, password);
  } catch {
    return false;
  }
}
