import { describe, expect, it } from "bun:test";
import { NoApplicablePolicyError, PolicyResolver } from "../../src/application/policy/PolicyResolver";
import { DefaultPolicyRule, RoutePolicyRule, TierPolicyRule } from "../../src/application/policy/rules";
import { InvalidPolicyError } from "../../src/domain/errors";
import { Policies } from "../../src/domain/RateLimitPolicy";

const routePolicy = Policies.slidingWindow("route", 1, 1000);
const tierPolicy = Policies.tokenBucket("tier", 5, 1);
const defaultPolicy = Policies.tokenBucket("default", 1, 1);

const resolver = new PolicyResolver(
  new RoutePolicyRule(new Map([["POST /api/orders", routePolicy]])),
  new TierPolicyRule(new Map([["premium", tierPolicy]])),
  new DefaultPolicyRule(defaultPolicy),
);

describe("PolicyResolver", () => {
  it("prefers the route rule over the tier rule", () => {
    const context = { client: { id: "c", tier: "premium" }, route: "POST /api/orders" };
    expect(resolver.resolve(context)).toBe(routePolicy);
  });

  it("falls through to the tier rule", () => {
    const context = { client: { id: "c", tier: "premium" }, route: "GET /api/x" };
    expect(resolver.resolve(context)).toBe(tierPolicy);
  });

  it("falls through to the default rule", () => {
    const context = { client: { id: "c", tier: "unknown" }, route: "GET /api/x" };
    expect(resolver.resolve(context)).toBe(defaultPolicy);
  });

  it("fails loudly when no rule applies", () => {
    const empty = new PolicyResolver();
    expect(() => empty.resolve({ client: { id: "c", tier: "t" }, route: "GET /" })).toThrow(NoApplicablePolicyError);
  });
});

describe("Policies", () => {
  it("rejects non-positive configuration", () => {
    expect(() => Policies.tokenBucket("bad", 0, 1)).toThrow(InvalidPolicyError);
    expect(() => Policies.slidingWindow("bad", 1, Number.NaN)).toThrow(InvalidPolicyError);
  });
});
