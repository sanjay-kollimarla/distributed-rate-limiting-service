import type { RateLimitDecision } from "../domain/RateLimitDecision";
import type { RateLimitPolicy } from "../domain/RateLimitPolicy";

export type RateLimitEvent =
  | {
      readonly type: "decision";
      readonly key: string;
      readonly policy: RateLimitPolicy;
      readonly decision: RateLimitDecision;
    }
  | {
      readonly type: "failure";
      readonly key: string;
      readonly policy: RateLimitPolicy;
      readonly error: unknown;
    };

/** Observer. */
export interface RateLimitObserver {
  onEvent(event: RateLimitEvent): void;
}

/** Subject: a misbehaving observer must never affect request handling. */
export class RateLimitEventBus {
  private readonly observers = new Set<RateLimitObserver>();

  subscribe(observer: RateLimitObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  publish(event: RateLimitEvent): void {
    for (const observer of this.observers) {
      try {
        observer.onEvent(event);
      } catch {
        // Observers are best-effort by contract.
      }
    }
  }
}
