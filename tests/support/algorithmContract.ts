import { describe, expect, it } from "bun:test";
import type { AlgorithmSet } from "../../src/domain/RateLimitAlgorithm";
import { Policies } from "../../src/domain/RateLimitPolicy";

/**
 * Behaviour every backend must share. Run against the in-memory and the Redis
 * implementations so they cannot drift apart.
 */
export function describeAlgorithmContract(
  backend: string,
  create: () => AlgorithmSet,
  advance: (ms: number) => Promise<void>,
): void {
  const unique = () => `rl:test:${crypto.randomUUID()}`;

  describe(`${backend}: token bucket`, () => {
    const policy = Policies.tokenBucket("tb", 3, 1);

    it("allows up to capacity, then denies with a retry hint", async () => {
      const { "token-bucket": bucket } = create();
      const key = unique();
      for (const remaining of [2, 1, 0]) {
        const decision = await bucket.consume(key, policy);
        expect(decision.allowed).toBe(true);
        expect(decision.remaining).toBe(remaining);
      }
      const denied = await bucket.consume(key, policy);
      expect(denied.allowed).toBe(false);
      expect(denied.retryAfterMs).toBeGreaterThan(0);
      expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
    });

    it("refills over time", async () => {
      const { "token-bucket": bucket } = create();
      const key = unique();
      for (let i = 0; i < 3; i++) await bucket.consume(key, policy);
      await advance(1100);
      expect((await bucket.consume(key, policy)).allowed).toBe(true);
    });

    it("isolates keys", async () => {
      const { "token-bucket": bucket } = create();
      const [a, b] = [unique(), unique()];
      for (let i = 0; i < 3; i++) await bucket.consume(a, policy);
      expect((await bucket.consume(a, policy)).allowed).toBe(false);
      expect((await bucket.consume(b, policy)).allowed).toBe(true);
    });
  });

  describe(`${backend}: sliding window`, () => {
    const policy = Policies.slidingWindow("sw", 2, 1000);

    it("allows up to the limit within a window, then denies", async () => {
      const { "sliding-window": window } = create();
      const key = unique();
      expect((await window.consume(key, policy)).remaining).toBe(1);
      expect((await window.consume(key, policy)).remaining).toBe(0);
      const denied = await window.consume(key, policy);
      expect(denied.allowed).toBe(false);
      expect(denied.retryAfterMs).toBeGreaterThan(0);
      expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
    });

    it("admits again once old requests leave the window", async () => {
      const { "sliding-window": window } = create();
      const key = unique();
      await window.consume(key, policy);
      await window.consume(key, policy);
      await advance(1100);
      expect((await window.consume(key, policy)).allowed).toBe(true);
    });

    it("does not allow a burst across a fixed-window boundary", async () => {
      const { "sliding-window": window } = create();
      const key = unique();
      await window.consume(key, policy);
      await window.consume(key, policy);
      await advance(600);
      expect((await window.consume(key, policy)).allowed).toBe(false);
    });
  });
}
