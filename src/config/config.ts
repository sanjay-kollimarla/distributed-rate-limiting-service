import type { ClientIdentity } from "../application/identity/ClientIdentity";
import type { LogLevel } from "../infrastructure/logging/PinoLogger";
import type { CircuitBreakerOptions } from "../infrastructure/resilience/CircuitBreaker";

type Env = Readonly<Record<string, string | undefined>>;

export interface AppConfig {
  readonly port: number;
  readonly store: "redis" | "memory";
  readonly redisUrl: string;
  /** `true` trusts every proxy hop; a number trusts that many hops (use 1 behind a single load balancer). */
  readonly trustProxy: boolean | number;
  readonly logLevel: LogLevel;
  readonly logPretty: boolean;
  readonly demoMode: boolean;
  readonly metricsToken: string | undefined;
  readonly shutdownTimeoutMs: number;
  readonly breaker: CircuitBreakerOptions;
  readonly apiKeys: ReadonlyMap<string, ClientIdentity>;
}

function integer(env: Env, name: string, fallback: number, min = 0): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < min) throw new Error(`${name} must be an integer >= ${min}, received "${raw}"`);
  return value;
}

function oneOf<T extends string>(env: Env, name: string, allowed: readonly T[], fallback: T): T {
  const raw = env[name] ?? fallback;
  const match = allowed.find((value) => value === raw);
  if (match === undefined) throw new Error(`${name} must be one of ${allowed.join(", ")}, received "${raw}"`);
  return match;
}

function trustProxy(raw: string | undefined): boolean | number {
  if (raw === undefined || raw === "false") return false;
  if (raw === "true") return true;
  const hops = Number.parseInt(raw, 10);
  if (Number.isNaN(hops) || hops < 1)
    throw new Error(`TRUST_PROXY must be true, false or a hop count >= 1, received "${raw}"`);
  return hops;
}

/** Parses "key=clientId:tier,key2=clientId2:tier2". */
function apiKeys(raw: string | undefined): ReadonlyMap<string, ClientIdentity> {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): [string, ClientIdentity] => {
      const [key, identity] = entry.split("=");
      const [id, tier] = (identity ?? "").split(":");
      if (!key || !id || !tier) throw new Error(`API_KEYS entry must look like key=clientId:tier, got "${entry}"`);
      return [key, { id, tier }];
    });
  return new Map(entries);
}

export function loadConfig(env: Env = Bun.env): AppConfig {
  return {
    port: integer(env, "PORT", 3000, 1),
    store: oneOf(env, "RATE_LIMIT_STORE", ["redis", "memory"], "redis"),
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    trustProxy: trustProxy(env.TRUST_PROXY),
    logLevel: oneOf(env, "LOG_LEVEL", ["debug", "info", "warn", "error", "silent"], "info"),
    logPretty: env.LOG_PRETTY === undefined ? env.NODE_ENV !== "production" : env.LOG_PRETTY === "true",
    demoMode: env.DEMO_MODE === undefined ? env.NODE_ENV !== "production" : env.DEMO_MODE === "true",
    metricsToken: env.METRICS_TOKEN || undefined,
    shutdownTimeoutMs: integer(env, "SHUTDOWN_TIMEOUT_MS", 10_000),
    breaker: {
      failureThreshold: integer(env, "BREAKER_FAILURE_THRESHOLD", 5, 1),
      resetTimeoutMs: integer(env, "BREAKER_RESET_TIMEOUT_MS", 10_000, 1),
      callTimeoutMs: integer(env, "REDIS_CALL_TIMEOUT_MS", 200, 1),
    },
    apiKeys: apiKeys(env.API_KEYS),
  };
}
