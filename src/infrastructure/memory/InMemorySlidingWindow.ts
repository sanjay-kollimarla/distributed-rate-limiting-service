import type { RateLimitAlgorithm } from "../../domain/RateLimitAlgorithm";
import { RateLimitDecision } from "../../domain/RateLimitDecision";
import type { SlidingWindowPolicy } from "../../domain/RateLimitPolicy";
import type { Clock } from "../../shared/Clock";

/** Single-process sliding-window log. Mirrors the Lua script; for tests and local dev only. */
export class InMemorySlidingWindow implements RateLimitAlgorithm<"sliding-window"> {
  readonly kind = "sliding-window";
  private readonly logs = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  async consume(key: string, policy: SlidingWindowPolicy): Promise<RateLimitDecision> {
    const now = this.clock.now();
    const log = (this.logs.get(key) ?? []).filter((at) => at > now - policy.windowMs);

    const allowed = log.length < policy.limit;
    if (allowed) log.push(now);
    this.logs.set(key, log);

    const oldest = log[0] ?? now;
    const resetAfterMs = Math.max(0, oldest + policy.windowMs - now);
    return allowed
      ? RateLimitDecision.allow(policy.limit, policy.limit - log.length, resetAfterMs)
      : RateLimitDecision.deny(policy.limit, resetAfterMs, resetAfterMs);
  }
}
