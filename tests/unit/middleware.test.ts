import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ObservableLimiter } from "../../src/application/decorators/ObservableLimiter";
import { RateLimitEventBus } from "../../src/application/events";
import {
  ApiKeyIdentifier,
  CompositeClientIdentifier,
  IpAddressIdentifier,
} from "../../src/application/identity/identifiers";
import { LimiterPipelineBuilder } from "../../src/application/LimiterPipelineBuilder";
import { PolicyResolver } from "../../src/application/policy/PolicyResolver";
import { DefaultPolicyRule, RoutePolicyRule, TierPolicyRule } from "../../src/application/policy/rules";
import { RateLimiter } from "../../src/application/RateLimiter";
import type { ReadinessProbe } from "../../src/application/ReadinessProbe";
import { Policies } from "../../src/domain/RateLimitPolicy";
import { InMemoryAlgorithmFactory } from "../../src/infrastructure/memory/InMemoryAlgorithmFactory";
import { MetricsObserver } from "../../src/infrastructure/observability/MetricsObserver";
import { createApp } from "../../src/presentation/express/createApp";
import { noopLogger } from "../../src/shared/Logger";
import { ManualClock } from "../support/ManualClock";

let server: Server;
let baseUrl: string;
let storeUp = true;
const readiness: ReadinessProbe = { isStoreReachable: async () => storeUp };

beforeAll(async () => {
  const bus = new RateLimitEventBus();
  const metrics = new MetricsObserver();
  bus.subscribe(metrics);

  const limiter = new LimiterPipelineBuilder(new InMemoryAlgorithmFactory(new ManualClock()))
    .with((inner) => new ObservableLimiter(inner, bus))
    .build();

  const resolver = new PolicyResolver(
    new RoutePolicyRule(new Map([["POST /api/orders", Policies.slidingWindow("orders", 1, 60_000)]])),
    new TierPolicyRule(new Map([["premium", Policies.tokenBucket("premium", 5, 1)]])),
    new DefaultPolicyRule(Policies.tokenBucket("default", 2, 0.001)),
  );

  const app = createApp({
    rateLimiter: new RateLimiter(resolver, limiter),
    identifier: new CompositeClientIdentifier(
      new ApiKeyIdentifier(new Map([["vip-key", { id: "acme", tier: "premium" }]])),
      new IpAddressIdentifier(),
    ),
    metrics,
    readiness,
    storeKind: "memory",
    logger: noopLogger,
    trustProxy: false,
    metricsToken: "secret",
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => void server.close());

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${baseUrl}${path}`, { headers });

describe("rate limit middleware", () => {
  it("serves requests within the limit and reports headers", async () => {
    const res = await get("/api/resource", { "x-api-key": "vip-key" });
    expect(res.status).toBe(200);
    expect(res.headers.get("ratelimit-limit")).toBe("5");
    expect(res.headers.get("ratelimit-remaining")).toBe("4");
  });

  it("returns 429 with Retry-After once the limit is exhausted", async () => {
    // No API key: identified by IP and limited by the default policy (2 requests).
    expect((await get("/api/resource")).status).toBe(200);
    expect((await get("/api/resource")).status).toBe(200);
    const denied = await get("/api/resource");
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await denied.json()).toMatchObject({ error: "rate_limit_exceeded" });
  });

  it("rejects an unknown API key instead of silently downgrading the client", async () => {
    const res = await get("/api/resource", { "x-api-key": "typo-key" });
    expect(res.status).toBe(401);
  });

  it("applies route-specific policies before tier policies", async () => {
    const options = {
      method: "POST",
      headers: { "x-api-key": "vip-key", "content-type": "application/json" },
      body: "{}",
    };
    expect((await fetch(`${baseUrl}/api/orders`, options)).status).toBe(201);
    expect((await fetch(`${baseUrl}/api/orders`, options)).status).toBe(429);
  });
});

describe("operational endpoints", () => {
  it("lists the available endpoints at the root", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ service: "distributed-rate-limiting-service" });
  });

  it("are never rate limited", async () => {
    for (let i = 0; i < 10; i++) expect((await get("/health")).status).toBe(200);
  });

  it("echo a well-formed request id and replace a malformed one", async () => {
    expect((await get("/health", { "x-request-id": "abc-123" })).headers.get("x-request-id")).toBe("abc-123");
    const replaced = (await get("/health", { "x-request-id": "bad id with spaces" })).headers.get("x-request-id");
    expect(replaced).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reports degraded (but still 200) readiness when the store is down", async () => {
    storeUp = false;
    const res = await get("/ready");
    storeUp = true;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "degraded", storeKind: "memory", dependencies: { store: "down" } });
  });

  it("protects /metrics with the bearer token and serves Prometheus text", async () => {
    expect((await get("/metrics")).status).toBe(401);
    const res = await get("/metrics", { authorization: "Bearer secret" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toContain('rate_limit_decisions_total{policy="default",outcome="denied"}');
  });
});
