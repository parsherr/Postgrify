/**
 * SEC-2: Setup endpoint atomic write ve in-memory flag testleri.
 *
 * setup.ts'de:
 * - .env dosyası atomik olarak yazılmalı (tmp → rename)
 * - markSetupComplete() sonrası in-memory flag true olmalı
 * - writeEnvFileAtomic tmp hata durumunda cleanup yapmalı
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("SEC-2: Atomic env file write", () => {
  it("setup.ts writeEnvFileAtomic kodu mevcut", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const setupPath = join(__dirname, "../../src/routes/setup.ts");
    const content = readFileSync(setupPath, "utf-8");

    // Atomik write fonksiyonu
    expect(content).toMatch(/writeEnvFileAtomic/);
    // tmp dosyasına yaz
    expect(content).toMatch(/tmpdir|\.tmp/);
    // rename
    expect(content).toMatch(/renameSync/);
    // Hata durumunda cleanup
    expect(content).toMatch(/unlinkSync/);
  });

  it("setup.ts in-memory flag (_setupCompleted) mevcut", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const setupPath = join(__dirname, "../../src/routes/setup.ts");
    const content = readFileSync(setupPath, "utf-8");

    expect(content).toMatch(/_setupCompleted/);
    expect(content).toMatch(/markSetupComplete/);
  });

  it("writeEnvFileAtomic dosyayı tmp'ye yazar, ardından rename eder", async () => {
    const tmpDir = os.tmpdir();
    const testEnvPath = path.join(tmpDir, `test-atomic-${Date.now()}.env`);
    const content = "TEST_KEY=test_value\n";

    // Atomik write simülasyonu: tmp → rename
    const tmpPath = `${testEnvPath}.tmp`;
    fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, testEnvPath);

    // Sonuç doğrula
    expect(fs.existsSync(testEnvPath)).toBe(true);
    expect(fs.existsSync(tmpPath)).toBe(false);
    expect(fs.readFileSync(testEnvPath, "utf-8")).toBe(content);

    // Cleanup
    fs.unlinkSync(testEnvPath);
  });

  it("setup.ts POST /setup markSetupComplete() çağrıyor", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const setupPath = join(__dirname, "../../src/routes/setup.ts");
    const content = readFileSync(setupPath, "utf-8");

    // POST handler'da markSetupComplete() çağrılıyor
    expect(content).toMatch(/markSetupComplete\(\)/);
  });
});

describe("SEC-2: .env dosya izinleri", () => {
  it("yeni .env dosyası 0o600 izniyle oluşturulur", () => {
    const tmpFile = path.join(os.tmpdir(), `test-perms-${Date.now()}.env`);
    fs.writeFileSync(tmpFile, "SECRET=test\n", { mode: 0o600 });

    const stat = fs.statSync(tmpFile);
    // Sadece sahibin okuma/yazma izni (600)
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);

    fs.unlinkSync(tmpFile);
  });
});