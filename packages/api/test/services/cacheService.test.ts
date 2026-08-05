/**
 * CacheService unit testleri — in-memory LRU modu (Redis gerekmez).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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