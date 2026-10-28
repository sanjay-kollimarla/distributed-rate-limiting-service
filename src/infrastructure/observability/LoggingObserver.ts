import type { RateLimitEvent, RateLimitObserver } from "../../application/events";
import type { Logger } from "../../shared/Logger";

/** Logs only what needs attention: denials and store failures. */
export class LoggingObserver implements RateLimitObserver {
  constructor(private readonly logger: Logger) {}

  onEvent(event: RateLimitEvent): void {
    if (event.type === "failure") {
      this.logger.error("rate limit store failure, failing open", {
        key: event.key,
        policy: event.policy.name,
        err: event.error,
      });
    } else if (!event.decision.allowed) {
      this.logger.info("request rate limited", {
        key: event.key,
        policy: event.policy.name,
        retryAfterMs: event.decision.retryAfterMs,
      });
    }
  }
}
