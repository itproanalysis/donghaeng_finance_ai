import { describe, expect, it } from "vitest";

import {
  applyBorrowerConversationFocus,
  BORROWER_CONVERSATION_FOCUS_OPTIONS,
  initialInfoCodeForBorrowerFocus,
} from "@/components/borrower-interview-preferences";
import { createDevV1AcceptanceRequiredInformationItems } from "@/domain/information-catalog";
import type { InformationItem } from "@/domain/interview";
import {
  questionSelectionContextAfterAnswer,
  selectNextQuestion,
} from "@/domain/question-selector";

function projectedItems(focus: Parameters<typeof applyBorrowerConversationFocus>[1]): InformationItem[] {
  return applyBorrowerConversationFocus(
    createDevV1AcceptanceRequiredInformationItems(),
    focus,
  ).map((item, index) => ({
    ...item,
    valueState: "MISSING",
    value: null,
    quality: null,
    extractionConfidence: null,
    verification: null,
    evidenceIds: [],
    prefill: null,
    updatedAt: `2026-08-19T00:00:${String(index).padStart(2, "0")}.000Z`,
  }));
}

function resolvedQuestionSequence(
  focus: Parameters<typeof applyBorrowerConversationFocus>[1],
): string[] {
  let items = projectedItems(focus);
  const sequence: string[] = [];
  let current = items.find((item) => item.status === "ASKING")?.infoCode ?? null;
  for (let turn = 0; current && turn < 20; turn += 1) {
    sequence.push(current);
    const answeredInfoCode = current;
    items = items.map((item) => item.infoCode === answeredInfoCode
      ? { ...item, status: "CONFIRMED" as const }
      : item.status === "ASKING"
        ? { ...item, status: "NEEDED" as const }
        : item);
    const next = selectNextQuestion(
      items,
      null,
      questionSelectionContextAfterAnswer(items, answeredInfoCode),
    );
    current = next?.infoCode ?? null;
    if (current) {
      items = items.map((item) => item.infoCode === current
        ? { ...item, status: "ASKING" as const }
        : item);
    }
  }
  return sequence;
}

describe("borrower interview preferences", () => {
  it("offers one recommended whole-review path and three user-led starting points", () => {
    expect(BORROWER_CONVERSATION_FOCUS_OPTIONS.map((option) => option.id)).toEqual([
      "FULL_REVIEW",
      "COSTS",
      "IMPROVEMENT",
      "FUTURE",
    ]);
    expect(BORROWER_CONVERSATION_FOCUS_OPTIONS.filter((option) => option.recommended))
      .toHaveLength(1);
    expect(initialInfoCodeForBorrowerFocus("FULL_REVIEW")).toBe("monthly_average_sales");
    expect(initialInfoCodeForBorrowerFocus("COSTS")).toBe("fixed_operating_costs");
    expect(initialInfoCodeForBorrowerFocus("IMPROVEMENT")).toBe("improvement_plan");
    expect(initialInfoCodeForBorrowerFocus("FUTURE")).toBe("confirmed_reservations");
  });

  it("changes only the first ASKING item while preserving the full catalog", () => {
    const original = createDevV1AcceptanceRequiredInformationItems();
    const focused = applyBorrowerConversationFocus(original, "IMPROVEMENT");

    expect(focused).toHaveLength(original.length);
    expect(focused.filter((item) => item.status === "ASKING").map((item) => item.infoCode))
      .toEqual(["improvement_plan"]);
    expect(focused.filter((item) => item.status === "NEEDED")).toHaveLength(original.length - 1);
    expect(focused.map((item) => item.infoCode)).toEqual(original.map((item) => item.infoCode));
    expect(focused.find((item) => item.infoCode === "platform_fee_pressure"))
      .toMatchObject({ required: false, priority: "P2", status: "NEEDED" });
  });

  it("falls back safely when a custom catalog lacks the preferred item", () => {
    const items = createDevV1AcceptanceRequiredInformationItems().filter(
      (item) => item.infoCode !== "confirmed_reservations",
    );
    const focused = applyBorrowerConversationFocus(items, "FUTURE");
    expect(focused.filter((item) => item.status === "ASKING").map((item) => item.infoCode))
      .toEqual(["monthly_average_sales"]);
  });

  it.each([
    ["FULL_REVIEW", [
      "monthly_average_sales",
      "fixed_operating_costs",
      "improvement_plan",
      "execution_readiness",
      "confirmed_reservations",
      "seasonality_outlook",
      "essential_household_expenses",
      "emergency_buffer_months",
    ]],
    ["COSTS", [
      "fixed_operating_costs",
      "monthly_average_sales",
      "improvement_plan",
      "execution_readiness",
      "confirmed_reservations",
      "seasonality_outlook",
      "essential_household_expenses",
      "emergency_buffer_months",
    ]],
    ["IMPROVEMENT", [
      "improvement_plan",
      "execution_readiness",
      "confirmed_reservations",
      "seasonality_outlook",
      "monthly_average_sales",
      "fixed_operating_costs",
      "essential_household_expenses",
      "emergency_buffer_months",
    ]],
    ["FUTURE", [
      "confirmed_reservations",
      "seasonality_outlook",
      "monthly_average_sales",
      "fixed_operating_costs",
      "improvement_plan",
      "execution_readiness",
      "essential_household_expenses",
      "emergency_buffer_months",
    ]],
  ] as const)("converges from %s without repeats or unsolicited optional questions", (focus, expected) => {
    const sequence = resolvedQuestionSequence(focus);
    expect(sequence).toEqual(expected);
    expect(new Set(sequence)).toHaveLength(8);
    expect(sequence).not.toContain("platform_fee_pressure");
    expect(sequence).not.toContain("hall_customer_decline");
    expect(sequence).not.toContain("repeat_customer_share");
  });
});
