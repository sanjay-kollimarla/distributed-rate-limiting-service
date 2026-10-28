import type { Limiter } from "../../domain/RateLimitAlgorithm";
import { RateLimitDecision } from "../../domain/RateLimitDecision";
import { limitOf, type RateLimitPolicy } from "../../domain/RateLimitPolicy";
import type { RateLimitEventBus } from "../events";

/**
 * Decorator: the limiter is protection, not a dependency worth an outage.
 * If the backing store fails, requests are admitted and the failure is reported.
 */
export class FailOpenLimiter implements Limiter {
  constructor(
    private readonly inner: Limiter,
    private readonly bus: RateLimitEventBus,
  ) {}

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    try {
      return await this.inner.consume(key, policy);
    } catch (error) {
      this.bus.publish({ type: "failure", key, policy, error });
      return RateLimitDecision.unrestricted(limitOf(policy));
    }
  }
}
