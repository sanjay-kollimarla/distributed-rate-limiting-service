import { fileURLToPath } from "node:url";
import { RedisClient } from "bun";
import { FailOpenLimiter } from "./application/decorators/FailOpenLimiter";
import { ObservableLimiter } from "./application/decorators/ObservableLimiter";
import { RateLimitEventBus } from "./application/events";
import {
  ApiKeyIdentifier,
  CompositeClientIdentifier,
  DemoClientIdentifier,
  IpAddressIdentifier,
} from "./application/identity/identifiers";
import { LimiterPipelineBuilder } from "./application/LimiterPipelineBuilder";
import { RateLimiter } from "./application/RateLimiter";
import { alwaysReachable, type ReadinessProbe } from "./application/ReadinessProbe";
import { type AppConfig, loadConfig } from "./config/config";
import { createPolicyResolver } from "./config/policies";
import type { AlgorithmFactory } from "./domain/RateLimitAlgorithm";
import { createPinoLogger } from "./infrastructure/logging/PinoLogger";
import { InMemoryAlgorithmFactory } from "./infrastructure/memory/InMemoryAlgorithmFactory";
import { LoggingObserver } from "./infrastructure/observability/LoggingObserver";
import { MetricsObserver } from "./infrastructure/observability/MetricsObserver";
import { BunRedisScriptExecutor } from "./infrastructure/redis/BunRedisScriptExecutor";
import { RedisAlgorithmFactory } from "./infrastructure/redis/RedisAlgorithmFactory";
import { RedisReadinessProbe } from "./infrastructure/redis/RedisReadinessProbe";
import { CircuitBreaker } from "./infrastructure/resilience/CircuitBreaker";
import { CircuitBreakerLimiter } from "./infrastructure/resilience/CircuitBreakerLimiter";
import { createApp } from "./presentation/express/createApp";
import { systemClock } from "./shared/Clock";

interface Store {
  readonly factory: AlgorithmFactory;
  readonly readiness: ReadinessProbe;
  close(): void;
}

function createStore(config: AppConfig): Store {
  if (config.store === "memory") {
    return { factory: new InMemoryAlgorithmFactory(systemClock), readiness: alwaysReachable, close: () => {} };
  }
  const client = new RedisClient(config.redisUrl);
  return {
    factory: new RedisAlgorithmFactory(new BunRedisScriptExecutor(client)),
    readiness: new RedisReadinessProbe(client),
    close: () => client.close(),
  };
}

/** Composition root: the only place where concrete classes are wired together. */
const config = loadConfig();
const logger = await createPinoLogger({ level: config.logLevel, pretty: config.logPretty });
const store = createStore(config);

const bus = new RateLimitEventBus();
const metrics = new MetricsObserver();
bus.subscribe(metrics);
bus.subscribe(new LoggingObserver(logger));

const limiter = new LimiterPipelineBuilder(store.factory)
  .with((inner) => new CircuitBreakerLimiter(inner, new CircuitBreaker(config.breaker, systemClock)))
  .with((inner) => new FailOpenLimiter(inner, bus))
  .with((inner) => new ObservableLimiter(inner, bus))
  .build();

const app = createApp({
  rateLimiter: new RateLimiter(createPolicyResolver(), limiter),
  identifier: new CompositeClientIdentifier(
    new ApiKeyIdentifier(config.apiKeys),
    ...(config.demoMode ? [new DemoClientIdentifier()] : []),
    new IpAddressIdentifier(),
  ),
  metrics,
  readiness: store.readiness,
  storeKind: config.store,
  logger,
  trustProxy: config.trustProxy,
  metricsToken: config.metricsToken,
  demoUiDir: config.demoMode ? fileURLToPath(new URL("../public", import.meta.url)) : undefined,
});

if (config.demoMode) {
  logger.warn("DEMO_MODE is on: clients may choose their own identity and tier. Never enable in production.");
}

// Starting degraded beats crash-looping: the limiter fails open and reconnects on its own.
const startup = await store.readiness.check();
if (!startup.reachable) {
  logger.warn("rate limit store unreachable at startup, running degraded (failing open)", {
    store: config.store,
    error: startup.error,
  });
}

const server = app.listen(config.port, () => {
  logger.info("listening", { port: config.port, store: config.store });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });

  const forceExit = setTimeout(() => {
    logger.error("graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceExit.unref();

  server.close(() => {
    store.close();
    process.exit(0);
  });
  server.closeIdleConnections();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => logger.error("unhandled rejection", { err: reason }));
process.on("uncaughtException", (error) => {
  logger.error("uncaught exception", { err: error });
  shutdown("uncaughtException");
});
