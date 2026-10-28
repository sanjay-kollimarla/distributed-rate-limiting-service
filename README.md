# Distributed Rate Limiting Service

Centralized, Redis-backed rate limiter shared by every application instance. Token Bucket and Sliding Window
algorithms run as atomic Lua scripts, exposed through Express middleware with per-client, per-tier and per-route policies.

**Stack:** Bun, TypeScript, Express, Redis, Lua

## Quick start

```bash
bun install
docker compose up -d        # Redis
cp .env.example .env
bun run dev
```

```bash
bun test                    # unit + Redis integration (integration auto-skips without Redis)
bun run typecheck
bun run lint                # Biome; `bun run format` to fix
bun run load-test           # bun scripts/load-test.ts [url] [clients] [seconds]
docker compose --profile app up --build   # run the service itself in a container
```

Redis is published on host port **6380** so it cannot clash with a Redis already on 6379 (WSL, local installs).
Requires **Redis 7+** (the scripts read `TIME` and then write).

**Interactive demo:** open http://localhost:3000 (or your `PORT`). Send real requests, fire a burst of 30, and run a browser load test with up to 500 simulated clients, with a live chart, latency percentiles and the server's own counters. Deep links: `/?demo=burst`, `/?demo=steady`, `/?demo=abusive`, `/?demo=crowd`. The demo is enabled by `DEMO_MODE` (on unless `NODE_ENV=production`); it lets callers choose their own client identity and tier, so **never enable it in production**.

Or by hand: `curl -i localhost:3000/api/resource` (add `-H "x-api-key: demo-premium-key"` for the premium tier).
Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; denials are `429` with `Retry-After`.
An unknown `x-api-key` is rejected with `401` rather than silently treated as anonymous.

## Operations

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness. Always 200 while the process is up. |
| `GET /ready` | Reports store status. Returns 200 even when degraded: the limiter fails open, so a Redis outage must not pull healthy instances out of rotation. Alert on `status: "degraded"` instead. |
| `GET /metrics` | Prometheus text format. Set `METRICS_TOKEN` to require `Authorization: Bearer <token>`. |

None of these are rate limited.

**Logging:** structured JSON, one object per line (pino), ISO timestamps, level via `LOG_LEVEL`. `LOG_PRETTY` (on by default outside `NODE_ENV=production`, which the Docker image sets) switches to coloured human-readable output via pino-pretty, a dev dependency. Every request gets
an `x-request-id` (an inbound well-formed one is honoured), written to the access log and attached to every log line
produced while handling it (`AsyncLocalStorage`), so a denial or store failure can be traced to its request.
API keys and headers are never logged.

**Shutdown:** SIGINT/SIGTERM stop accepting connections, drain, close Redis, and force-exit after `SHUTDOWN_TIMEOUT_MS`.
**Startup:** an unreachable Redis is logged and the service starts degraded (fail open) instead of crash-looping.

## Known limits

- The in-memory store never evicts keys: development and tests only.
- Sliding window keeps one Redis entry per request in the window, so memory per client grows with the limit. Prefer token bucket for very high limits.
- While Redis is down, the first `BREAKER_FAILURE_THRESHOLD` requests each wait up to `REDIS_CALL_TIMEOUT_MS` before the breaker opens.
- Not tested against Redis Cluster; every script touches a single key, so it should be cluster-safe.

## Architecture

Dependencies point inward: `presentation`, `infrastructure` -> `application` -> `domain`. Only `src/main.ts` knows concrete classes.

```
src/
  domain/          policies, decisions, algorithm and limiter ports (no I/O, no framework)
  application/     RateLimiter facade, policy chain, identity, decorators, pipeline builder
  infrastructure/  redis (Lua + adapter), memory (tests/dev), resilience, observability
  presentation/    Express middleware and app
  config/          env parsing, policy catalogue
  main.ts          composition root
```

Request flow:

