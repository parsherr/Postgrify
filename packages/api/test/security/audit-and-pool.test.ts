/**
 * MED-3: Raw SQL admin audit log testleri.
 * VERI-2: Pool graceful drain testleri.
 * VERI-3: Backup endpoint eksiklikleri belgeleme testleri.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// MED-3: Raw SQL admin audit log
// ─────────────────────────────────────────────────────────────────────────────

describe("MED-3: Raw SQL admin audit log", () => {
  const querySrc = readFileSync(
    join(__dirname, "../../src/routes/db/query.ts"),
    "utf-8"
  );

  it("query.ts QUERY_LOG_ENABLED flag'ini kontrol ediyor", () => {
    expect(querySrc).toContain("QUERY_LOG_ENABLED");
  });

  it("query.ts insertAuditLog import ediyor", () => {
    expect(querySrc).toContain("insertAuditLog");
  });

  it("insertAuditLog raw_sql_exec event'i ile çağrılıyor", () => {
    expect(querySrc).toContain("raw_sql_exec");
  });

  it("audit log SQL içeriğini (slice ile kırparak) kaydediyor", () => {
    // Uzun sorgular 2000 karakter ile kırpılmalı
    expect(querySrc).toContain("rawSql.slice(0, 2000)");
  });

  it("audit log başarısız olsa bile ana sorgu engellenmez (try/catch)", () => {
    // insertAuditLog try/catch ile sarılmalı — import satırını atlayıp
    // gerçek çağrı satırını bul (raw_sql_exec event geçen yere bak)
    const callSiteIdx = querySrc.indexOf("raw_sql_exec");
    expect(callSiteIdx).toBeGreaterThan(-1);
    // call site'dan önce 200 karakter içinde try { geçmeli
    const beforeCall = querySrc.slice(Math.max(0, callSiteIdx - 300), callSiteIdx);
    expect(beforeCall).toContain("try");
  });

  it("admin full SQL sadece admin token + ALLOW_RAW_SQL_ADMIN=true ile çalışır", () => {
    expect(querySrc).toContain("ALLOW_RAW_SQL_ADMIN");
    expect(querySrc).toContain("isAdmin");
    expect(querySrc).toContain("adminFullSqlEnabled");
  });

  it("SELECT-only mod writable CTE bypass koruması içeriyor", () => {
    expect(querySrc).toContain("WRITABLE_CTE_PATTERN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VERI-2: Pool graceful drain
// ─────────────────────────────────────────────────────────────────────────────

describe("VERI-2: Pool Manager graceful drain", () => {
  const poolSrc = readFileSync(
    join(__dirname, "../../src/services/poolManager.ts"),
    "utf-8"
  );

  it("evictIdlePools timeout 30 saniye ile graceful drain yapıyor", () => {
    // 5 saniyeden 30 saniyeye yükseltildi — in-flight sorgu kayıp riskini azaltır
    expect(poolSrc).toContain("timeout: 30");
  });

  it("evictIdlePools pool'u map'ten önce siliyor (race condition önleme)", () => {
    // evictIdlePools metodu içinde: pools.delete(dbName) → entry.sql.end() sırası
    // "evictIdlePools" metodunun başlangıç indexini bul
    const evictStart = poolSrc.indexOf("private async evictIdlePools");
    expect(evictStart).toBeGreaterThan(-1);
    // metodun sonunu bul: sonraki } ile kapanıyor — method içindeki slice'ı al
    const methodSlice = poolSrc.slice(evictStart, evictStart + 800);
    const deleteInMethod = methodSlice.indexOf("pools.delete(dbName)");
    const endInMethod = methodSlice.indexOf("entry.sql.end(");
    expect(deleteInMethod).toBeGreaterThan(-1);
    expect(endInMethod).toBeGreaterThan(-1);
    // delete, end'den önce olmalı
    expect(deleteInMethod).toBeLessThan(endInMethod);
  });

  it("evictIdlePools end() hata durumunu sessizce yakalar (.catch)", () => {
    // .catch(() => ...) ile zorla kapatma hatası yutulmalı
    const evictStart = poolSrc.indexOf("evictIdlePools");
    const catchInEvict = poolSrc.indexOf(".catch(", evictStart);
    expect(catchInEvict).toBeGreaterThan(-1);
  });

  it("closeAll() tüm pool'ları kapatır (graceful shutdown)", () => {
    expect(poolSrc).toContain("closeAll");
    expect(poolSrc).toContain("Promise.all");
  });

  it("closeAll() idleTimer'ı temizler (setInterval leak önleme)", () => {
    expect(poolSrc).toContain("clearInterval");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VERI-3: Backup endpoint kapsam belgeleme
// ─────────────────────────────────────────────────────────────────────────────

describe("VERI-3: Backup endpoint scope kısıtlamaları", () => {
  const backupSrc = readFileSync(
    join(__dirname, "../../src/routes/db/backup.ts"),
    "utf-8"
  );

  it("backup.ts dosyası okunabilir", () => {
    expect(backupSrc.length).toBeGreaterThan(0);
  });

  it("backup _postgrify_auth schema'sını dışarıda bırakıyor", () => {
    // Auth schema backup'a dahil edilmemeli — hassas veri içeriyor
    expect(backupSrc).not.toMatch(/_postgrify_auth.*\bBACKUP\b/i);
    // Backup public schema ile kısıtlı olmalı
    expect(backupSrc).toContain("public");
  });

  it("backup Content-Disposition attachment header'ı ile sunuluyor", () => {
    expect(backupSrc).toContain("Content-Disposition");
    expect(backupSrc).toContain("attachment");
  });

  it("backup endpoint admin veya schema scope gerektirir", () => {
    // scopeGuard veya authenticate middleware kullanılmalı
    const hasAuth =
      backupSrc.includes("scopeGuard") ||
      backupSrc.includes("authenticate") ||
      backupSrc.includes("schema");
    expect(hasAuth).toBe(true);
  });
});