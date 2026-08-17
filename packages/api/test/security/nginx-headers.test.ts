/**
 * MED-5: nginx security headers tests.
 *
 * Statically verifies that required security headers
 * are present in the nginx.conf file.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const nginxConfPath = join(__dirname, "../../../gui/nginx.conf");

let nginxConf: string;
try {
  nginxConf = readFileSync(nginxConfPath, "utf-8");
} catch {
  nginxConf = "";
}

describe("MED-5: nginx security headers", () => {
  it("nginx.conf file is readable", () => {
    expect(nginxConf.length).toBeGreaterThan(0);
  });

  it("X-Frame-Options: DENY clickjacking protection is present", () => {
    expect(nginxConf).toMatch(/X-Frame-Options.*DENY/i);
  });

  it("X-Content-Type-Options: nosniff MIME sniffing protection is present", () => {
    expect(nginxConf).toMatch(/X-Content-Type-Options.*nosniff/i);
  });

  it("Referrer-Policy token leakage protection is present", () => {
    expect(nginxConf).toMatch(/Referrer-Policy/i);
    expect(nginxConf).toMatch(/strict-origin-when-cross-origin/i);
  });

  it("Content-Security-Policy XSS protection is present", () => {
    expect(nginxConf).toMatch(/Content-Security-Policy/i);
  });

  it("CSP frame-ancestors 'none' provides second layer of clickjacking protection", () => {
    expect(nginxConf).toMatch(/frame-ancestors\s+['"]?none['"]?/i);
  });

  it("Permissions-Policy restricts unnecessary APIs", () => {
    expect(nginxConf).toMatch(/Permissions-Policy/i);
  });

  it("index.html has no-cache header", () => {
    expect(nginxConf).toMatch(/no-cache.*no-store.*must-revalidate/i);
  });

  it("API proxy forwards X-Real-IP and X-Forwarded-For", () => {
    expect(nginxConf).toMatch(/X-Real-IP/);
    expect(nginxConf).toMatch(/X-Forwarded-For/);
  });

  it("WebSocket proxy forwards Upgrade and Connection headers", () => {
    expect(nginxConf).toMatch(/Upgrade\s+\$http_upgrade/);
    expect(nginxConf).toMatch(/Connection\s+\$http_connection/);
  });
});
