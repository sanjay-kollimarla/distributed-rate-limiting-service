import type { Limiter } from "../../domain/RateLimitAlgorithm";
import type { RateLimitDecision } from "../../domain/RateLimitDecision";
import type { RateLimitPolicy } from "../../domain/RateLimitPolicy";
import type { RateLimitEventBus } from "../events";

/** Decorator: publishes every decision to observers. */
export class ObservableLimiter implements Limiter {
  constructor(
    private readonly inner: Limiter,
    private readonly bus: RateLimitEventBus,
  ) {}

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    const decision = await this.inner.consume(key, policy);
    this.bus.publish({ type: "decision", key, policy, decision });
    return decision;
  }
}
