import { describe, expect, it } from "bun:test";
import { FailOpenLimiter } from "../../src/application/decorators/FailOpenLimiter";
import { type RateLimitEvent, RateLimitEventBus } from "../../src/application/events";
import type { Limiter } from "../../src/domain/RateLimitAlgorithm";
import { Policies } from "../../src/domain/RateLimitPolicy";

describe("FailOpenLimiter", () => {
  it("admits the request and reports the failure when the store is down", async () => {
    const events: RateLimitEvent[] = [];
    const bus = new RateLimitEventBus();
    bus.subscribe({ onEvent: (event) => events.push(event) });
    const broken: Limiter = { consume: () => Promise.reject(new Error("redis down")) };

    const decision = await new FailOpenLimiter(broken, bus).consume("k", Policies.tokenBucket("p", 10, 1));

    expect(decision.allowed).toBe(true);
    expect(events.map((event) => event.type)).toEqual(["failure"]);
  });

  it("does not let a failing observer break request handling", async () => {
    const bus = new RateLimitEventBus();
    bus.subscribe({
      onEvent: () => {
        throw new Error("observer bug");
      },
    });
    const broken: Limiter = { consume: () => Promise.reject(new Error("redis down")) };

    const decision = await new FailOpenLimiter(broken, bus).consume("k", Policies.tokenBucket("p", 10, 1));
    expect(decision.allowed).toBe(true);
  });
});
