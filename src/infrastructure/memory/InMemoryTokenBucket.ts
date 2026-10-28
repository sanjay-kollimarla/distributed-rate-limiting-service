import type { RateLimitAlgorithm } from "../../domain/RateLimitAlgorithm";
import { RateLimitDecision } from "../../domain/RateLimitDecision";
import type { TokenBucketPolicy } from "../../domain/RateLimitPolicy";
import type { Clock } from "../../shared/Clock";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Single-process token bucket. Mirrors the Lua script; for tests and local dev only. */
export class InMemoryTokenBucket implements RateLimitAlgorithm<"token-bucket"> {
  readonly kind = "token-bucket";
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly clock: Clock) {}

  async consume(key: string, policy: TokenBucketPolicy): Promise<RateLimitDecision> {
    const now = this.clock.now();
    const bucket = this.buckets.get(key) ?? { tokens: policy.capacity, updatedAt: now };
    const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(policy.capacity, bucket.tokens + elapsedSeconds * policy.refillPerSecond);
    bucket.updatedAt = now;
    this.buckets.set(key, bucket);

    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;

    const resetAfterMs = Math.ceil(((policy.capacity - bucket.tokens) / policy.refillPerSecond) * 1000);
    if (allowed) {
      return RateLimitDecision.allow(policy.capacity, Math.floor(bucket.tokens), resetAfterMs);
    }
    const retryAfterMs = Math.ceil(((1 - bucket.tokens) / policy.refillPerSecond) * 1000);
    return RateLimitDecision.deny(policy.capacity, retryAfterMs, resetAfterMs);
  }
}
