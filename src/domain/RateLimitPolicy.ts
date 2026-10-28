import { InvalidPolicyError } from "./errors";

export interface TokenBucketPolicy {
  readonly algorithm: "token-bucket";
  readonly name: string;
  readonly capacity: number;
  readonly refillPerSecond: number;
}

export interface SlidingWindowPolicy {
  readonly algorithm: "sliding-window";
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

export type RateLimitPolicy = TokenBucketPolicy | SlidingWindowPolicy;
export type AlgorithmKind = RateLimitPolicy["algorithm"];
export type PolicyOf<K extends AlgorithmKind> = Extract<RateLimitPolicy, { algorithm: K }>;

function requirePositive(field: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidPolicyError(`${field} must be a positive number, received ${value}`);
  }
}

/** Factory methods: the only sanctioned way to build a valid policy. */
export const Policies = {
  tokenBucket(name: string, capacity: number, refillPerSecond: number): TokenBucketPolicy {
    requirePositive("capacity", capacity);
    requirePositive("refillPerSecond", refillPerSecond);
    const policy: TokenBucketPolicy = { algorithm: "token-bucket", name, capacity, refillPerSecond };
    return Object.freeze(policy);
  },

  slidingWindow(name: string, limit: number, windowMs: number): SlidingWindowPolicy {
    requirePositive("limit", limit);
    requirePositive("windowMs", windowMs);
    const policy: SlidingWindowPolicy = { algorithm: "sliding-window", name, limit, windowMs };
    return Object.freeze(policy);
  },
} as const;

export function limitOf(policy: RateLimitPolicy): number {
  switch (policy.algorithm) {
    case "token-bucket":
      return policy.capacity;
    case "sliding-window":
      return policy.limit;
  }
}
