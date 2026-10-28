import { describe, expect, it } from "bun:test";
import { RateLimitDecision } from "../../src/domain/RateLimitDecision";
import { Policies } from "../../src/domain/RateLimitPolicy";
import { LoggingObserver } from "../../src/infrastructure/observability/LoggingObserver";
import { MetricsObserver } from "../../src/infrastructure/observability/MetricsObserver";
import { renderPrometheus } from "../../src/infrastructure/observability/prometheus";
import type { LogFields, Logger } from "../../src/shared/Logger";

const policy = Policies.tokenBucket('weird"name', 1, 1);

function recordingLogger() {
  const lines: Array<{ level: string; message: string; fields?: LogFields | undefined }> = [];
  const at = (level: string) => (message: string, fields?: LogFields) => void lines.push({ level, message, fields });
  const logger: Logger = { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
  return { lines, logger };
}

describe("LoggingObserver", () => {
  it("logs denials at info and store failures at error, but not allowed requests", () => {
    const { lines, logger } = recordingLogger();
    const observer = new LoggingObserver(logger);
    observer.onEvent({ type: "decision", key: "k", policy, decision: RateLimitDecision.allow(1, 0, 0) });
    observer.onEvent({ type: "decision", key: "k", policy, decision: RateLimitDecision.deny(1, 500, 500) });
    observer.onEvent({ type: "failure", key: "k", policy, error: new Error("down") });
    expect(lines.map((line) => line.level)).toEqual(["info", "error"]);
    expect(lines[1]?.fields?.err).toBeInstanceOf(Error);
  });
});

describe("Prometheus exposition", () => {
  it("renders counters and escapes label values", () => {
    const metrics = new MetricsObserver();
    metrics.onEvent({ type: "decision", key: "k", policy, decision: RateLimitDecision.allow(1, 0, 0) });
    metrics.onEvent({ type: "failure", key: "k", policy, error: new Error("x") });
    const text = renderPrometheus(metrics.snapshot());
    expect(text).toContain('rate_limit_decisions_total{policy="weird\\"name",outcome="allowed"} 1');
    expect(text).toContain("rate_limit_store_failures_total 1");
    expect(text.endsWith("\n")).toBe(true);
  });
});
