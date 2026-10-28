import { PolicyResolver } from "../application/policy/PolicyResolver";
import { DefaultPolicyRule, RoutePolicyRule, TierPolicyRule } from "../application/policy/rules";
import { Policies } from "../domain/RateLimitPolicy";

/** Most specific rule first: route overrides, then client tier, then the global default. */
export function createPolicyResolver(): PolicyResolver {
  return new PolicyResolver(
    new RoutePolicyRule(new Map([["POST /api/orders", Policies.slidingWindow("orders-write", 10, 60_000)]])),
    new TierPolicyRule(
      new Map([
        ["premium", Policies.tokenBucket("tier-premium", 200, 100)],
        ["standard", Policies.tokenBucket("tier-standard", 50, 20)],
        ["anonymous", Policies.tokenBucket("tier-anonymous", 20, 5)],
      ]),
    ),
    new DefaultPolicyRule(Policies.tokenBucket("default", 20, 5)),
  );
}
