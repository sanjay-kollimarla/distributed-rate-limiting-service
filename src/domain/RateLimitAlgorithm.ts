import type { RateLimitDecision } from "./RateLimitDecision";
import type { AlgorithmKind, PolicyOf, RateLimitPolicy } from "./RateLimitPolicy";

/** Strategy: one rate-limiting algorithm for one kind of policy. */
export interface RateLimitAlgorithm<K extends AlgorithmKind = AlgorithmKind> {
  readonly kind: K;
  consume(key: string, policy: PolicyOf<K>): Promise<RateLimitDecision>;
}

/** Exhaustive by construction: adding a new AlgorithmKind breaks every factory until it is supported. */
export type AlgorithmSet = { readonly [K in AlgorithmKind]: RateLimitAlgorithm<K> };

/** Abstract Factory: creates the whole family of algorithms for one backend. */
export interface AlgorithmFactory {
  createAlgorithms(): AlgorithmSet;
}

/** Port the rest of the system talks to; decorators and routers all implement it. */
export interface Limiter {
  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision>;
}
