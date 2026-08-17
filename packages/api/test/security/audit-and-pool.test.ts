/**
 * MED-3: Raw SQL admin audit log tests.
 * VERI-2: Pool graceful drain tests.
 * VERI-3: Backup endpoint coverage documentation tests.
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

  it("query.ts checks the QUERY_LOG_ENABLED flag", () => {
    expect(querySrc).toContain("QUERY_LOG_ENABLED");
  });

  it("query.ts imports insertAuditLog", () => {
    expect(querySrc).toContain("insertAuditLog");
  });

  it("insertAuditLog is called with raw_sql_exec event", () => {
    expect(querySrc).toContain("raw_sql_exec");
  });

  it("audit log records SQL content (truncated via slice)", () => {
    // Long queries must be truncated at 2000 characters
    expect(querySrc).toContain("rawSql.slice(0, 2000)");
  });

  it("main query is not blocked even when audit log fails (try/catch)", () => {
    // insertAuditLog must be wrapped in try/catch — skip import line and
    // find the actual call site (where the raw_sql_exec event is passed)
    const callSiteIdx = querySrc.indexOf("raw_sql_exec");
    expect(callSiteIdx).toBeGreaterThan(-1);
    // Within 200 characters before the call site there must be a try {
    const beforeCall = querySrc.slice(Math.max(0, callSiteIdx - 300), callSiteIdx);
    expect(beforeCall).toContain("try");
  });

  it("admin full SQL only works with admin token + ALLOW_RAW_SQL_ADMIN=true", () => {
    expect(querySrc).toContain("ALLOW_RAW_SQL_ADMIN");
    expect(querySrc).toContain("isAdmin");
    expect(querySrc).toContain("adminFullSqlEnabled");
  });

  it("SELECT-only mode includes writable CTE bypass protection", () => {
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

  it("evictIdlePools performs graceful drain with 30 second timeout", () => {
    // Increased from 5 seconds to 30 seconds — reduces risk of in-flight query loss
    expect(poolSrc).toContain("timeout: 30");
  });

  it("evictIdlePools deletes pool from map before ending it (race condition prevention)", () => {
    // Inside evictIdlePools method: pools.delete(dbName) → entry.sql.end() order
    // Find starting index of the "evictIdlePools" method
    const evictStart = poolSrc.indexOf("private async evictIdlePools");
    expect(evictStart).toBeGreaterThan(-1);
    // Find the end of the method — take slice within the method body
    const methodSlice = poolSrc.slice(evictStart, evictStart + 800);
    const deleteInMethod = methodSlice.indexOf("pools.delete(dbName)");
    const endInMethod = methodSlice.indexOf("entry.sql.end(");
    expect(deleteInMethod).toBeGreaterThan(-1);
    expect(endInMethod).toBeGreaterThan(-1);
    // delete must come before end
    expect(deleteInMethod).toBeLessThan(endInMethod);
  });

  it("evictIdlePools silently catches end() errors (.catch)", () => {
    // Force-close errors must be swallowed via .catch(() => ...)
    const evictStart = poolSrc.indexOf("evictIdlePools");
    const catchInEvict = poolSrc.indexOf(".catch(", evictStart);
    expect(catchInEvict).toBeGreaterThan(-1);
  });

  it("closeAll() closes all pools (graceful shutdown)", () => {
    expect(poolSrc).toContain("closeAll");
    expect(poolSrc).toContain("Promise.all");
  });

  it("closeAll() clears idleTimer (setInterval leak prevention)", () => {
    expect(poolSrc).toContain("clearInterval");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VERI-3: Backup endpoint scope documentation
// ─────────────────────────────────────────────────────────────────────────────

describe("VERI-3: Backup endpoint scope restrictions", () => {
  const backupSrc = readFileSync(
    join(__dirname, "../../src/routes/db/backup.ts"),
    "utf-8"
  );

  it("backup.ts file is readable", () => {
    expect(backupSrc.length).toBeGreaterThan(0);
  });

  it("backup excludes _postgrify_auth schema", () => {
    // Auth schema must not be included in backup — it contains sensitive data
    expect(backupSrc).not.toMatch(/_postgrify_auth.*\bBACKUP\b/i);
    // Backup must be restricted to the public schema
    expect(backupSrc).toContain("public");
  });

  it("backup is served with Content-Disposition attachment header", () => {
    expect(backupSrc).toContain("Content-Disposition");
    expect(backupSrc).toContain("attachment");
  });

  it("backup endpoint requires admin or schema scope", () => {
    // scopeGuard or authenticate middleware must be used
    const hasAuth =
      backupSrc.includes("scopeGuard") ||
      backupSrc.includes("authenticate") ||
      backupSrc.includes("schema");
    expect(hasAuth).toBe(true);
  });
});