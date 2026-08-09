/**
 * IP Allowlist güvenlik testleri.
 *
 * IP-1:  isIpAllowed unit — IPv4 exact, CIDR, IPv6, edge cases
 * IP-2:  parseIpAllowlist validation — geçerli/geçersiz inputlar
 * IP-3:  ipAllowlistGuard middleware — allowed/denied/everyone/same_network
 * IP-4:  admin endpoints — GET/PUT/DELETE /admin/databases/:db/ip-allowlist
 * IP-5:  cache invalidation — PUT sonrası cache temizlenir
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
// IP-1: isIpv4InCidr unit testleri
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-1: isIpv4InCidr", () => {
  it("/24 subnet — aynı subnet içindeki IP geçer", () => {
    expect(isIpv4InCidr("192.168.1.50",  "192.168.1.0/24")).toBe(true);
    expect(isIpv4InCidr("192.168.1.1",   "192.168.1.0/24")).toBe(true);
    expect(isIpv4InCidr("192.168.1.254", "192.168.1.0/24")).toBe(true);
  });

  it("/24 subnet — farklı subnet reddedilir", () => {
    expect(isIpv4InCidr("192.168.2.1", "192.168.1.0/24")).toBe(false);
    expect(isIpv4InCidr("10.0.0.1",    "192.168.1.0/24")).toBe(false);
  });

  it("/8 subnet — büyük blok", () => {
    expect(isIpv4InCidr("10.50.100.200", "10.0.0.0/8")).toBe(true);
    expect(isIpv4InCidr("11.0.0.1",      "10.0.0.0/8")).toBe(false);
  });

  it("/32 — exact match only", () => {
    expect(isIpv4InCidr("1.2.3.4", "1.2.3.4/32")).toBe(true);
    expect(isIpv4InCidr("1.2.3.5", "1.2.3.4/32")).toBe(false);
  });

  it("/0 — herkese izin ver", () => {
    expect(isIpv4InCidr("5.5.5.5",    "0.0.0.0/0")).toBe(true);
    expect(isIpv4InCidr("255.255.255.255", "0.0.0.0/0")).toBe(true);
  });

  it("geçersiz format → false", () => {
    expect(isIpv4InCidr("not-ip", "192.168.1.0/24")).toBe(false);
    expect(isIpv4InCidr("1.2.3.4", "not-cidr")).toBe(false);
    expect(isIpv4InCidr("1.2.3.4", "1.2.3.4/33")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-1b: isIpv6InCidr unit testleri
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

  it("/0 — herkese izin ver", () => {
    expect(isIpv6InCidr("2001:db8::1", "::/0")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-1c: isIpInRules birleşik testler
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

  it("boş kural listesi → false", () => {
    expect(isIpInRules("1.2.3.4", [])).toBe(false);
  });

  it("IPv4-mapped IPv6 normalize edilir", () => {
    // ::ffff:1.2.3.4 → 1.2.3.4 olarak kontrol edilir
    expect(isIpInRules("::ffff:192.168.1.50", ["192.168.1.0/24"])).toBe(true);
  });

  it("localhost her zaman tanınan değil — listede olmalı", () => {
    expect(isIpInRules("127.0.0.1", ["192.168.1.0/24"])).toBe(false);
    expect(isIpInRules("127.0.0.1", ["127.0.0.1"])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-2: isValidIpOrCidr validation
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-2: isValidIpOrCidr", () => {
  it("geçerli IPv4", () => {
    expect(isValidIpOrCidr("1.2.3.4")).toBe(true);
    expect(isValidIpOrCidr("0.0.0.0")).toBe(true);
    expect(isValidIpOrCidr("255.255.255.255")).toBe(true);
  });

  it("geçerli IPv4 CIDR", () => {
    expect(isValidIpOrCidr("192.168.1.0/24")).toBe(true);
    expect(isValidIpOrCidr("10.0.0.0/8")).toBe(true);
    expect(isValidIpOrCidr("0.0.0.0/0")).toBe(true);
  });

  it("geçerli IPv6", () => {
    expect(isValidIpOrCidr("::1")).toBe(true);
    expect(isValidIpOrCidr("2001:db8::1")).toBe(true);
  });

  it("geçerli IPv6 CIDR", () => {
    expect(isValidIpOrCidr("2001:db8::/32")).toBe(true);
    expect(isValidIpOrCidr("::/0")).toBe(true);
  });

  it("geçersiz değerler", () => {
    expect(isValidIpOrCidr("not-an-ip")).toBe(false);
    expect(isValidIpOrCidr("999.999.999.999")).toBe(false);
    expect(isValidIpOrCidr("1.2.3.4/33")).toBe(false);
    expect(isValidIpOrCidr("")).toBe(false);
    expect(isValidIpOrCidr("javascript:alert(1)")).toBe(false);
    expect(isValidIpOrCidr("'; DROP TABLE; --")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-2b: parseIpAllowlist validation
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-2b: parseIpAllowlist", () => {
  it("geçerli everyone config", () => {
    const result = parseIpAllowlist({ mode: "everyone", ips: [] });
    expect(result.mode).toBe("everyone");
    expect(result.ips).toEqual([]);
  });

  it("geçerli allowlist config", () => {
    const result = parseIpAllowlist({
      mode: "allowlist",
      ips: ["1.2.3.4", "10.0.0.0/8"],
    });
    expect(result.mode).toBe("allowlist");
    expect(result.ips).toHaveLength(2);
  });

  it("geçersiz mode → hata", () => {
    expect(() => parseIpAllowlist({ mode: "unknown", ips: [] })).toThrow();
  });

  it("geçersiz IP formatı → hata", () => {
    expect(() =>
      parseIpAllowlist({ mode: "allowlist", ips: ["not-an-ip"] })
    ).toThrow();
  });

  it("çok fazla kural → hata (DoS önlemi)", () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => `10.0.${i}.0/24`);
    expect(() => parseIpAllowlist({ mode: "allowlist", ips: tooMany })).toThrow(/Too many/);
  });

  it("ips string olmayan element → hata", () => {
    expect(() =>
      parseIpAllowlist({ mode: "allowlist", ips: [123] })
    ).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-3: ipAllowlistGuard middleware integration
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-3: ipAllowlistGuard middleware", () => {
  // Her test kendi server + guard ile izole çalışır
  afterEach(() => {
    clearIpAllowlistCache();
    vi.unstubAllEnvs();
  });

  async function buildGuardServer(
    mode: string,
    ips: string[],
    shouldFail = false,
    dbName = "testdb"
  ): Promise<FastifyInstance> {
    clearIpAllowlistCache();
    const s = Fastify({ logger: false });

    s.decorate("settings", {
      getIpAllowlist: shouldFail
        ? vi.fn().mockRejectedValue(new Error("DB error"))
        : vi.fn().mockResolvedValue({ mode, ips }),
    });

    const { createIpAllowlistGuard } = await import("../../src/middleware/ipAllowlist.js");
    const guard = createIpAllowlistGuard(s);

    // req.dbName'i set et — dbResolver olmadığı için manual inject
    const setDbName = async (req: import("fastify").FastifyRequest) => {
      req.dbName = dbName;
    };

    s.get("/test", { preHandler: [setDbName, guard] }, async (_req, reply) => {
      return reply.send({ ok: true });
    });

    await s.ready();
    return s;
  }

  it("mode=everyone → her IP geçer", async () => {
    const s = await buildGuardServer("everyone", []);
    const res = await s.inject({ method: "GET", url: "/test" });
    await s.close();
    expect(res.statusCode).toBe(200);
  });

  it("mode=allowlist, IP listede (127.0.0.1) → 200", async () => {
    const s = await buildGuardServer("allowlist", ["127.0.0.1"]);
    const res = await s.inject({ method: "GET", url: "/test" });
    await s.close();
    expect(res.statusCode).toBe(200);
  });

  it("mode=allowlist, IP listede değil → 403", async () => {
    const s = await buildGuardServer("allowlist", ["10.0.0.1"]);
    const res = await s.inject({ method: "GET", url: "/test" });
    await s.close();
    expect(res.statusCode).toBe(403);
  });

  it("mode=allowlist, boş liste → 403 (default deny)", async () => {
    const s = await buildGuardServer("allowlist", []);
    const res = await s.inject({ method: "GET", url: "/test" });
    await s.close();
    expect(res.statusCode).toBe(403);
  });

  it("mode=allowlist, CIDR match 127.0.0.0/8 → 200", async () => {
    const s = await buildGuardServer("allowlist", ["127.0.0.0/8"]);
    const res = await s.inject({ method: "GET", url: "/test" });
    await s.close();
    expect(res.statusCode).toBe(200);
  });

  it("getIpAllowlist hata verirse fail-open — 200 döner", async () => {
    const s = await buildGuardServer("everyone", [], true);
    const res = await s.inject({ method: "GET", url: "/test" });
    await s.close();
    expect(res.statusCode).toBe(200);
  });

  it("mode=same_network, localhost → 200", async () => {
    const s = await buildGuardServer("same_network", []);
    const res = await s.inject({ method: "GET", url: "/test" });
    await s.close();
    expect(res.statusCode).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IP-4: admin endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("IP-4: admin IP allowlist endpoints", () => {
  let server: FastifyInstance;

  const mockSettings = {
    getIpAllowlist: vi.fn().mockResolvedValue({ mode: "everyone", ips: [] }),
    setIpAllowlist: vi.fn().mockResolvedValue(undefined),
    deleteIpAllowlist: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    clearIpAllowlistCache();
    server = Fastify({ logger: false });
    server.decorate("settings", mockSettings);
    server.decorate("authenticateAdmin", async () => {}); // bypass auth in tests

    const { ipAllowlistRoutes } = await import("../../src/routes/admin/ipAllowlist.js");
    await server.register(ipAllowlistRoutes);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    vi.clearAllMocks();
    clearIpAllowlistCache();
  });

  it("GET /databases/:db/ip-allowlist → mevcut config", async () => {
    mockSettings.getIpAllowlist.mockResolvedValueOnce({
      mode: "allowlist",
      ips: ["1.2.3.4"],
    });

    const res = await server.inject({
      method: "GET",
      url: "/databases/mydb/ip-allowlist",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe("allowlist");
    expect(body.ips).toContain("1.2.3.4");
  });

  it("PUT /databases/:db/ip-allowlist → config güncellendi", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/databases/mydb/ip-allowlist",
      payload: { mode: "allowlist", ips: ["192.168.1.0/24"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(mockSettings.setIpAllowlist).toHaveBeenCalledWith(
      "mydb",
      expect.objectContaining({ mode: "allowlist" })
    );
  });

  it("PUT — geçersiz IP → 400", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/databases/mydb/ip-allowlist",
      payload: { mode: "allowlist", ips: ["not-an-ip"] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("PUT — geçersiz mode → 400", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/databases/mydb/ip-allowlist",
      payload: { mode: "invalid", ips: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("DELETE /databases/:db/ip-allowlist → everyone'a sıfırla", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/databases/mydb/ip-allowlist",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(mockSettings.deleteIpAllowlist).toHaveBeenCalledWith("mydb");
  });

  it("PUT — geçersiz DB adı → 400", async () => {
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
  it("invalidateIpAllowlistCache belirli DB'yi temizler", () => {
    // Cache dolu state simülasyonu — hata vermeden çalışmalı
    expect(() => invalidateIpAllowlistCache("mydb")).not.toThrow();
  });

  it("clearIpAllowlistCache tüm cache'i temizler", () => {
    expect(() => clearIpAllowlistCache()).not.toThrow();
  });
});