/** Immutable value object describing the outcome of one rate-limit check. */
export class RateLimitDecision {
  private constructor(
    readonly allowed: boolean,
    readonly limit: number,
    readonly remaining: number,
    readonly retryAfterMs: number,
    readonly resetAfterMs: number,
  ) {}

  static allow(limit: number, remaining: number, resetAfterMs: number): RateLimitDecision {
    return new RateLimitDecision(true, limit, remaining, 0, resetAfterMs);
  }

  static deny(limit: number, retryAfterMs: number, resetAfterMs: number): RateLimitDecision {
    return new RateLimitDecision(false, limit, 0, retryAfterMs, resetAfterMs);
  }

  /** Null Object used when limiting is bypassed (fail-open). */
  static unrestricted(limit: number): RateLimitDecision {
    return new RateLimitDecision(true, limit, limit, 0, 0);
  }
}
