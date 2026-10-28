import type { Limiter } from "../../domain/RateLimitAlgorithm";
import type { RateLimitDecision } from "../../domain/RateLimitDecision";
import type { RateLimitPolicy } from "../../domain/RateLimitPolicy";
import type { CircuitBreaker } from "./CircuitBreaker";

/** Protection Proxy: stops hammering a store that is already failing. */
export class CircuitBreakerLimiter implements Limiter {
  constructor(
    private readonly inner: Limiter,
    private readonly breaker: CircuitBreaker,
  ) {}

  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    return this.breaker.execute(() => this.inner.consume(key, policy));
  }
}
