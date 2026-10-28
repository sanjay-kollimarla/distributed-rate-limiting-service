import { describe, expect, it } from "bun:test";
import { loadConfig } from "../../src/config/config";

describe("loadConfig", () => {
  it("applies safe defaults", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({ port: 3000, store: "redis", logLevel: "info", trustProxy: false });
    expect(config.metricsToken).toBeUndefined();
  });

  it("accepts a proxy hop count", () => {
    expect(loadConfig({ TRUST_PROXY: "1" }).trustProxy).toBe(1);
    expect(loadConfig({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
  });

  it("parses API keys", () => {
    const config = loadConfig({ API_KEYS: "k1=acme:premium, k2=globex:standard" });
    expect(config.apiKeys.get("k2")).toEqual({ id: "globex", tier: "standard" });
  });

  it.each([
    [{ PORT: "abc" }],
    [{ PORT: "0" }],
    [{ RATE_LIMIT_STORE: "mysql" }],
    [{ LOG_LEVEL: "verbose" }],
    [{ API_KEYS: "malformed" }],
    [{ BREAKER_FAILURE_THRESHOLD: "0" }],
    [{ TRUST_PROXY: "yes" }],
  ])("rejects invalid configuration %p", (env) => {
    expect(() => loadConfig(env)).toThrow();
  });
});
