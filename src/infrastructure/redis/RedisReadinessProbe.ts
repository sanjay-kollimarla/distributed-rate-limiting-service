import type { RedisClient } from "bun";
import type { ReadinessProbe } from "../../application/ReadinessProbe";
import { withTimeout } from "../../shared/timeout";

export class RedisReadinessProbe implements ReadinessProbe {
  constructor(
    private readonly client: RedisClient,
    private readonly timeoutMs = 500,
  ) {}

  async isStoreReachable(): Promise<boolean> {
    try {
      await withTimeout(this.client.send("PING", []), this.timeoutMs);
      return true;
    } catch {
      return false;
    }
  }
}
