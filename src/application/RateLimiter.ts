import type { Limiter } from "../domain/RateLimitAlgorithm";
import type { RateLimitDecision } from "../domain/RateLimitDecision";
import type { RateLimitPolicy } from "../domain/RateLimitPolicy";
import type { PolicyResolver, RateLimitContext } from "./policy/PolicyResolver";

export interface RateLimitVerdict {
  readonly policy: RateLimitPolicy;
  readonly decision: RateLimitDecision;
}

/** Facade: the single entry point for "may this client proceed?". */
export class RateLimiter {
  constructor(
    private readonly resolver: PolicyResolver,
    private readonly limiter: Limiter,
  ) {}

  async check(context: RateLimitContext): Promise<RateLimitVerdict> {
    const policy = this.resolver.resolve(context);
    const key = `rl:${policy.name}:${context.client.id}`;
    const decision = await this.limiter.consume(key, policy);
    return { policy, decision };
  }
}
