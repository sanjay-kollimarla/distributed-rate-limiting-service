import type { Clock } from "../../shared/Clock";
import { withTimeout } from "../../shared/timeout";

export interface CircuitBreakerOptions {
  readonly failureThreshold: number;
  readonly resetTimeoutMs: number;
  readonly callTimeoutMs: number;
}

export class CircuitOpenError extends Error {
  override readonly name = "CircuitOpenError";
}

/** State pattern: each state decides how calls and their outcomes are handled. */
interface BreakerState {
  beforeCall(breaker: CircuitBreaker): void;
  onSuccess(breaker: CircuitBreaker): void;
  onFailure(breaker: CircuitBreaker): void;
}

class ClosedState implements BreakerState {
  private failures = 0;

  beforeCall(): void {}

  onSuccess(): void {
    this.failures = 0;
  }

  onFailure(breaker: CircuitBreaker): void {
    this.failures += 1;
    if (this.failures >= breaker.options.failureThreshold) {
      breaker.transitionTo(new OpenState(breaker.clock.now()));
    }
  }
}

class OpenState implements BreakerState {
  constructor(private readonly openedAt: number) {}

  beforeCall(breaker: CircuitBreaker): void {
    if (breaker.clock.now() - this.openedAt < breaker.options.resetTimeoutMs) {
      throw new CircuitOpenError("Circuit is open");
    }
    breaker.transitionTo(new HalfOpenState(true)); // this call is the probe
  }

  onSuccess(): void {}
  onFailure(): void {}
}

/** Lets exactly one probe call through; its outcome closes or re-opens the circuit. */
class HalfOpenState implements BreakerState {
  constructor(private probing = false) {}

  beforeCall(): void {
    if (this.probing) throw new CircuitOpenError("Circuit is half-open, probe in flight");
    this.probing = true;
  }

  onSuccess(breaker: CircuitBreaker): void {
    breaker.transitionTo(new ClosedState());
  }

  onFailure(breaker: CircuitBreaker): void {
    breaker.transitionTo(new OpenState(breaker.clock.now()));
  }
}

export class CircuitBreaker {
  private state: BreakerState = new ClosedState();

  constructor(
    readonly options: CircuitBreakerOptions,
    readonly clock: Clock,
  ) {}

  transitionTo(state: BreakerState): void {
    this.state = state;
  }

  async execute<T>(call: () => Promise<T>): Promise<T> {
    this.state.beforeCall(this);
    const current = this.state;
    try {
      const result = await withTimeout(call(), this.options.callTimeoutMs);
      current.onSuccess(this);
      return result;
    } catch (error) {
      current.onFailure(this);
      throw error;
    }
  }
}
