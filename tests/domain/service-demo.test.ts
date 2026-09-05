import { describe, expect, it } from "vitest";
import {
  demoMetrics,
  parseDemoSession,
  SAMPLE_DEMO,
} from "../../src/domain/service-demo";

describe("synthetic reviewer journey", () => {
  it("does not infer missing amounts or confuse an explicit zero with missing data", () => {
    expect(demoMetrics([]).available).toBeNull();
    expect(demoMetrics([0, 0, 0]).available).toBeNull();
    expect(demoMetrics([0, 0, 0, 2]).repayment).toBe(0);
    expect(demoMetrics([0, 0, 0, 2]).available).toBe(650);
  });
  it("recomputes the result from the selected answers, including negative balances", () => {
    expect(demoMetrics(SAMPLE_DEMO.answers).available).toBe(470);
    expect(demoMetrics([0, 1, 1, 1, 0, 0]).available).toBe(-200);
  });
  it("rejects malformed or out-of-range persisted choices and premature completion", () => {
    for (const raw of [
      '{"answers":[-1],"completed":true}',
      '{"answers":[99]}',
      '{"answers":[0.5]}',
      "null",
      "bad",
      '{"answers":[0,0,0,0,0,0,0]}',
    ])
      expect(parseDemoSession(raw)).toEqual({ answers: [], completed: false });
    expect(parseDemoSession('{"answers":[0],"completed":true}')).toEqual({
      answers: [0],
      completed: false,
    });
    expect(parseDemoSession(JSON.stringify(SAMPLE_DEMO))).toEqual(SAMPLE_DEMO);
  });
});
