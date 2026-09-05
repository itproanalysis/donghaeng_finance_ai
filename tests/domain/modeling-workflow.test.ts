import { describe, expect, it } from "vitest";
import { getModelingBundle, getModelingCase } from "@/server/modeling-demo";
import { EMPTY_REVIEW, getCaseGoal, getScoreChanges, readReviewDraft } from "@/domain/modeling-workflow";

describe("modeling follow-up review", () => {
  it("distinguishes a measurable goal from an undecided or missing one", () => {
    const goal = getCaseGoal(getModelingCase("case_operating_drop")!);
    expect(goal).toMatchObject({ ready: true, direction: "INCREASE", feature: { code: "biz_operating_day_count_avg_3m" }, target: { value: 29 } });
    expect(getCaseGoal(getModelingCase("case_no_answer")!).ready).toBe(false);
    expect(getCaseGoal(getModelingCase("case_operating_drop_after")!).ready).toBe(false);
    expect(getCaseGoal(getModelingCase("case_cost_pressure")!).direction).toBe("DECREASE");
  });

  it("uses only new months and the last three months to substantiate the follow-up goal", () => {
    const { reevaluation } = getModelingBundle();
    expect(reevaluation.monthlyRecords).toHaveLength(6);
    expect(reevaluation.monthlyRecords.every((row) => row.month > reevaluation.baselineAsOf.slice(0, 7))).toBe(true);
    const included = reevaluation.monthlyRecords.filter((row) => row.includedInGoal);
    expect(included).toHaveLength(3);
    expect(included).toEqual(reevaluation.monthlyRecords.slice(-3));
    expect(included.reduce((sum, row) => sum + row.operatingDays, 0) / 3).toBeCloseTo(reevaluation.after as number, 10);
  });

  it("retains excluded plan points and changed denominator in reassessment", () => {
    const before = getModelingCase("case_operating_drop")!;
    const after = getModelingCase("case_operating_drop_after")!;
    expect(getScoreChanges(before, after)).toContainEqual(expect.objectContaining({
      name: "계획의 현실성", before: expect.objectContaining({ points: 20, excluded: false }),
      after: expect.objectContaining({ points: null, excluded: true }),
    }));
    expect(after.scorecard.improvement.accounting.availablePoints).toBe(60);
    expect(before.scorecard.improvement.accounting.availablePoints).toBe(80);
    expect(getScoreChanges(before, before)).toEqual([]);
  });

  it("rejects corrupted or obsolete local drafts without inventing completed review", () => {
    for (const raw of [null, "{", "null", "[]", JSON.stringify({ version: 2 }), JSON.stringify({ ...EMPTY_REVIEW, updatedAt: "invalid" })]) {
      expect(readReviewDraft(raw)).toEqual(EMPTY_REVIEW);
    }
    const draft = readReviewDraft(JSON.stringify({ ...EMPTY_REVIEW, note: "확인할 자료", disposition: "NEEDS_INFORMATION", updatedAt: "2026-09-05T02:00:00.000Z" }));
    expect(draft).toMatchObject({ disposition: "NEEDS_INFORMATION", note: "확인할 자료", goalConfirmed: false, recordsReviewed: false });
    expect(readReviewDraft(JSON.stringify({ ...draft, note: "x".repeat(2500) })).note).toHaveLength(2000);
  });
});
