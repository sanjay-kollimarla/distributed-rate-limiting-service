import { describe, expect, it } from "bun:test";
import { CircuitBreaker, CircuitOpenError } from "../../src/infrastructure/resilience/CircuitBreaker";
import { ManualClock } from "../support/ManualClock";

const options = { failureThreshold: 2, resetTimeoutMs: 1000, callTimeoutMs: 50 };
const failing = () => Promise.reject(new Error("boom"));
const succeeding = () => Promise.resolve("ok");

function openBreaker() {
  const clock = new ManualClock();
  const breaker = new CircuitBreaker(options, clock);
  return { clock, breaker };
}

async function trip(breaker: CircuitBreaker): Promise<void> {
  for (let i = 0; i < options.failureThreshold; i++) await breaker.execute(failing).catch(() => {});
}

describe("CircuitBreaker", () => {
  it("passes calls through while closed", async () => {
    const { breaker } = openBreaker();
    expect(await breaker.execute(succeeding)).toBe("ok");
  });

  it("opens after the failure threshold and rejects without calling", async () => {
    const { breaker } = openBreaker();
    await trip(breaker);
    let called = false;
    const probe = async () => {
      called = true;
    };
    await expect(breaker.execute(probe)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(called).toBe(false);
  });

  it("counts timeouts as failures", async () => {
    const { breaker } = openBreaker();
    const slow = () => new Promise<string>((resolve) => setTimeout(resolve, 200));
    for (let i = 0; i < options.failureThreshold; i++) await breaker.execute(slow).catch(() => {});
    await expect(breaker.execute(succeeding)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("closes again when the half-open probe succeeds", async () => {
    const { breaker, clock } = openBreaker();
    await trip(breaker);
    clock.advance(options.resetTimeoutMs);
    expect(await breaker.execute(succeeding)).toBe("ok");
    expect(await breaker.execute(succeeding)).toBe("ok");
  });

  it("re-opens when the half-open probe fails", async () => {
    const { breaker, clock } = openBreaker();
    await trip(breaker);
    clock.advance(options.resetTimeoutMs);
    await breaker.execute(failing).catch(() => {});
    await expect(breaker.execute(succeeding)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("allows only one probe while half-open", async () => {
    const { breaker, clock } = openBreaker();
    await trip(breaker);
    clock.advance(options.resetTimeoutMs);
    const probe = breaker.execute(() => new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 20)));
    await expect(breaker.execute(succeeding)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(await probe).toBe("ok");
  });
});
