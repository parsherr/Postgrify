/**
 * Usage: npx tsx scripts/hash-password.ts "yourpassword"
 *
 * Add the output to your .env file as ADMIN_PASSWORD_HASH.
 * Example: ADMIN_PASSWORD_HASH=$argon2id$v=19$...
 */

import { hashPassword } from "../src/services/passwordService.js";

const password = process.argv[2];

if (!password) {
  console.error("Usage: npx tsx scripts/hash-password.ts \"yourpassword\"");
  process.exit(1);
}

const result = await hashPassword(password);
console.log(result);