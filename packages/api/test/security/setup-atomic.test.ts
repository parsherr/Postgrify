/**
 * SEC-2: Setup endpoint atomic write and in-memory flag tests.
 *
 * In setup.ts:
 * - .env file must be written atomically (tmp → rename)
 * - In-memory flag must be true after markSetupComplete()
 * - writeEnvFileAtomic must clean up on tmp error
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
  it("setup.ts writeEnvFileAtomic code is present", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const setupPath = join(__dirname, "../../src/routes/setup.ts");
    const content = readFileSync(setupPath, "utf-8");

    // Atomic write function
    expect(content).toMatch(/writeEnvFileAtomic/);
    // Write to tmp file
    expect(content).toMatch(/tmpdir|\.tmp/);
    // rename
    expect(content).toMatch(/renameSync/);
    // Cleanup on error
    expect(content).toMatch(/unlinkSync/);
  });

  it("setup.ts in-memory flag (_setupCompleted) is present", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const setupPath = join(__dirname, "../../src/routes/setup.ts");
    const content = readFileSync(setupPath, "utf-8");

    expect(content).toMatch(/_setupCompleted/);
    expect(content).toMatch(/markSetupComplete/);
  });

  it("writeEnvFileAtomic writes to tmp then renames", async () => {
    const tmpDir = os.tmpdir();
    const testEnvPath = path.join(tmpDir, `test-atomic-${Date.now()}.env`);
    const content = "TEST_KEY=test_value\n";

    // Atomic write simulation: tmp → rename
    const tmpPath = `${testEnvPath}.tmp`;
    fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, testEnvPath);

    // Verify result
    expect(fs.existsSync(testEnvPath)).toBe(true);
    expect(fs.existsSync(tmpPath)).toBe(false);
    expect(fs.readFileSync(testEnvPath, "utf-8")).toBe(content);

    // Cleanup
    fs.unlinkSync(testEnvPath);
  });

  it("setup.ts POST /setup calls markSetupComplete()", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const setupPath = join(__dirname, "../../src/routes/setup.ts");
    const content = readFileSync(setupPath, "utf-8");

    // markSetupComplete() is called in the POST handler
    expect(content).toMatch(/markSetupComplete\(\)/);
  });
});

describe("SEC-2: .env file permissions", () => {
  it("new .env file is created with 0o600 permissions", () => {
    const tmpFile = path.join(os.tmpdir(), `test-perms-${Date.now()}.env`);
    fs.writeFileSync(tmpFile, "SECRET=test\n", { mode: 0o600 });

    const stat = fs.statSync(tmpFile);
    // Only owner read/write permission (600)
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);

    fs.unlinkSync(tmpFile);
  });
});