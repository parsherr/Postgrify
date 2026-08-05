/**
 * CacheService unit testleri — in-memory LRU modu (Redis gerekmez).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CacheService } from "../../src/services/cacheService.js";

let cache: CacheService;

beforeEach(async () => {
  // Redis URL yok → in-memory LRU aktif
  cache = new CacheService(undefined);
  await cache.connect();
});

afterEach(async () => {
  await cache.disconnect();
});

describe("CacheService (in-memory)", () => {
  it("set sonrası get aynı değeri döner", async () => {
    await cache.set("test:key", "hello", 60);
    const result = await cache.get("test:key");
    expect(result).toBe("hello");
  });

  it("olmayan key için null döner", async () => {
    const result = await cache.get("nonexistent:key");
    expect(result).toBeNull();
  });

  it("del sonrası get null döner", async () => {
    await cache.set("test:del", "value", 60);
    await cache.del("test:del");
    const result = await cache.get("test:del");
    expect(result).toBeNull();
  });

  it("invalidatePattern prefix'e göre siler", async () => {
    await cache.set("postgrify:db1:rows:users:abc", "data1", 60);
    await cache.set("postgrify:db1:rows:users:def", "data2", 60);
    await cache.set("postgrify:db1:schema:users", "schema", 60);

    await cache.invalidatePattern("postgrify:db1:rows:users:*");

    expect(await cache.get("postgrify:db1:rows:users:abc")).toBeNull();
    expect(await cache.get("postgrify:db1:rows:users:def")).toBeNull();
    // schema key etkilenmemeli
    expect(await cache.get("postgrify:db1:schema:users")).toBe("schema");
  });

  it("buildKey parçaları ':' ile birleştirir", () => {
    expect(cache.buildKey("db1", "rows", "users")).toBe(
      "postgrify:db1:rows:users"
    );
  });

  it("JSON veri round-trip", async () => {
    const data = { rows: [{ id: 1, name: "Alice" }], total: 1 };
    await cache.set("test:json", JSON.stringify(data), 60);
    const raw = await cache.get("test:json");
    expect(JSON.parse(raw!)).toEqual(data);
  });
});

describe("CacheService (Redis mock)", () => {
  it("invalidatePattern KEYS değil scanIterator kullanır", async () => {
    const keysInRedis = ["postgrify:db1:rows:a", "postgrify:db1:rows:b"];

    // Async iterator döndüren scanIterator mock'u
    const scanIteratorMock = vi.fn().mockReturnValue(
      (async function* () {
        for (const k of keysInRedis) yield k;
      })()
    );
    const delMock = vi.fn().mockResolvedValue(2);
    const keysMock = vi.fn(); // çağrılmamalı

    const fakeRedis = {
      scanIterator: scanIteratorMock,
      del: delMock,
      keys: keysMock,
    };

    // CacheService'in private redis alanını doğrudan inject et
    const svc = new CacheService("redis://fake");
    // @ts-expect-error private erişim test için
    svc.redis = fakeRedis;

    await svc.invalidatePattern("postgrify:db1:rows:*");

    expect(scanIteratorMock).toHaveBeenCalledWith({
      MATCH: "postgrify:db1:rows:*",
      COUNT: 100,
    });
    expect(delMock).toHaveBeenCalledWith(keysInRedis);
    expect(keysMock).not.toHaveBeenCalled();
  });

  it("scanIterator 0 sonuç döndürünce del çağrılmaz", async () => {
    const scanIteratorMock = vi.fn().mockReturnValue(
      (async function* () {})()
    );
    const delMock = vi.fn();

    const svc = new CacheService("redis://fake");
    // @ts-expect-error private erişim test için
    svc.redis = { scanIterator: scanIteratorMock, del: delMock };

    await svc.invalidatePattern("postgrify:empty:*");

    expect(delMock).not.toHaveBeenCalled();
  });

  it("scanIterator birden fazla key döndürünce del tümünü siler", async () => {
    const keys = ["k1", "k2", "k3", "k4", "k5"];
    const scanIteratorMock = vi.fn().mockReturnValue(
      (async function* () {
        for (const k of keys) yield k;
      })()
    );
    const delMock = vi.fn().mockResolvedValue(keys.length);

    const svc = new CacheService("redis://fake");
    // @ts-expect-error private erişim test için
    svc.redis = { scanIterator: scanIteratorMock, del: delMock };

    await svc.invalidatePattern("k*");

    expect(delMock).toHaveBeenCalledWith(keys);
  });
});