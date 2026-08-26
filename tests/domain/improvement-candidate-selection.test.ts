import { describe, expect, it } from "vitest";

import {
  buildAllowlistedImprovementCandidates,
  improvementPlanCandidateDisplayValue,
  isAllowlistedImprovementChoice,
} from "@/domain/improvement-candidate-selection";

describe("borrower improvement candidate allowlist", () => {
  it("deterministically normalizes provenance and never promotes a suggestion", () => {
    const candidates = buildAllowlistedImprovementCandidates({
      goal: {
        status: "CONFIRMED",
        title: " 3개월 단골 기록 늘리기 ",
        evidenceIds: ["e-2", "e-1", "e-1"],
      },
      informationItems: [
        {
          infoCode: "improvement_plan",
          status: "CONFIRMED",
          updatedAt: "2026-08-13T00:00:00.000Z",
          evidenceIds: ["e-plan"],
          displayValue: "스탬프 적립 시작하기",
        },
      ],
    });

    expect(candidates[0]).toEqual({
      id: "confirmed-goal-candidate",
      title: "3개월 단골 기록 늘리기",
      origin: "CONFIRMED_GOAL",
      sourceInfoCodes: [],
      evidenceIds: ["e-1", "e-2"],
    });
    expect(candidates[1]).toMatchObject({
      id: "confirmed-improvement-plan-candidate",
      origin: "CONFIRMED_ANSWER",
    });
    expect(candidates).toHaveLength(3);
    expect(candidates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ confirmed: true }),
    ]));
  });

  it("requires every client field to match the regenerated candidate", () => {
    const candidates = buildAllowlistedImprovementCandidates({
      goal: null,
      informationItems: [],
    });
    expect(isAllowlistedImprovementChoice("SKIP", candidates)).toBe(true);
    expect(isAllowlistedImprovementChoice(candidates[0], candidates)).toBe(true);
    expect(isAllowlistedImprovementChoice({
      ...candidates[0],
      title: "서버가 만들지 않은 제목",
    }, candidates)).toBe(false);
    expect(isAllowlistedImprovementChoice({
      ...candidates[0],
      evidenceIds: ["client-invented-evidence"],
    }, candidates)).toBe(false);
  });

  it("uses the same confirmed plan title basis as the borrower UI", () => {
    expect(improvementPlanCandidateDisplayValue({
      kind: "IMPROVEMENT_PLAN",
      planExists: true,
      actions: [{ text: " POS로 폐기량 기록하기 " }],
      problem: "폐기 비용",
    })).toBe("POS로 폐기량 기록하기");
  });
});
