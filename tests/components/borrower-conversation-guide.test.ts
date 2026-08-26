import { describe, expect, it } from "vitest";

import { buildBorrowerConversationGuide } from "@/components/borrower-conversation-guide";
import type { InformationItemView } from "@/components/api-adapter";

function item(
  infoCode: string,
  category: InformationItemView["category"],
  status: InformationItemView["status"],
): InformationItemView {
  return {
    id: infoCode,
    infoCode,
    label: infoCode,
    category,
    categoryLabel: category,
    priority: "P1",
    required: true,
    status,
    statusLabel: status,
    valueState: "MISSING",
    valueStateLabel: "없음",
    displayValue: null,
    verificationLabel: null,
    quality: null,
    updatedAt: null,
    bucket: "needed",
    evidenceIds: [],
    dataQualityScore: null,
    dataQualityGrade: null,
    dataQualitySource: null,
    dataQualityAsOf: null,
    dataQualitySummary: null,
  };
}

describe("borrower conversation guide", () => {
  it("shows a stable five-step journey from authoritative server categories", () => {
    const guide = buildBorrowerConversationGuide({
      informationItems: [
        item("sales", "CURRENT_STATE", "CONFIRMED"),
        item("costs", "CURRENT_STATE", "REFUSED"),
        item("plan", "IMPROVEMENT_INTENT", "ASKING"),
        item("outlook", "FUTURE_OUTLOOK", "NEEDED"),
        item("household", "HOUSEHOLD_STATE", "UNAVAILABLE"),
      ],
      currentQuestionInfoCode: "plan",
    });

    expect(guide.currentPhaseKey).toBe("IMPROVEMENT_INTENT");
    expect(guide.currentStep).toBe(2);
    expect(guide.totalSteps).toBe(5);
    expect(guide.ariaLabel).toBe("인터뷰 이야기 순서 2/5, 개선 방향");
    expect(guide.phases).toEqual([
      expect.objectContaining({ key: "CURRENT_STATE", state: "DONE", resolved: 2, total: 2 }),
      expect.objectContaining({ key: "IMPROVEMENT_INTENT", state: "CURRENT", resolved: 0, total: 1 }),
      expect.objectContaining({ key: "FUTURE_OUTLOOK", state: "UPCOMING" }),
      expect.objectContaining({ key: "HOUSEHOLD_STATE", state: "DONE", resolved: 1, total: 1 }),
      expect.objectContaining({ key: "REVIEW", state: "UPCOMING" }),
    ]);
  });

  it("treats confirmed and explicit terminal answers as resolved, but not collected values", () => {
    const guide = buildBorrowerConversationGuide({
      informationItems: [
        item("confirmed", "CURRENT_STATE", "CONFIRMED"),
        item("refused", "CURRENT_STATE", "REFUSED"),
        item("unavailable", "CURRENT_STATE", "UNAVAILABLE"),
        item("not-applicable", "CURRENT_STATE", "NOT_APPLICABLE"),
        item("collected", "CURRENT_STATE", "COLLECTED"),
      ],
      currentQuestionInfoCode: "collected",
    });

    expect(guide.phases[0]).toMatchObject({
      state: "CURRENT",
      resolved: 4,
      total: 5,
    });
  });

  it("moves to borrower review only after every item reaches a resolved state", () => {
    const informationItems = [
      item("sales", "CURRENT_STATE", "CONFIRMED"),
      item("plan", "IMPROVEMENT_INTENT", "REFUSED"),
      item("outlook", "FUTURE_OUTLOOK", "NOT_APPLICABLE"),
      item("household", "HOUSEHOLD_STATE", "UNAVAILABLE"),
    ];

    const guide = buildBorrowerConversationGuide({
      informationItems,
      currentQuestionInfoCode: null,
    });
    expect(guide.currentPhaseKey).toBe("REVIEW");
    expect(guide.currentStep).toBe(5);
    expect(guide.phases.at(-1)).toMatchObject({
      state: "CURRENT",
      resolved: 4,
      total: 4,
    });

    const unsettled = buildBorrowerConversationGuide({
      informationItems: [...informationItems, item("buffer", "HOUSEHOLD_STATE", "COLLECTED")],
      currentQuestionInfoCode: null,
    });
    expect(unsettled.currentPhaseKey).toBe("HOUSEHOLD_STATE");
    expect(unsettled.currentStep).toBe(4);
  });

  it("does not let untouched optional placeholders hold a completed journey in step one", () => {
    const requiredItems = [
      item("sales", "CURRENT_STATE", "CONFIRMED"),
      item("plan", "IMPROVEMENT_INTENT", "CONFIRMED"),
      item("outlook", "FUTURE_OUTLOOK", "CONFIRMED"),
      item("household", "HOUSEHOLD_STATE", "CONFIRMED"),
    ];
    const untouchedOptional = {
      ...item("platform", "CURRENT_STATE", "NEEDED"),
      required: false,
    };

    const completed = buildBorrowerConversationGuide({
      informationItems: [...requiredItems, untouchedOptional],
      currentQuestionInfoCode: null,
    });
    expect(completed.currentPhaseKey).toBe("REVIEW");
    expect(completed.phases[0]).toMatchObject({ resolved: 1, total: 1, state: "DONE" });
    expect(completed.phases.at(-1)).toMatchObject({ resolved: 4, total: 4, state: "CURRENT" });

    const engaged = buildBorrowerConversationGuide({
      informationItems: [
        ...requiredItems,
        { ...untouchedOptional, status: "ASKING" },
      ],
      currentQuestionInfoCode: "platform",
    });
    expect(engaged.currentPhaseKey).toBe("CURRENT_STATE");
    expect(engaged.phases[0]).toMatchObject({ resolved: 1, total: 2, state: "CURRENT" });
  });

  it("fails safely to the first phase when a snapshot has no item context", () => {
    const guide = buildBorrowerConversationGuide({
      informationItems: [],
      currentQuestionInfoCode: "unknown",
    });
    expect(guide.currentPhaseKey).toBe("CURRENT_STATE");
    expect(guide.phases[0].state).toBe("CURRENT");
    expect(guide.phases.slice(1).every((phase) => phase.state === "UPCOMING")).toBe(true);
  });
});
