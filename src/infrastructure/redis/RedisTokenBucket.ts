import type { TokenBucketPolicy } from "../../domain/RateLimitPolicy";
import { LuaScript } from "./LuaScript";
import { RedisScriptAlgorithm } from "./RedisScriptAlgorithm";
import tokenBucketSource from "./scripts/token-bucket.lua" with { type: "text" };

export class RedisTokenBucket extends RedisScriptAlgorithm<"token-bucket"> {
  readonly kind = "token-bucket";
  protected readonly script = new LuaScript(tokenBucketSource);

  protected argumentsFor(policy: TokenBucketPolicy): ReadonlyArray<string | number> {
    return [policy.capacity, policy.refillPerSecond];
  }
}
