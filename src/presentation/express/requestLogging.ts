import type { RequestHandler } from "express";
import type { Logger } from "../../shared/Logger";
import { requestContext } from "../../shared/requestContext";

const SAFE_REQUEST_ID = /^[\w.-]{1,128}$/;

/** Assigns a correlation id (honouring a well-formed inbound one), exposes it, and writes one access log per request. */
export function requestLogging(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const inbound = req.header("x-request-id");
    const requestId = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : crypto.randomUUID();
    res.setHeader("x-request-id", requestId);

    const startedAt = performance.now();
    res.on("finish", () => {
      logger.info("request completed", {
        requestId,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });

    requestContext.run({ requestId }, next);
  };
}
