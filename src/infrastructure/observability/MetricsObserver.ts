import type { RateLimitEvent, RateLimitObserver } from "../../application/events";

export interface MetricsSnapshot {
  readonly allowed: number;
  readonly denied: number;
  readonly failures: number;
  readonly byPolicy: Readonly<Record<string, { allowed: number; denied: number }>>;
}

export class MetricsObserver implements RateLimitObserver {
  private allowed = 0;
  private denied = 0;
  private failures = 0;
  private readonly byPolicy = new Map<string, { allowed: number; denied: number }>();

  onEvent(event: RateLimitEvent): void {
    if (event.type === "failure") {
      this.failures += 1;
      return;
    }
    const counts = this.byPolicy.get(event.policy.name) ?? { allowed: 0, denied: 0 };
    if (event.decision.allowed) {
      this.allowed += 1;
      counts.allowed += 1;
    } else {
      this.denied += 1;
      counts.denied += 1;
    }
    this.byPolicy.set(event.policy.name, counts);
  }

  snapshot(): MetricsSnapshot {
    return {
      allowed: this.allowed,
      denied: this.denied,
      failures: this.failures,
      byPolicy: Object.fromEntries(this.byPolicy),
    };
  }
}
