/**
 * Kullanım: npx tsx scripts/hash-password.ts "şifreniz"
 *
 * Çıktıyı .env dosyasına ADMIN_PASSWORD_HASH olarak ekleyin.
 * Örnek: ADMIN_PASSWORD_HASH=$argon2id$v=19$...
 */

import { hashPassword } from "../src/services/passwordService.js";

const password = process.argv[2];

if (!password) {
  console.error("Kullanım: npx tsx scripts/hash-password.ts \"şifreniz\"");
  process.exit(1);
}

const result = await hashPassword(password);
console.log(result);