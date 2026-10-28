import { afterAll, describe, expect, it } from "bun:test";
import { RedisClient } from "bun";
import { Policies } from "../../src/domain/RateLimitPolicy";
import { BunRedisScriptExecutor } from "../../src/infrastructure/redis/BunRedisScriptExecutor";
import { RedisAlgorithmFactory } from "../../src/infrastructure/redis/RedisAlgorithmFactory";
import { describeAlgorithmContract } from "../support/algorithmContract";

const client = new RedisClient(process.env.REDIS_URL ?? "redis://localhost:6379");
const redisAvailable = await client.connect().then(
  () => true,
  () => false,
);
afterAll(() => client.close());

const createAlgorithms = () => new RedisAlgorithmFactory(new BunRedisScriptExecutor(client)).createAlgorithms();
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!redisAvailable)("redis", () => {
  // Real time passes in Redis, so contract scenarios use real (short) waits.
  describeAlgorithmContract("redis", createAlgorithms, sleep);

  describe("atomicity under concurrency", () => {
    it("token bucket never admits more than capacity", async () => {
      const { "token-bucket": bucket } = createAlgorithms();
      const policy = Policies.tokenBucket("race-tb", 100, 0.001);
      const key = `rl:test:${crypto.randomUUID()}`;
      const results = await Promise.all(Array.from({ length: 500 }, () => bucket.consume(key, policy)));
      expect(results.filter((r) => r.allowed)).toHaveLength(100);
    });

    it("sliding window never admits more than the limit", async () => {
      const { "sliding-window": window } = createAlgorithms();
      const policy = Policies.slidingWindow("race-sw", 100, 60_000);
      const key = `rl:test:${crypto.randomUUID()}`;
      const results = await Promise.all(Array.from({ length: 500 }, () => window.consume(key, policy)));
      expect(results.filter((r) => r.allowed)).toHaveLength(100);
    });

    it("is shared across independent connections (simulated instances)", async () => {
      const other = new RedisClient(process.env.REDIS_URL ?? "redis://localhost:6379");
      try {
        const a = createAlgorithms()["sliding-window"];
        const b = new RedisAlgorithmFactory(new BunRedisScriptExecutor(other)).createAlgorithms()["sliding-window"];
        const policy = Policies.slidingWindow("shared", 10, 60_000);
        const key = `rl:test:${crypto.randomUUID()}`;
        const results = await Promise.all(
          Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? a : b).consume(key, policy)),
        );
        expect(results.filter((r) => r.allowed)).toHaveLength(10);
      } finally {
        other.close();
      }
    });
  });
});
