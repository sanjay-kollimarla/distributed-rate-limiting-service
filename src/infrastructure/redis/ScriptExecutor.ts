import type { LuaScript } from "./LuaScript";

/** Port: runs a Lua script against the shared store. */
export interface ScriptExecutor {
  run(script: LuaScript, keys: readonly string[], args: ReadonlyArray<string | number>): Promise<unknown>;
}
