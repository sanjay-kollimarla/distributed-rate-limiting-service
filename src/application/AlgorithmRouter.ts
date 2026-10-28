import type { AlgorithmSet, Limiter } from "../domain/RateLimitAlgorithm";
import type { RateLimitDecision } from "../domain/RateLimitDecision";
import type { RateLimitPolicy } from "../domain/RateLimitPolicy";

/** Strategy context: selects the algorithm that matches the policy kind. */
export class AlgorithmRouter implements Limiter {
  constructor(private readonly algorithms: AlgorithmSet) {}

  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    switch (policy.algorithm) {
      case "token-bucket":
        return this.algorithms["token-bucket"].consume(key, policy);
      case "sliding-window":
        return this.algorithms["sliding-window"].consume(key, policy);
    }
  }
}
