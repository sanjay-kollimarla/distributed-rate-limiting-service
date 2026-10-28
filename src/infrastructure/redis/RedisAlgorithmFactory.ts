import type { AlgorithmFactory, AlgorithmSet } from "../../domain/RateLimitAlgorithm";
import { RedisSlidingWindow } from "./RedisSlidingWindow";
import { RedisTokenBucket } from "./RedisTokenBucket";
import type { ScriptExecutor } from "./ScriptExecutor";

export class RedisAlgorithmFactory implements AlgorithmFactory {
  constructor(private readonly executor: ScriptExecutor) {}

  createAlgorithms(): AlgorithmSet {
    return {
      "token-bucket": new RedisTokenBucket(this.executor),
      "sliding-window": new RedisSlidingWindow(this.executor),
    };
  }
}
