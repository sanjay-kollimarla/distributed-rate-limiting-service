import type { RedisClient } from "bun";
import type { ReadinessProbe, StoreStatus } from "../../application/ReadinessProbe";
import { withTimeout } from "../../shared/timeout";

export class RedisReadinessProbe implements ReadinessProbe {
  constructor(
    private readonly client: RedisClient,
    private readonly timeoutMs = 2000,
  ) {}

  async check(): Promise<StoreStatus> {
    try {
      await withTimeout(this.client.send("PING", []), this.timeoutMs);
      return { reachable: true };
    } catch (error) {
      return { reachable: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
