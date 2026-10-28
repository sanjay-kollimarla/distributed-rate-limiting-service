import type { RedisClient } from "bun";
import type { LuaScript } from "./LuaScript";
import type { ScriptExecutor } from "./ScriptExecutor";

/** Adapter: Bun's native Redis client -> ScriptExecutor. */
export class BunRedisScriptExecutor implements ScriptExecutor {
  constructor(private readonly client: RedisClient) {}

  async run(script: LuaScript, keys: readonly string[], args: ReadonlyArray<string | number>): Promise<unknown> {
    const tail = [String(keys.length), ...keys, ...args.map(String)];
    try {
      return await this.client.send("EVALSHA", [script.sha, ...tail]);
    } catch (error) {
      if (!String(error).includes("NOSCRIPT")) throw error;
      // EVAL also populates the server's script cache, so later calls use EVALSHA again.
      return this.client.send("EVAL", [script.source, ...tail]);
    }
  }
}
