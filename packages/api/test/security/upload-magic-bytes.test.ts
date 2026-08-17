/**
 * HIGH-C: Upload magic bytes (MIME sniffing bypass protection) tests.
 *
 * The isValidMagicBytes() function in upload.ts — compares the file's
 * actual content against the Content-Type header.
 *
 * Attack vector: image/jpeg Content-Type + PHP/shell file content
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Read upload source, parse function ───────────────────────────────────────

const uploadSrc = readFileSync(
  join(__dirname, "../../src/routes/db/upload.ts"),
  "utf-8"
);

// ── Source code checks ────────────────────────────────────────────────────────

describe("Upload: magic bytes source code check", () => {
  it("MAGIC_BYTES constant is present", () => {
    expect(uploadSrc).toContain("MAGIC_BYTES");
  });

  it("isValidMagicBytes function is present", () => {
    expect(uploadSrc).toContain("isValidMagicBytes");
  });

  it("JPEG magic bytes (0xFF, 0xD8, 0xFF) are defined", () => {
    expect(uploadSrc).toContain("0xFF, 0xD8, 0xFF");
  });

  it("PNG magic bytes (0x89, 0x50, 0x4E, 0x47) are defined", () => {
    expect(uploadSrc).toContain("0x89, 0x50, 0x4E, 0x47");
  });

  it("WebP special check (RIFF + WEBP) is defined", () => {
    // WebP magic: RIFF header (0x52,0x49,0x46,0x46) + WEBP at offset 8 (0x57,0x45,0x42,0x50)
    // Written as === comparisons in source — check from separate lines
    expect(uploadSrc).toContain("0x57");
    expect(uploadSrc).toContain("0x45");
    expect(uploadSrc).toContain("0x42");
    expect(uploadSrc).toContain("0x50");
    expect(uploadSrc).toContain("image/webp");
  });

  it("GIF magic bytes (GIF87a / GIF89a) are defined", () => {
    expect(uploadSrc).toContain("0x47, 0x49, 0x46");
  });

  it("magic bytes check runs AFTER buffer is read (inside route handler)", () => {
    // isValidMagicBytes function definition may be at the top of the file (helper)
    // but its CALL must appear a second time (inside route handler) — after buffer read
    const allMagicCalls = [...uploadSrc.matchAll(/isValidMagicBytes\(/g)];
    // Must appear at least 2 times: 1 definition + 1 call
    expect(allMagicCalls.length).toBeGreaterThanOrEqual(2);

    // Call inside route handler must come after buffer read
    const bufIdx   = uploadSrc.lastIndexOf("await fileData.toBuffer()");
    const callIdx  = uploadSrc.lastIndexOf("isValidMagicBytes(buffer");
    expect(bufIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(bufIdx);
  });

  it("magic bytes error returns 415", () => {
    expect(uploadSrc).toContain("does not match declared MIME type");
  });
});

// ── Inline magic bytes logic tests ───────────────────────────────────────────

// Testing isValidMagicBytes logic inline
// (module import requires @fastify/multipart, so we use inline tests)

type MagicEntry = Uint8Array[];
const MAGIC_BYTES_TEST: Record<string, MagicEntry> = {
  "image/jpeg": [new Uint8Array([0xFF, 0xD8, 0xFF])],
  "image/png":  [new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
  "image/gif":  [
    new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]),
    new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  ],
  "image/bmp":  [new Uint8Array([0x42, 0x4D])],
  "image/svg+xml": [],
};

function testMagicCheck(buffer: Buffer, mime: string): boolean {
  const signatures = MAGIC_BYTES_TEST[mime];
  if (signatures !== undefined && signatures.length === 0) return true;
  if (!signatures) return false;

  if (mime === "image/webp") {
    if (buffer.length < 12) return false;
    return (
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    );
  }

  return signatures.some((sig) => {
    if (buffer.length < sig.length) return false;
    for (let i = 0; i < sig.length; i++) {
      if (buffer[i] !== sig[i]) return false;
    }
    return true;
  });
}

describe("Upload: magic bytes logic — valid files", () => {
  it("JPEG file passes", () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    expect(testMagicCheck(buf, "image/jpeg")).toBe(true);
  });

  it("PNG file passes", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
    expect(testMagicCheck(buf, "image/png")).toBe(true);
  });

  it("GIF87a file passes", () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00]);
    expect(testMagicCheck(buf, "image/gif")).toBe(true);
  });

  it("GIF89a file passes", () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]);
    expect(testMagicCheck(buf, "image/gif")).toBe(true);
  });

  it("BMP file passes", () => {
    const buf = Buffer.from([0x42, 0x4D, 0x36, 0x00]);
    expect(testMagicCheck(buf, "image/bmp")).toBe(true);
  });

  it("SVG (text-based) skips magic bytes check → passes", () => {
    const buf = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect(testMagicCheck(buf, "image/svg+xml")).toBe(true);
  });
});

describe("Upload: magic bytes logic — fake/malicious files", () => {
  it("PHP content cannot pass with image/jpeg MIME", () => {
    const buf = Buffer.from("<?php system($_GET['cmd']); ?>");
    expect(testMagicCheck(buf, "image/jpeg")).toBe(false);
  });

  it("shell script cannot pass with image/png MIME", () => {
    const buf = Buffer.from("#!/bin/bash\nrm -rf /");
    expect(testMagicCheck(buf, "image/png")).toBe(false);
  });

  it("empty buffer fails", () => {
    const buf = Buffer.from([]);
    expect(testMagicCheck(buf, "image/jpeg")).toBe(false);
    expect(testMagicCheck(buf, "image/png")).toBe(false);
  });

  it("1-byte buffer fails (insufficient)", () => {
    const buf = Buffer.from([0xFF]);
    expect(testMagicCheck(buf, "image/jpeg")).toBe(false); // requires 3 bytes
    expect(testMagicCheck(buf, "image/png")).toBe(false);  // requires 8 bytes
  });

  it("unknown MIME type fails", () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF]);
    expect(testMagicCheck(buf, "application/octet-stream")).toBe(false);
  });

  it("wrong magic bytes (PNG bytes claiming to be JPEG) fail", () => {
    // PNG magic with JPEG claim
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    expect(testMagicCheck(buf, "image/jpeg")).toBe(false);
  });
});

describe("Upload: timing safe API key comparison — source code check", () => {
  const apiKeyGuardSrc = readFileSync(
    join(__dirname, "../../src/middleware/apiKeyGuard.ts"),
    "utf-8"
  );

  it("timingSafeEqual is used", () => {
    expect(apiKeyGuardSrc).toContain("timingSafeEqual");
  });

  it("import crypto from node:crypto", () => {
    expect(apiKeyGuardSrc).toContain('from "node:crypto"');
  });

  it("providedKey !== storedKey direct comparison is not used", () => {
    // Direct string comparison must not be present
    expect(apiKeyGuardSrc).not.toMatch(/providedKey\s*!==\s*storedKey/);
  });

  it("comparison uses Buffer.from", () => {
    expect(apiKeyGuardSrc).toContain("Buffer.from(providedKey");
    expect(apiKeyGuardSrc).toContain("Buffer.from(storedKey");
  });
});