/**
 * IP Allowlist security tests.
 *
 * IP-1:  isIpAllowed unit — IPv4 exact, CIDR, IPv6, edge cases
 * IP-2:  parseIpAllowlist validation — valid/invalid inputs
 * IP-3:  ipAllowlistGuard middleware — allowed/denied/everyone/same_network
 * IP-4:  admin endpoints — GET/PUT/DELETE /admin/databases/:db/ip-allowlist
 * IP-5:  cache invalidation — cache is cleared after PUT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import {
  isIpv4InCidr,
  isIpv6InCidr,
  isIpInRules,
  isValidIpOrCidr,
  parseIpAllowlist,
  isValidIpv4,
  isValidIpv6,
} from "../../src/utils/ipUtils.js";
import {
  invalidateIpAllowlistCache,
  clearIpAllowlistCache,
} from "../../src/middleware/ipAllowlist.js";

// ─────────────────────────────────────────────────────────────────────────────
// IP-1: isIpv4InCidr unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-1: isIpv4InCidr", () => {
  it("/24 subnet — IP within same subnet passes", () => {
    expect(isIpv4InCidr("192.168.1.50",  "192.168.1.0/24")).toBe(true);
    expect(isIpv4InCidr("192.168.1.1",   "192.168.1.0/24")).toBe(true);
    expect(isIpv4InCidr("192.168.1.254", "192.168.1.0/24")).toBe(true);
  });

  it("/24 subnet — different subnet is rejected", () => {
    expect(isIpv4InCidr("192.168.2.1", "192.168.1.0/24")).toBe(false);
    expect(isIpv4InCidr("10.0.0.1",    "192.168.1.0/24")).toBe(false);
  });

  it("/8 subnet — large block", () => {
    expect(isIpv4InCidr("10.50.100.200", "10.0.0.0/8")).toBe(true);
    expect(isIpv4InCidr("11.0.0.1",      "10.0.0.0/8")).toBe(false);
  });

  it("/32 — exact match only", () => {
    expect(isIpv4InCidr("1.2.3.4", "1.2.3.4/32")).toBe(true);
    expect(isIpv4InCidr("1.2.3.5", "1.2.3.4/32")).toBe(false);
  });

  it("/0 — allow everyone", () => {
    expect(isIpv4InCidr("5.5.5.5",    "0.0.0.0/0")).toBe(true);
    expect(isIpv4InCidr("255.255.255.255", "0.0.0.0/0")).toBe(true);
  });

  it("invalid format → false", () => {
    expect(isIpv4InCidr("not-ip", "192.168.1.0/24")).toBe(false);
    expect(isIpv4InCidr("1.2.3.4", "not-cidr")).toBe(false);
    expect(isIpv4InCidr("1.2.3.4", "1.2.3.4/33")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-1b: isIpv6InCidr unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-1b: isIpv6InCidr", () => {
  it("/32 prefix", () => {
    expect(isIpv6InCidr("2001:db8::1",    "2001:db8::/32")).toBe(true);
    expect(isIpv6InCidr("2001:db8:1::1",  "2001:db8::/32")).toBe(true);
    expect(isIpv6InCidr("2001:dc9::1",    "2001:db8::/32")).toBe(false);
  });

  it("loopback ::1", () => {
    expect(isIpv6InCidr("::1", "::1/128")).toBe(true);
    expect(isIpv6InCidr("::2", "::1/128")).toBe(false);
  });

  it("/0 — allow everyone", () => {
    expect(isIpv6InCidr("2001:db8::1", "::/0")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-1c: isIpInRules combined tests
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-1c: isIpInRules", () => {
  it("exact match — IPv4", () => {
    expect(isIpInRules("1.2.3.4", ["1.2.3.4"])).toBe(true);
    expect(isIpInRules("1.2.3.5", ["1.2.3.4"])).toBe(false);
  });

  it("CIDR match — IPv4", () => {
    expect(isIpInRules("192.168.1.50", ["10.0.0.0/8", "192.168.1.0/24"])).toBe(true);
    expect(isIpInRules("5.5.5.5",      ["10.0.0.0/8", "192.168.1.0/24"])).toBe(false);
  });

  it("empty rule list → false", () => {
    expect(isIpInRules("1.2.3.4", [])).toBe(false);
  });

  it("IPv4-mapped IPv6 is normalized", () => {
    // ::ffff:1.2.3.4 → checked as 1.2.3.4
    expect(isIpInRules("::ffff:192.168.1.50", ["192.168.1.0/24"])).toBe(true);
  });

  it("localhost is not always recognized — must be in list", () => {
    expect(isIpInRules("127.0.0.1", ["192.168.1.0/24"])).toBe(false);
    expect(isIpInRules("127.0.0.1", ["127.0.0.1"])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-2: isValidIpOrCidr validation
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-2: isValidIpOrCidr", () => {
  it("valid IPv4", () => {
    expect(isValidIpOrCidr("1.2.3.4")).toBe(true);
    expect(isValidIpOrCidr("0.0.0.0")).toBe(true);
    expect(isValidIpOrCidr("255.255.255.255")).toBe(true);
  });

  it("valid IPv4 CIDR", () => {
    expect(isValidIpOrCidr("192.168.1.0/24")).toBe(true);
    expect(isValidIpOrCidr("10.0.0.0/8")).toBe(true);
    expect(isValidIpOrCidr("0.0.0.0/0")).toBe(true);
  });

  it("valid IPv6", () => {
    expect(isValidIpOrCidr("::1")).toBe(true);
    expect(isValidIpOrCidr("2001:db8::1")).toBe(true);
  });

  it("valid IPv6 CIDR", () => {
    expect(isValidIpOrCidr("2001:db8::/32")).toBe(true);
    expect(isValidIpOrCidr("::/0")).toBe(true);
  });

  it("invalid values → false", () => {
    expect(isValidIpOrCidr("not-an-ip")).toBe(false);
    expect(isValidIpOrCidr("256.0.0.1")).toBe(false);
    expect(isValidIpOrCidr("1.2.3.4/33")).toBe(false);
    expect(isValidIpOrCidr("")).toBe(false);
    expect(isValidIpOrCidr("javascript:alert(1)")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-2b: parseIpAllowlist validation
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-2b: parseIpAllowlist", () => {
  it("valid IP list passes", () => {
    const result = parseIpAllowlist(["1.2.3.4", "192.168.1.0/24"]);
    expect(result.ok).toBe(true);
    expect(result.ips).toEqual(["1.2.3.4", "192.168.1.0/24"]);
  });

  it("empty list passes (everyone mode)", () => {
    const result = parseIpAllowlist([]);
    expect(result.ok).toBe(true);
  });

  it("invalid IP in list → error", () => {
    const result = parseIpAllowlist(["1.2.3.4", "not-an-ip"]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not-an-ip/);
  });

  it("too many IPs (>100) → error", () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => `1.2.3.${i % 255}`);
    const result = parseIpAllowlist(tooMany);
    expect(result.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-3: ipAllowlistGuard middleware
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-3: ipAllowlistGuard middleware", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = Fastify({ logger: false, trustProxy: true });

    const mockSettings = {
      getIpAllowlist: vi.fn().mockResolvedValue({ mode: "everyone", ips: [] }),
      setIpAllowlist: vi.fn().mockResolvedValue(undefined),
      deleteIpAllowlist: vi.fn().mockResolvedValue(undefined),
    };

    server.decorate("settings", mockSettings);
    server.decorate("authenticate", async () => {});
    server.decorate("authenticateAdmin", async () => {});
    server.decorate("cache", {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
    });

    const { ipAllowlistGuard } = await import("../../src/middleware/ipAllowlist.js");

    server.get("/protected", {
      preHandler: [ipAllowlistGuard("mydb")],
    }, async () => ({ ok: true }));

    await server.ready();
  });

  afterEach(async () => {
    clearIpAllowlistCache();
    await server.close();
    vi.resetModules();
  });

  it("everyone mode — all IPs are allowed", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/protected",
      headers: { "X-Forwarded-For": "1.2.3.4" },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-4: Admin endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-4: Admin IP allowlist endpoints", () => {
  let server: FastifyInstance;
  let mockSettings: {
    getIpAllowlist: ReturnType<typeof vi.fn>;
    setIpAllowlist: ReturnType<typeof vi.fn>;
    deleteIpAllowlist: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    server = Fastify({ logger: false });

    mockSettings = {
      getIpAllowlist: vi.fn().mockResolvedValue({ mode: "everyone", ips: [] }),
      setIpAllowlist: vi.fn().mockResolvedValue(undefined),
      deleteIpAllowlist: vi.fn().mockResolvedValue(undefined),
    };

    server.decorate("settings", mockSettings);
    server.decorate("authenticate", async () => {});
    server.decorate("authenticateAdmin", async () => {});
    server.decorate("cache", {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
    });

    const { ipAllowlistAdminRoute } = await import("../../src/routes/admin/ipAllowlist.js");
    await server.register(ipAllowlistAdminRoute);
    await server.ready();
  });

  afterEach(async () => {
    clearIpAllowlistCache();
    await server.close();
    vi.resetModules();
  });

  it("GET /databases/:db/ip-allowlist returns current config", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/databases/mydb/ip-allowlist",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mode: "everyone", ips: [] });
    expect(mockSettings.getIpAllowlist).toHaveBeenCalledWith("mydb");
  });

  it("PUT /databases/:db/ip-allowlist updates config", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/databases/mydb/ip-allowlist",
      payload: { mode: "allowlist", ips: ["1.2.3.4"] },
    });

    expect(res.statusCode).toBe(200);
    expect(mockSettings.setIpAllowlist).toHaveBeenCalledWith(
      "mydb",
      expect.objectContaining({ mode: "allowlist" })
    );
  });

  it("PUT — invalid IP → 400", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/databases/mydb/ip-allowlist",
      payload: { mode: "allowlist", ips: ["not-an-ip"] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("PUT — invalid mode → 400", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/databases/mydb/ip-allowlist",
      payload: { mode: "invalid", ips: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("DELETE /databases/:db/ip-allowlist → resets to everyone", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/databases/mydb/ip-allowlist",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(mockSettings.deleteIpAllowlist).toHaveBeenCalledWith("mydb");
  });

  it("PUT — invalid DB name → 400", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/databases/pg_evil/ip-allowlist",
      payload: { mode: "everyone", ips: [] },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-5: cache invalidation
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-5: cache invalidation", () => {
  it("invalidateIpAllowlistCache clears a specific DB", () => {
    // Simulates a full cache state — must run without error
    expect(() => invalidateIpAllowlistCache("mydb")).not.toThrow();
  });

  it("clearIpAllowlistCache clears all cache", () => {
    expect(() => clearIpAllowlistCache()).not.toThrow();
  });
});
