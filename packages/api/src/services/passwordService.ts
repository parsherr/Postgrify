/**
 * Password Service — hashing and verification with argon2id.
 * Uses @node-rs/argon2: Rust binding, zero native build issues.
 *
 * OWASP recommendation: argon2id, m=65536 (64MB), t=3, p=4
 */

import { hash, verify } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

/**
 * Hashes the given plain-text password with argon2id.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Compares a plain-text password against a hash.
 * Timing-safe: the verify function always runs in constant time.
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
