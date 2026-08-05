/**
 * PoolManager unit testleri — gerçek DB bağlantısı olmadan.
 * postgres.js mock'lanır; pool lifecycle test edilir.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PoolManager } from "../../src/services/poolManager.js";

// postgres modülünü mock'la
vi.mock("postgres", () => {
  const endMock = vi.fn().mockResolvedValue(undefined);
  const sqlMock = vi.fn(() => ({ end: endMock, _endMock: endMock }));
  return { default: sqlMock };
});

const cfg = {
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "test",
  ssl: false,
  maxPoolSize: 5,
  idleTimeout: 1000,
  maxLifetime: 60000,
};

let manager: PoolManager;

beforeEach(() => {
  manager = new PoolManager(cfg);
});

afterEach(async () => {
  await manager.closeAll();
  vi.clearAllMocks();
});

describe("PoolManager", () => {
  it("ilk getPool çağrısında yeni pool oluşturur", () => {
    const pool = manager.getPool("project1");
    expect(pool).toBeDefined();
    expect(manager.activePoolCount).toBe(1);
    expect(manager.activePoolNames).toContain("project1");
  });

  it("aynı DB için aynı pool nesnesini döner", () => {
    const p1 = manager.getPool("project1");
    const p2 = manager.getPool("project1");
    expect(p1).toBe(p2);
    expect(manager.activePoolCount).toBe(1);
  });

  it("farklı DB'ler için farklı pool'lar oluşturur", () => {
    const p1 = manager.getPool("db1");
    const p2 = manager.getPool("db2");
    expect(p1).not.toBe(p2);
    expect(manager.activePoolCount).toBe(2);
  });

  it("releasePool belirtilen DB'yi kaldırır", async () => {
    manager.getPool("project1");
    expect(manager.activePoolCount).toBe(1);

    await manager.releasePool("project1");
    expect(manager.activePoolCount).toBe(0);
    expect(manager.activePoolNames).not.toContain("project1");
  });

  it("closeAll tüm pool'ları kapatır", async () => {
    manager.getPool("db1");
    manager.getPool("db2");
    manager.getPool("db3");
    expect(manager.activePoolCount).toBe(3);

    await manager.closeAll();
    expect(manager.activePoolCount).toBe(0);
  });

  it("var olmayan DB için releasePool hata fırlatmaz", async () => {
    await expect(manager.releasePool("nonexistent")).resolves.toBeUndefined();
  });
});