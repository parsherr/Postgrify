/**
 * Emergency admin sıfırlama aracı.
 *
 * Kullanım:
 *   npx tsx scripts/reset-admin.ts --email admin@example.com --password "yeniŞifre123!"
 *
 * Ne yapar:
 *   1. Yeni şifrenin argon2id hash'ini üretir.
 *   2. .env dosyasındaki ADMIN_EMAIL ve ADMIN_PASSWORD_HASH satırlarını günceller.
 *   3. API yeniden başlatılana kadar değişiklik aktif olmaz (process.env yeniden yüklenir).
 *
 * Gereksinimler:
 *   - .env dosyası packages/ dizininde bulunmalı (Docker Compose standart konumu)
 *   - ADMIN_EMAIL ve ADMIN_PASSWORD_HASH satırları .env'de önceden var olmalı
 *     (yoksa dosya sonuna eklenir)
 *
 * Güvenlik notu:
 *   Bu araç sadece yerel erişimde (sunucuya SSH ile bağlandıktan sonra) kullanılmalı.
 *   Şifreyi komut satırı argümanı olarak geçmek shell history'de görünür — bunu bilmeli.
 *   Üretimde kullandıktan hemen sonra `history -c` ile history temizleyin.
 */

import { hashPassword } from "../src/services/passwordService.js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// .env konumunu bul: script packages/api/scripts/'da, .env packages/'da
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
    rl.question("Yeni admin şifresi: ", (answer) => {
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
      // Mevcut satırı güncelle
      updated = updated.replace(regex, `${key}=${value}`);
    } else {
      // Satır yoksa dosya sonuna ekle
      updated = updated.trimEnd() + `\n${key}=${value}\n`;
    }
  }

  if (dryRun) {
    console.log("\n[DRY RUN] .env güncellenecek içerik:");
    console.log("─".repeat(60));
    // Sadece değişen satırları göster
    for (const key of Object.keys(updates)) {
      const match = updated.match(new RegExp(`^${key}=.*$`, "m"));
      if (match) console.log(match[0]);
    }
    console.log("─".repeat(60));
    return;
  }

  // Atomik write: önce tmp dosyasına yaz, sonra rename
  const tmpPath = envPath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, updated, { mode: 0o600 });
    fs.renameSync(tmpPath, envPath);
    console.log(`✅  .env güncellendi: ${envPath}`);
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
Emergency Admin Sıfırlama

Kullanım:
  npx tsx scripts/reset-admin.ts --email admin@example.com --password "Şifre123!"
  npx tsx scripts/reset-admin.ts --email admin@example.com  (şifre interaktif sorulur)
  npx tsx scripts/reset-admin.ts --dry-run --email ... --password ...

Seçenekler:
  --email     Yeni admin email adresi (zorunlu)
  --password  Yeni şifre (verilmezse interaktif sorulur)
  --dry-run   .env'i değiştirmez, sadece ne yapacağını gösterir

Sonrası:
  API container'ını yeniden başlatın: docker compose restart api
`);
    process.exit(0);
  }

  // Email
  const email = args.email;
  if (!email || !email.includes("@")) {
    console.error("❌  Geçerli bir email adresi gerekli: --email admin@example.com");
    process.exit(1);
  }

  // Şifre (argüman veya interaktif)
  const password = args.password ?? await promptPassword();
  if (!password || password.length < 8) {
    console.error("❌  Şifre en az 8 karakter olmalı.");
    process.exit(1);
  }

  // .env bul
  const envPath = findEnvFile();
  if (!envPath) {
    console.error("❌  .env dosyası bulunamadı. Şu konumlara bakıldı:");
    ENV_CANDIDATES.forEach((p) => console.error("   " + p));
    process.exit(1);
  }

  console.log(`📁  .env: ${envPath}`);
  console.log(`📧  Email: ${email}`);
  console.log("🔐  Hash üretiliyor...");

  const hash = await hashPassword(password);
  console.log("✅  Hash üretildi.");

  updateEnvFile(envPath, {
    ADMIN_EMAIL: email,
    ADMIN_PASSWORD_HASH: hash,
  }, args.dryRun);

  if (!args.dryRun) {
    console.log("\n📢  API'yi yeniden başlatın:");
    console.log("   docker compose restart api");
    console.log("\n⚠️   Shell history'den şifreyi temizleyin:");
    console.log("   history -c  (bash)  veya  fc -p  (zsh)");
  }
}

main().catch((err) => {
  console.error("❌  Hata:", err.message);
  process.exit(1);
});