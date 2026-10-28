import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import {
  CompositeClientIdentifier,
  DemoClientIdentifier,
  IpAddressIdentifier,
  UnauthorizedClientError,
} from "../../src/application/identity/identifiers";
import { LimiterPipelineBuilder } from "../../src/application/LimiterPipelineBuilder";
import { PolicyResolver } from "../../src/application/policy/PolicyResolver";
import { DefaultPolicyRule, RoutePolicyRule, TierPolicyRule } from "../../src/application/policy/rules";
import { RateLimiter } from "../../src/application/RateLimiter";
import { alwaysReachable } from "../../src/application/ReadinessProbe";
import { Policies } from "../../src/domain/RateLimitPolicy";
import { InMemoryAlgorithmFactory } from "../../src/infrastructure/memory/InMemoryAlgorithmFactory";
import { MetricsObserver } from "../../src/infrastructure/observability/MetricsObserver";
import { createApp } from "../../src/presentation/express/createApp";
import { noopLogger } from "../../src/shared/Logger";
import { ManualClock } from "../support/ManualClock";

const request = (headers: Record<string, string>) => ({ ip: "1.2.3.4", header: (name: string) => headers[name] });

describe("DemoClientIdentifier", () => {
  const identifier = new DemoClientIdentifier();

  it("ignores requests without a demo client header", () => {
    expect(identifier.identify(request({}))).toBeUndefined();
  });

  it("takes identity and tier from the headers", () => {
    expect(identifier.identify(request({ "x-demo-client-id": "abc-1", "x-demo-tier": "premium" }))).toEqual({
      id: "demo:abc-1",
      tier: "premium",
    });
  });

  it("defaults to the anonymous tier", () => {
    expect(identifier.identify(request({ "x-demo-client-id": "abc" }))?.tier).toBe("anonymous");
  });

  it("rejects malformed values", () => {
    expect(() => identifier.identify(request({ "x-demo-client-id": "bad id!" }))).toThrow(UnauthorizedClientError);
    expect(() => identifier.identify(request({ "x-demo-client-id": "ok", "x-demo-tier": "Premium;" }))).toThrow(
      UnauthorizedClientError,
    );
  });
});

describe("demo UI", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const limiter = new LimiterPipelineBuilder(new InMemoryAlgorithmFactory(new ManualClock())).build();
    const resolver = new PolicyResolver(
      new RoutePolicyRule(new Map()),
      new TierPolicyRule(new Map([["premium", Policies.tokenBucket("premium", 3, 0.001)]])),
      new DefaultPolicyRule(Policies.tokenBucket("default", 1, 0.001)),
    );
    const app = createApp({
      rateLimiter: new RateLimiter(resolver, limiter),
      identifier: new CompositeClientIdentifier(new DemoClientIdentifier(), new IpAddressIdentifier()),
      metrics: new MetricsObserver(),
      readiness: alwaysReachable,
      storeKind: "memory",
      logger: noopLogger,
      trustProxy: false,
      demoUiDir: fileURLToPath(new URL("../../public", import.meta.url)),
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => void server.close());

  it("serves the page and its assets", async () => {
    const page = await fetch(`${baseUrl}/`);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("Distributed Rate Limiter");
    expect((await fetch(`${baseUrl}/app.js`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/styles.css`)).status).toBe(200);
  });

  it("limits each simulated client independently and exposes the policy header", async () => {
    const as = (id: string) => ({ "x-demo-client-id": id, "x-demo-tier": "premium" });
    const first = await fetch(`${baseUrl}/api/resource`, { headers: as("a") });
    expect(first.status).toBe(200);
    expect(first.headers.get("x-ratelimit-policy")).toBe("premium (token-bucket)");
    for (let i = 0; i < 2; i++) await fetch(`${baseUrl}/api/resource`, { headers: as("a") });
    expect((await fetch(`${baseUrl}/api/resource`, { headers: as("a") })).status).toBe(429);
    expect((await fetch(`${baseUrl}/api/resource`, { headers: as("b") })).status).toBe(200);
  });
});
