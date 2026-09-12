import { describe, expect, test } from "bun:test";
import { ReconnectableCache } from "../src/cache";
import { fetchWithCache } from "../src/request";

describe("ReconnectableCache", () => {
  test("serves requests while connected", () => {
    const cache = new ReconnectableCache();
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  test("requests succeed after the cache reconnects", () => {
    const cache = new ReconnectableCache();
    cache.set("user:1", { name: "ada" });
    cache.drop();
    cache.reconnect();
    expect(cache.get("user:1")).toEqual({ name: "ada" });
  });

  test("fetchWithCache recovers after reconnect", () => {
    const cache = new ReconnectableCache();
    cache.set("k", "v");
    cache.drop();
    cache.reconnect();
    expect(fetchWithCache(cache, "k", () => "fallback")).toBe("v");
  });
});
