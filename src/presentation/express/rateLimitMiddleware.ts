import type { Request, RequestHandler, Response } from "express";
import type { ClientIdentifier, ClientIdentity, ClientRequest } from "../../application/identity/ClientIdentity";
import { UnauthorizedClientError } from "../../application/identity/identifiers";
import type { RateLimiter, RateLimitVerdict } from "../../application/RateLimiter";

export interface RateLimitMiddlewareOptions {
  readonly rateLimiter: RateLimiter;
  readonly identifier: ClientIdentifier;
}

/** Adapter: Express request -> transport-agnostic ClientRequest. */
function toClientRequest(req: Request): ClientRequest {
  return { ip: req.ip ?? "unknown", header: (name) => req.header(name) };
}

function toSeconds(ms: number): number {
  return Math.ceil(ms / 1000);
}

function writeHeaders(res: Response, { policy, decision }: RateLimitVerdict): void {
  res.setHeader("X-RateLimit-Policy", `${policy.name} (${policy.algorithm})`);
  res.setHeader("RateLimit-Limit", decision.limit);
  res.setHeader("RateLimit-Remaining", decision.remaining);
  res.setHeader("RateLimit-Reset", toSeconds(decision.resetAfterMs));
  if (!decision.allowed) res.setHeader("Retry-After", toSeconds(decision.retryAfterMs));
}

/** Returns the client, or answers the request itself (401/400) and returns undefined. */
function identifyOrReject(identifier: ClientIdentifier, req: Request, res: Response): ClientIdentity | undefined {
  try {
    const client = identifier.identify(toClientRequest(req));
    if (!client) res.status(400).json({ error: "unidentifiable_client" });
    return client;
  } catch (error) {
    if (error instanceof UnauthorizedClientError) {
      res.status(401).json({ error: "invalid_api_key" });
      return undefined;
    }
    throw error;
  }
}

export function rateLimitMiddleware({ rateLimiter, identifier }: RateLimitMiddlewareOptions): RequestHandler {
  return async (req, res, next) => {
    const client = identifyOrReject(identifier, req, res);
    if (!client) return;

    const verdict = await rateLimiter.check({ client, route: `${req.method} ${req.baseUrl}${req.path}` });
    writeHeaders(res, verdict);
    const { decision } = verdict;

    if (decision.allowed) {
      next();
      return;
    }
    res.status(429).json({ error: "rate_limit_exceeded", retryAfterSeconds: toSeconds(decision.retryAfterMs) });
  };
}
