import type { Clock } from "../../src/shared/Clock";

export class ManualClock implements Clock {
  constructor(private current = 1_000_000) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
