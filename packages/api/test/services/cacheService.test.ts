/**
 * CacheService unit tests — in-memory LRU mode (no Redis required).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CacheService } from "../../src/services/cacheService.js";

let cache: CacheService;

beforeEach(async () => {
  // No REDIS_URL → in-memory LRU backend is active
  cache = new CacheService(undefined);
  await cache.connect();
});

afterEach(async () => {
  await cache.disconnect();
});

describe("CacheService (in-memory)", () => {
  it("returns the same value via get() after set()", async () => {
    await cache.set("test:key", "hello", 60);
    const result = await cache.get("test:key");
    expect(result).toBe("hello");
  });

  it("returns null for a key that has not been set", async () => {
    const result = await cache.get("nonexistent:key");
    expect(result).toBeNull();
  });

  it("returns null via get() after del() removes the key", async () => {
    await cache.set("test:del", "value", 60);
    await cache.del("test:del");
    const result = await cache.get("test:del");
    expect(result).toBeNull();
  });

  it("invalidatePattern deletes keys by prefix", async () => {
    await cache.set("postgrify:db1:rows:users:abc", "data1", 60);
    await cache.set("postgrify:db1:rows:users:def", "data2", 60);
    await cache.set("postgrify:db1:schema:users", "schema", 60);

    await cache.invalidatePattern("postgrify:db1:rows:users:*");

    expect(await cache.get("postgrify:db1:rows:users:abc")).toBeNull();
    expect(await cache.get("postgrify:db1:rows:users:def")).toBeNull();
    // schema key must not be affected
    expect(await cache.get("postgrify:db1:schema:users")).toBe("schema");
  });

  it("buildKey joins parts with ':'", () => {
    expect(cache.buildKey("db1", "rows", "users")).toBe(
      "postgrify:db1:rows:users"
    );
  });

  it("JSON data round-trips correctly", async () => {
    const data = { rows: [{ id: 1, name: "Alice" }], total: 1 };
    await cache.set("test:json", JSON.stringify(data), 60);
    const raw = await cache.get("test:json");
    expect(JSON.parse(raw!)).toEqual(data);
  });
});

describe("CacheService (Redis mock)", () => {
  it("invalidatePattern uses scanIterator instead of KEYS", async () => {
    const keysInRedis = ["postgrify:db1:rows:a", "postgrify:db1:rows:b"];

    // scanIterator mock returning an async iterator
    const scanIteratorMock = vi.fn().mockReturnValue(
      (async function* () {
        for (const k of keysInRedis) yield k;
      })()
    );
    const delMock = vi.fn().mockResolvedValue(2);
    const keysMock = vi.fn(); // must not be called

    const fakeRedis = {
      scanIterator: scanIteratorMock,
      del: delMock,
      keys: keysMock,
    };

    // Inject the fake Redis client directly into CacheService's private field
    const svc = new CacheService("redis://fake");
    // @ts-expect-error accessing private field for test purposes
    svc.redis = fakeRedis;

    await svc.invalidatePattern("postgrify:db1:rows:*");

    expect(scanIteratorMock).toHaveBeenCalledWith({
      MATCH: "postgrify:db1:rows:*",
      COUNT: 100,
    });
    expect(delMock).toHaveBeenCalledWith(keysInRedis);
    expect(keysMock).not.toHaveBeenCalled();
  });

  it("does not call del when scanIterator returns 0 results", async () => {
    const scanIteratorMock = vi.fn().mockReturnValue(
      (async function* () {})()
    );
    const delMock = vi.fn();

    const svc = new CacheService("redis://fake");
    // @ts-expect-error accessing private field for test purposes
    svc.redis = { scanIterator: scanIteratorMock, del: delMock };

    await svc.invalidatePattern("postgrify:empty:*");

    expect(delMock).not.toHaveBeenCalled();
  });

  it("calls del with all keys when scanIterator returns multiple results", async () => {
    const keys = ["k1", "k2", "k3", "k4", "k5"];
    const scanIteratorMock = vi.fn().mockReturnValue(
      (async function* () {
        for (const k of keys) yield k;
      })()
    );
    const delMock = vi.fn().mockResolvedValue(keys.length);

    const svc = new CacheService("redis://fake");
    // @ts-expect-error accessing private field for test purposes
    svc.redis = { scanIterator: scanIteratorMock, del: delMock };

    await svc.invalidatePattern("k*");

    expect(delMock).toHaveBeenCalledWith(keys);
  });
});