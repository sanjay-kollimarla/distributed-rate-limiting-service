import type { AlgorithmFactory, AlgorithmSet } from "../../domain/RateLimitAlgorithm";
import type { Clock } from "../../shared/Clock";
import { InMemorySlidingWindow } from "./InMemorySlidingWindow";
import { InMemoryTokenBucket } from "./InMemoryTokenBucket";

export class InMemoryAlgorithmFactory implements AlgorithmFactory {
  constructor(private readonly clock: Clock) {}

  createAlgorithms(): AlgorithmSet {
    return {
      "token-bucket": new InMemoryTokenBucket(this.clock),
      "sliding-window": new InMemorySlidingWindow(this.clock),
    };
  }
}
