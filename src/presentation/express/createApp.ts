import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { ClientIdentifier } from "../../application/identity/ClientIdentity";
import type { RateLimiter } from "../../application/RateLimiter";
import type { ReadinessProbe } from "../../application/ReadinessProbe";
import type { MetricsObserver } from "../../infrastructure/observability/MetricsObserver";
import { PROMETHEUS_CONTENT_TYPE, renderPrometheus } from "../../infrastructure/observability/prometheus";
import type { Logger } from "../../shared/Logger";
import { rateLimitMiddleware } from "./rateLimitMiddleware";
import { requestLogging } from "./requestLogging";

export interface AppDependencies {
  readonly rateLimiter: RateLimiter;
  readonly identifier: ClientIdentifier;
  readonly metrics: MetricsObserver;
  readonly readiness: ReadinessProbe;
  /** Reported by /ready so the demo never claims Redis when running in memory. */
  readonly storeKind: "redis" | "memory";
  readonly logger: Logger;
  /** Set only behind a trusted proxy, otherwise client IPs can be spoofed. */
  readonly trustProxy: boolean | number;
  /** When set, /metrics requires `Authorization: Bearer <token>`. */
  readonly metricsToken?: string | undefined;
  /** Serves the interactive demo UI at "/" from this directory. Demo mode only. */
  readonly demoUiDir?: string | undefined;
}

function requireBearer(token: string | undefined): RequestHandler {
  return (req, res, next) => {
    if (token === undefined || req.header("authorization") === `Bearer ${token}`) {
      next();
      return;
    }
    res.status(401).json({ error: "unauthorized" });
  };
}

export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", deps.trustProxy);
  app.use(requestLogging(deps.logger));
  app.use(express.json({ limit: "100kb" }));

  if (deps.demoUiDir) app.use(express.static(deps.demoUiDir));

  app.get("/", (_req, res) => {
    res.json({
      service: "distributed-rate-limiting-service",
      endpoints: ["GET /api/resource", "POST /api/orders", "GET /health", "GET /ready", "GET /metrics"],
    });
  });

  // Operational endpoints are deliberately not rate limited.
  app.get("/health", (_req, res) => void res.json({ status: "ok" }));

  // Liveness vs readiness: the limiter fails open, so a store outage degrades the
  // service but must not make the orchestrator pull healthy instances out of rotation.
  app.get("/ready", async (_req, res) => {
    const storeUp = await deps.readiness.isStoreReachable();
    res.json({
      status: storeUp ? "ready" : "degraded",
      storeKind: deps.storeKind,
      dependencies: { store: storeUp ? "up" : "down" },
    });
  });

  app.get("/metrics", requireBearer(deps.metricsToken), (_req, res) => {
    res.type(PROMETHEUS_CONTENT_TYPE).send(renderPrometheus(deps.metrics.snapshot()));
  });

  app.use("/api", rateLimitMiddleware({ rateLimiter: deps.rateLimiter, identifier: deps.identifier }));

  app.get("/api/resource", (_req, res) => void res.json({ data: "ok" }));
  app.post("/api/orders", (req, res) => void res.status(201).json({ received: req.body ?? null }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    deps.logger.error("unhandled request error", { err: error });
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
