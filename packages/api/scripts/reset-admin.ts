/**
 * Emergency admin reset tool.
 *
 * Usage:
 *   npx tsx scripts/reset-admin.ts --email admin@example.com --password "newPassword123!"
 *
 * What it does:
 *   1. Generates an argon2id hash of the new password.
 *   2. Updates the ADMIN_EMAIL and ADMIN_PASSWORD_HASH lines in the .env file.
 *   3. The change does not take effect until the API is restarted (process.env is reloaded).
 *
 * Requirements:
 *   - The .env file must exist in the packages/ directory (standard Docker Compose location)
 *   - ADMIN_EMAIL and ADMIN_PASSWORD_HASH lines must already be present in .env
 *     (they will be appended to the end of the file if absent)
 *
 * Security note:
 *   This tool should only be used with local access (after SSH-ing into the server).
 *   Passing the password as a command-line argument makes it visible in shell history — be aware.
 *   After using it in production, clear the history immediately with `history -c`.
 */

import { hashPassword } from "../src/services/passwordService.js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// Locate the .env file: this script lives in packages/api/scripts/, .env lives in packages/
const ENV_CANDIDATES = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../.env"),
  path.resolve(process.cwd(), "../../packages/.env"),
  path.resolve(import.meta.dirname ?? process.cwd(), "../../.env"),
];

function findEnvFile(): string | null {
  for (const candidate of ENV_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function parseArgs(): { email?: string; password?: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const result: { email?: string; password?: string; dryRun: boolean } = { dryRun: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--email" && args[i + 1]) {
      result.email = args[++i];
    } else if (args[i] === "--password" && args[i + 1]) {
      result.password = args[++i];
    } else if (args[i] === "--dry-run") {
      result.dryRun = true;
    }
  }
  return result;
}

async function promptPassword(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question("New admin password: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function updateEnvFile(envPath: string, updates: Record<string, string>, dryRun: boolean): void {
  const content = fs.readFileSync(envPath, "utf-8");
  let updated = content;

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(updated)) {
      // Update the existing line
      updated = updated.replace(regex, `${key}=${value}`);
    } else {
      // Append to end of file if the line does not exist
      updated = updated.trimEnd() + `\n${key}=${value}\n`;
    }
  }

  if (dryRun) {
    console.log("\n[DRY RUN] Content that would be written to .env:");
    console.log("─".repeat(60));
    // Show only the changed lines
    for (const key of Object.keys(updates)) {
      const match = updated.match(new RegExp(`^${key}=.*$`, "m"));
      if (match) console.log(match[0]);
    }
    console.log("─".repeat(60));
    return;
  }

  // Atomic write: write to a tmp file first, then rename
  const tmpPath = envPath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, updated, { mode: 0o600 });
    fs.renameSync(tmpPath, envPath);
    console.log(`✅  .env updated: ${envPath}`);
  } catch (err) {
    // Cleanup
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

async function main() {
  const args = parseArgs();

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`
Emergency Admin Reset

Usage:
  npx tsx scripts/reset-admin.ts --email admin@example.com --password "Password123!"
  npx tsx scripts/reset-admin.ts --email admin@example.com  (password prompted interactively)
  npx tsx scripts/reset-admin.ts --dry-run --email ... --password ...

Options:
  --email     New admin email address (required)
  --password  New password (prompted interactively if not provided)
  --dry-run   Does not modify .env; only shows what would be changed

Next step:
  Restart the API container: docker compose restart api
`);
    process.exit(0);
  }

  // Email
  const email = args.email;
  if (!email || !email.includes("@")) {
    console.error("❌  A valid email address is required: --email admin@example.com");
    process.exit(1);
  }

  // Password (argument or interactive)
  const password = args.password ?? await promptPassword();
  if (!password || password.length < 8) {
    console.error("❌  Password must be at least 8 characters.");
    process.exit(1);
  }

  // Locate .env
  const envPath = findEnvFile();
  if (!envPath) {
    console.error("❌  .env file not found. Locations searched:");
    ENV_CANDIDATES.forEach((p) => console.error("   " + p));
    process.exit(1);
  }

  console.log(`📁  .env: ${envPath}`);
  console.log(`📧  Email: ${email}`);
  console.log("🔐  Generating hash...");

  const hash = await hashPassword(password);
  console.log("✅  Hash generated.");

  updateEnvFile(envPath, {
    ADMIN_EMAIL: email,
    ADMIN_PASSWORD_HASH: hash,
  }, args.dryRun);

  if (!args.dryRun) {
    console.log("\n📢  Restart the API:");
    console.log("   docker compose restart api");
    console.log("\n⚠️   Clear the password from shell history:");
    console.log("   history -c  (bash)  or  fc -p  (zsh)");
  }
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});