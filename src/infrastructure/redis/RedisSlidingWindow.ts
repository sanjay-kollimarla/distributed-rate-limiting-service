import type { SlidingWindowPolicy } from "../../domain/RateLimitPolicy";
import { LuaScript } from "./LuaScript";
import { RedisScriptAlgorithm } from "./RedisScriptAlgorithm";
import slidingWindowSource from "./scripts/sliding-window.lua" with { type: "text" };

export class RedisSlidingWindow extends RedisScriptAlgorithm<"sliding-window"> {
  readonly kind = "sliding-window";
  protected readonly script = new LuaScript(slidingWindowSource);

  protected argumentsFor(policy: SlidingWindowPolicy): ReadonlyArray<string | number> {
    return [policy.limit, policy.windowMs, crypto.randomUUID()];
  }
}