```
request -> ClientIdentifier -> PolicyResolver -> RateLimiter
        -> Observable -> FailOpen -> CircuitBreaker -> AlgorithmRouter -> Redis Lua (atomic)
```

### Correctness decisions

- **Atomicity:** each check is one Lua script, so concurrent instances cannot race (proved by the 500-concurrent-request integration tests).
- **One clock:** scripts use Redis `TIME`, so instance clock skew cannot change outcomes.
- **Fail open:** if Redis is slow or down, the circuit breaker trips and requests are admitted (and counted as failures in `/metrics`) rather than causing an outage.
- **Bounded keys:** every key gets a TTL, so idle clients cost no memory.
- **Same behaviour everywhere:** one contract test suite runs against both the in-memory and the Redis implementations.

### GoF patterns used, and where

| Pattern | Where | Why |
| --- | --- | --- |
| Strategy | `RateLimitAlgorithm`, `ClientIdentifier` | Interchangeable algorithms and identification schemes |
| Abstract Factory | `AlgorithmFactory` (Redis / in-memory) | Swap a whole family of algorithms per backend |
| Template Method | `RedisScriptAlgorithm` | Shared "run script, map reply" flow; subclasses provide script and args |
| Decorator | `ObservableLimiter`, `FailOpenLimiter` | Add cross-cutting behaviour without touching algorithms |
| Proxy | `CircuitBreakerLimiter` | Guards access to a failing store |
| State | `CircuitBreaker` (Closed / Open / HalfOpen) | Behaviour changes with state, no conditionals |
| Chain of Responsibility | `PolicyResolver` + `PolicyRule`s | Route -> tier -> default policy resolution |
| Composite | `CompositeClientIdentifier` | Several identifiers treated as one |
| Builder | `LimiterPipelineBuilder` | Ordered assembly of the decorator stack |
| Facade | `RateLimiter` | One simple entry point over resolver + limiter |
| Adapter | `BunRedisScriptExecutor`, `toClientRequest` | Isolate Bun's Redis client and Express from the core |
| Observer | `RateLimitEventBus` + `LoggingObserver`, `MetricsObserver` | Decoupled logging and metrics |
| Adapter (again) | `PinoLogger`, `RedisReadinessProbe` | Logging library and Redis stay behind ports |
| Factory Method | `Policies.tokenBucket(...)` | Validated construction of policies |

Deliberately **not** used, because nothing here needs them: Singleton (the composition root passes a single instance
instead of global state), Prototype, Flyweight, Bridge, Command, Iterator, Interpreter, Mediator, Memento, Visitor.
Forcing them in would add indirection without a problem to solve.

## Adding things

- **New algorithm:** add a policy type to `RateLimitPolicy`; the compiler then points at every factory and the router that needs it.
- **New policy rule or identifier:** implement `PolicyRule` / `ClientIdentifier` and add it in `config/`.
- **New cross-cutting concern:** write a `Limiter` decorator and add one `.with(...)` line in `main.ts`.

## Configuration

See `.env.example` (copy it to `.env`; Bun loads it automatically). `TRUST_PROXY=true` only behind a trusted proxy, otherwise client IPs can be spoofed via `X-Forwarded-For`.
`RATE_LIMIT_STORE=memory` runs without Redis (single instance, development only).

## Free hosting (Render)

1. Push this repo to GitHub.
2. In Render choose **New > Blueprint** and select the repo. `render.yaml` creates the web service and a free Redis-compatible Key Value store on Render's private network, and wires `REDIS_URL` between them.
3. Open the Render URL. The status chip at the top should say `store: Redis up`.

Notes: the free web service sleeps after ~15 minutes idle, so the first visit can take about a minute; an uptime monitor pinging `/health` every 5 minutes keeps it awake.
The demo page caps load at 500 requests/sec. `TRUST_PROXY=1` trusts exactly one proxy hop (Render's load balancer).
`RATE_LIMIT_STORE=memory` also works for a single instance, but it never evicts keys and does not exercise Redis or the Lua scripts, so use it for local development only.
