import type { RateLimitPolicy } from "../../domain/RateLimitPolicy";
import type { PolicyRule, RateLimitContext } from "./PolicyResolver";

export class RoutePolicyRule implements PolicyRule {
  constructor(private readonly byRoute: ReadonlyMap<string, RateLimitPolicy>) {}

  resolve({ route }: RateLimitContext): RateLimitPolicy | undefined {
    return this.byRoute.get(route);
  }
}

export class TierPolicyRule implements PolicyRule {
  constructor(private readonly byTier: ReadonlyMap<string, RateLimitPolicy>) {}

  resolve({ client }: RateLimitContext): RateLimitPolicy | undefined {
    return this.byTier.get(client.tier);
  }
}

export class DefaultPolicyRule implements PolicyRule {
  constructor(private readonly policy: RateLimitPolicy) {}

  resolve(): RateLimitPolicy {
    return this.policy;
  }
}
