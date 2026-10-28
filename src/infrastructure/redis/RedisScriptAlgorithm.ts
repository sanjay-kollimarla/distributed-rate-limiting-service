import type { RateLimitAlgorithm } from "../../domain/RateLimitAlgorithm";
import { RateLimitDecision } from "../../domain/RateLimitDecision";
import { type AlgorithmKind, limitOf, type PolicyOf } from "../../domain/RateLimitPolicy";
import type { LuaScript } from "./LuaScript";
import type { ScriptExecutor } from "./ScriptExecutor";

export class UnexpectedScriptReplyError extends Error {
  override readonly name = "UnexpectedScriptReplyError";
}

type ScriptReply = readonly [allowed: number, remaining: number, retryAfterMs: number, resetAfterMs: number];

function parseReply(raw: unknown): ScriptReply {
  const isReply = Array.isArray(raw) && raw.length === 4 && raw.every((value) => typeof value === "number");
  if (!isReply) {
    throw new UnexpectedScriptReplyError(`Unexpected script reply: ${JSON.stringify(raw)}`);
  }
  return raw as unknown as ScriptReply;
}

/**
 * Template Method: the invariant flow (run script atomically, map reply to a
 * decision) lives here; subclasses supply the script and its arguments.
 */
export abstract class RedisScriptAlgorithm<K extends AlgorithmKind> implements RateLimitAlgorithm<K> {
  abstract readonly kind: K;
  protected abstract readonly script: LuaScript;
  protected abstract argumentsFor(policy: PolicyOf<K>): ReadonlyArray<string | number>;

  constructor(private readonly executor: ScriptExecutor) {}

  async consume(key: string, policy: PolicyOf<K>): Promise<RateLimitDecision> {
    const raw = await this.executor.run(this.script, [key], this.argumentsFor(policy));
    const [allowed, remaining, retryAfterMs, resetAfterMs] = parseReply(raw);
    const limit = limitOf(policy);
    return allowed === 1
      ? RateLimitDecision.allow(limit, remaining, resetAfterMs)
      : RateLimitDecision.deny(limit, retryAfterMs, resetAfterMs);
  }
}
