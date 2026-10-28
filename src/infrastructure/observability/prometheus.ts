import type { MetricsSnapshot } from "./MetricsObserver";

export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

/** Renders the snapshot in the Prometheus text exposition format. */
export function renderPrometheus(snapshot: MetricsSnapshot): string {
  const decisions = Object.entries(snapshot.byPolicy).flatMap(([policy, counts]) => {
    const label = escapeLabel(policy);
    return [
      `rate_limit_decisions_total{policy="${label}",outcome="allowed"} ${counts.allowed}`,
      `rate_limit_decisions_total{policy="${label}",outcome="denied"} ${counts.denied}`,
    ];
  });

  return `${[
    "# HELP rate_limit_decisions_total Rate limit decisions by policy and outcome.",
    "# TYPE rate_limit_decisions_total counter",
    ...decisions,
    "# HELP rate_limit_store_failures_total Store failures that caused requests to fail open.",
    "# TYPE rate_limit_store_failures_total counter",
    `rate_limit_store_failures_total ${snapshot.failures}`,
  ].join("\n")}\n`;
}
