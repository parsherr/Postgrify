/**
 * HIGH-C: Upload magic bytes (MIME sniffing bypass koruması) testleri.
 *
 * upload.ts'deki isValidMagicBytes() fonksiyonu — dosyanın gerçek içeriğini
 * Content-Type header'ı ile karşılaştırır.
 *
 * Saldırı vektörü: image/jpeg Content-Type + PHP/shell dosyası içeriği
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Upload kaynak kodunu oku, fonksiyonu parse et ─────────────────────────────

const uploadSrc = readFileSync(
  join(__dirname, "../../src/routes/db/upload.ts"),
  "utf-8"
);

// ── Kaynak kod kontrolleri ────────────────────────────────────────────────────

describe("Upload: magic bytes kaynak kod kontrolü", () => {
  it("MAGIC_BYTES sabiti mevcut", () => {
    expect(uploadSrc).toContain("MAGIC_BYTES");
  });

  it("isValidMagicBytes fonksiyonu mevcut", () => {
    expect(uploadSrc).toContain("isValidMagicBytes");
  });

  it("JPEG magic bytes (0xFF, 0xD8, 0xFF) tanımlı", () => {
    expect(uploadSrc).toContain("0xFF, 0xD8, 0xFF");
  });

  it("PNG magic bytes (0x89, 0x50, 0x4E, 0x47) tanımlı", () => {
    expect(uploadSrc).toContain("0x89, 0x50, 0x4E, 0x47");
  });

  it("WebP özel kontrolü (RIFF + WEBP) tanımlı", () => {
    // WebP magic: RIFF header (0x52,0x49,0x46,0x46) + offset 8'de WEBP (0x57,0x45,0x42,0x50)
    // Kaynak kodda === karşılaştırmaları olarak yazılı — ayrı satırlardan kontrol et
    expect(uploadSrc).toContain("0x57");
    expect(uploadSrc).toContain("0x45");
    expect(uploadSrc).toContain("0x42");
    expect(uploadSrc).toContain("0x50");
    expect(uploadSrc).toContain("image/webp");
  });

  it("GIF magic bytes (GIF87a / GIF89a) tanımlı", () => {
    expect(uploadSrc).toContain("0x47, 0x49, 0x46");
  });

  it("magic bytes kontrolü buffer'dan SONRA çalışır (route handler içinde)", () => {
    // isValidMagicBytes fonksiyon tanımı dosyanın başında olabilir (helper)
    // ama ÇAĞRISI dosyada ikinci kez geçmeli (route handler içinde) — buffer alımından sonra
    const allMagicCalls = [...uploadSrc.matchAll(/isValidMagicBytes\(/g)];
    // En az 2 kez geçmeli: 1 tanım + 1 çağrı
    expect(allMagicCalls.length).toBeGreaterThanOrEqual(2);

    // Route handler içindeki çağrının buffer'dan sonra gelmesi
    const bufIdx   = uploadSrc.lastIndexOf("await fileData.toBuffer()");
    const callIdx  = uploadSrc.lastIndexOf("isValidMagicBytes(buffer");
    expect(bufIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(bufIdx);
  });

  it("magic bytes hatası 415 döner", () => {
    expect(uploadSrc).toContain("does not match declared MIME type");
  });
});

// ── İnline magic bytes logic testi ───────────────────────────────────────────

// Upload.ts'deki isValidMagicBytes logic'ini inline olarak test et
// (modül import'u @fastify/multipart gerektirdiğinden inline test kullanıyoruz)

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

describe("Upload: magic bytes logic — geçerli dosyalar", () => {
  it("JPEG dosyası geçer", () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    expect(testMagicCheck(buf, "image/jpeg")).toBe(true);
  });

  it("PNG dosyası geçer", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
    expect(testMagicCheck(buf, "image/png")).toBe(true);
  });

  it("GIF87a dosyası geçer", () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00]);
    expect(testMagicCheck(buf, "image/gif")).toBe(true);
  });

  it("GIF89a dosyası geçer", () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]);
    expect(testMagicCheck(buf, "image/gif")).toBe(true);
  });

  it("BMP dosyası geçer", () => {
    const buf = Buffer.from([0x42, 0x4D, 0x36, 0x00]);
    expect(testMagicCheck(buf, "image/bmp")).toBe(true);
  });

  it("SVG (metin tabanlı) magic bytes kontrolü atlanır → geçer", () => {
    const buf = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect(testMagicCheck(buf, "image/svg+xml")).toBe(true);
  });
});

describe("Upload: magic bytes logic — sahte/kötü dosyalar", () => {
  it("PHP içeriği image/jpeg MIME ile geçemez", () => {
    const buf = Buffer.from("<?php system($_GET['cmd']); ?>");
    expect(testMagicCheck(buf, "image/jpeg")).toBe(false);
  });

  it("shell script image/png MIME ile geçemez", () => {
    const buf = Buffer.from("#!/bin/bash\nrm -rf /");
    expect(testMagicCheck(buf, "image/png")).toBe(false);
  });

  it("boş buffer geçemez", () => {
    const buf = Buffer.from([]);
    expect(testMagicCheck(buf, "image/jpeg")).toBe(false);
    expect(testMagicCheck(buf, "image/png")).toBe(false);
  });

  it("sadece 1 byte buffer geçemez (yetersiz)", () => {
    const buf = Buffer.from([0xFF]);
    expect(testMagicCheck(buf, "image/jpeg")).toBe(false); // 3 byte gerekiyor
    expect(testMagicCheck(buf, "image/png")).toBe(false);  // 8 byte gerekiyor
  });

  it("bilinmeyen MIME tipi geçemez", () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF]);
    expect(testMagicCheck(buf, "application/octet-stream")).toBe(false);
  });

  it("yanlış magic bytes (JPEG gibi görünen PNG) geçemez", () => {
    // PNG magic ile JPEG iddia et
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    expect(testMagicCheck(buf, "image/jpeg")).toBe(false);
  });
});

describe("Upload: timing safe API key comparison — kaynak kod kontrolü", () => {
  const apiKeyGuardSrc = readFileSync(
    join(__dirname, "../../src/middleware/apiKeyGuard.ts"),
    "utf-8"
  );

  it("timingSafeEqual kullanılıyor", () => {
    expect(apiKeyGuardSrc).toContain("timingSafeEqual");
  });

  it("import crypto from node:crypto", () => {
    expect(apiKeyGuardSrc).toContain('from "node:crypto"');
  });

  it("providedKey !== storedKey doğrudan karşılaştırma yok", () => {
    // Doğrudan string karşılaştırması olmamalı
    expect(apiKeyGuardSrc).not.toMatch(/providedKey\s*!==\s*storedKey/);
  });

  it("Buffer.from ile karşılaştırma yapılıyor", () => {
    expect(apiKeyGuardSrc).toContain("Buffer.from(providedKey");
    expect(apiKeyGuardSrc).toContain("Buffer.from(storedKey");
  });
});