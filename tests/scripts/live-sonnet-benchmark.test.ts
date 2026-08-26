import { describe, expect, it } from "vitest";

import {
  BENCHMARK_INTERVIEW_COUNT,
  formatLiveSonnetBenchmarkSummary,
  MINIMUM_TOTAL_TURNS,
  nearestRankPercentile,
  normalizeLoopbackOrigin,
  parseBenchmarkArguments,
  summarizeLiveSonnetBenchmark,
  TURNS_PER_INTERVIEW,
} from "../../scripts/live-sonnet-benchmark";

describe("live Sonnet benchmark configuration", () => {
  it("accepts literal loopback HTTP origins only", () => {
    expect(normalizeLoopbackOrigin("http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000",
    );
    expect(normalizeLoopbackOrigin("http://localhost:3100/")).toBe(
      "http://localhost:3100",
    );
    expect(normalizeLoopbackOrigin("http://[::1]:3200")).toBe(
      "http://[::1]:3200",
    );

    for (const origin of [
      "https://127.0.0.1:3000",
      "http://127.0.0.2:3000",
      "http://example.com:3000",
      "http://user:password@127.0.0.1:3000",
      "http://127.0.0.1:3000/api",
      "http://127.0.0.1:3000?next=http://example.com",
      "http://127.0.0.1:3000/#fragment",
    ]) {
      expect(() => normalizeLoopbackOrigin(origin)).toThrow(
        "INVALID_LOOPBACK_ORIGIN",
      );
    }
  });

  it("keeps the CLI surface to an optional loopback origin", () => {
    expect(parseBenchmarkArguments([])).toEqual({
      origin: "http://127.0.0.1:3000",
    });
    expect(
      parseBenchmarkArguments(["--origin", "http://localhost:3010"]),
    ).toEqual({ origin: "http://localhost:3010" });
    expect(() => parseBenchmarkArguments(["--turns", "100"])).toThrow(
      "INVALID_ARGUMENTS",
    );
  });

  it("fixes the benchmark plan at two interviews and at least ten turns", () => {
    expect(BENCHMARK_INTERVIEW_COUNT).toBe(2);
    expect(MINIMUM_TOTAL_TURNS).toBeGreaterThanOrEqual(10);
    expect(TURNS_PER_INTERVIEW * BENCHMARK_INTERVIEW_COUNT).toBeGreaterThanOrEqual(
      MINIMUM_TOTAL_TURNS,
    );
  });
});

describe("live Sonnet benchmark statistics", () => {
  it("uses the nearest-rank percentile definition", () => {
    const values = [400, 100, 300, 200];
    expect(nearestRankPercentile(values, 0.5)).toBe(200);
    expect(nearestRankPercentile(values, 0.95)).toBe(400);
    expect(() => nearestRankPercentile([], 0.5)).toThrow(
      "INVALID_PERCENTILE_INPUT",
    );
  });

  it("reports only aggregate provider telemetry and excludes no-question completion from fallback rate", () => {
    const summary = summarizeLiveSonnetBenchmark([
      {
        provider: "anthropic",
        model: "claude-sonnet-5",
        stopReason: "tool_use",
        latencyMs: 1_000,
      },
      {
        provider: "deterministic",
        model: "local-realtime-fallback-v1",
        stopReason: "soft_deadline",
        latencyMs: 6_050,
      },
      {
        provider: "deterministic",
        model: "local-realtime-fallback-v1",
        stopReason: "no_question",
        latencyMs: 20,
      },
    ]);

    expect(summary).toEqual({
      provider: { anthropic: 1, deterministic: 2 },
      model: {
        "claude-sonnet-5": 1,
        "local-realtime-fallback-v1": 2,
      },
      stopReason: { no_question: 1, soft_deadline: 1, tool_use: 1 },
      latencyMs: { p50: 1_000, p95: 6_050 },
      fallbackRate: 0.5,
    });
    expect(Object.keys(summary)).toEqual([
      "provider",
      "model",
      "stopReason",
      "latencyMs",
      "fallbackRate",
    ]);
    expect(JSON.parse(formatLiveSonnetBenchmarkSummary(summary))).toEqual(
      summary,
    );
  });

  it("collapses unsafe provider dimensions instead of emitting arbitrary text", () => {
    const summary = summarizeLiveSonnetBenchmark([
      {
        provider: "secret\nvalue",
        model: "model with spaces",
        stopReason: null,
        latencyMs: 10,
      },
    ]);
    expect(summary.provider).toEqual({ unknown: 1 });
    expect(summary.model).toEqual({ unknown: 1 });
    expect(summary.stopReason).toEqual({ none: 1 });
  });
});
