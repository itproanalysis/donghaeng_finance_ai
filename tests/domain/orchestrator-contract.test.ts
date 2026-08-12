import { describe, expect, it } from "vitest";

import {
  InvalidOrchestratorOutputError,
  assertOrchestratorTurnPlan,
  createDefaultRequiredInformationItems,
  createValidatedOrchestratorProvider,
  planDeterministicInterviewTurn,
  validateOrchestratorTurnPlan,
  type DeterministicTurnPlan,
  type InformationItem,
  type OrchestratorTurnInput,
} from "../../src/domain";

function turnInput(): OrchestratorTurnInput {
  const informationItems: InformationItem[] = createDefaultRequiredInformationItems().map(
    (item, index) => ({
      ...item,
      valueState: "MISSING",
      value: null,
      quality: null,
      extractionConfidence: null,
      verification: null,
      evidenceIds: [],
      prefill: null,
      updatedAt: `2026-08-10T00:00:0${index}.000Z`,
    }),
  );
  return {
    text: "월평균 매출은 23,000,000원입니다.",
    currentInfoCode: "monthly_average_sales",
    informationItems,
  };
}

function validPlan(input = turnInput()): DeterministicTurnPlan {
  return planDeterministicInterviewTurn(input);
}

function issueCodes(output: unknown, input: OrchestratorTurnInput): string[] {
  return validateOrchestratorTurnPlan(output, input).map((issue) => issue.code);
}

describe("structured orchestrator output contract", () => {
  it("accepts the normal deterministic plan and its exact source evidence", () => {
    const input = turnInput();
    const plan = validPlan(input);

    expect(plan.extractedItems).toHaveLength(1);
    expect(validateOrchestratorTurnPlan(plan, input)).toEqual([]);
    expect(assertOrchestratorTurnPlan(plan, input)).toBe(plan);
    expect(plan.extractedItems[0].evidenceSpan.text).toBe(
      input.text.slice(
        plan.extractedItems[0].evidenceSpan.start,
        plan.extractedItems[0].evidenceSpan.end,
      ),
    );
  });

  it("rejects unknown and duplicate infoCodes, including an unknown next question", () => {
    const input = turnInput();
    const plan = structuredClone(validPlan(input));
    plan.extractedItems.push(structuredClone(plan.extractedItems[0]));
    plan.extractedItems[0].infoCode = "provider_invented_code";
    plan.extractedItems.push(structuredClone(plan.extractedItems[1]));
    if (plan.nextQuestion) plan.nextQuestion.infoCode = "provider_invented_code";

    expect(issueCodes(plan, input)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_INFO_CODE",
        "DUPLICATE_INFO_CODE",
        "UNKNOWN_NEXT_QUESTION_CODE",
      ]),
    );
  });

  it("rejects evidence whose bounds or quoted text do not match the source transcript", () => {
    const input = turnInput();
    const outOfBounds = structuredClone(validPlan(input));
    outOfBounds.extractedItems[0].evidenceSpan.end = input.text.length + 1;

    const wrongQuote = structuredClone(validPlan(input));
    wrongQuote.extractedItems[0].evidenceSpan.text = "다른 원문";

    expect(issueCodes(outOfBounds, input)).toContain("INVALID_EVIDENCE_SPAN");
    expect(issueCodes(wrongQuote, input)).toContain("EVIDENCE_TEXT_MISMATCH");
  });

  it("rejects a transition that skips the legal ASKING -> COLLECTED boundary", () => {
    const input = turnInput();
    const plan = structuredClone(validPlan(input));
    plan.stateChanges[0] = {
      ...plan.stateChanges[0],
      from: "ASKING",
      to: "CONFIRMED",
    };

    expect(issueCodes(plan, input)).toEqual(
      expect.arrayContaining(["ILLEGAL_STATE_TRANSITION", "TRANSITION_FROM_MISMATCH"]),
    );
  });

  it("fails closed on additional fields, invalid canonical data, and rewritten source text", () => {
    const input = turnInput();
    const plan = structuredClone(validPlan(input)) as DeterministicTurnPlan & {
      providerComment?: string;
    };
    plan.providerComment = "trust me";
    plan.text = `${input.text} rewritten`;
    const canonical = plan.extractedItems[0].value as unknown as Record<string, unknown>;
    canonical.providerScore = 0.99;
    const amount = canonical.amount as Record<string, unknown>;
    amount.value = -1;

    expect(issueCodes(plan, input)).toEqual(
      expect.arrayContaining([
        "ADDITIONAL_PROPERTY",
        "SOURCE_TEXT_MISMATCH",
        "NUMBER_OUT_OF_RANGE",
      ]),
    );
  });

  it("wraps malformed LLM JSON-shaped output in the typed validation error", () => {
    const input = turnInput();
    const provider = createValidatedOrchestratorProvider({
      plan: () => "{not valid structured output",
    });

    expect(() => provider.plan(input)).toThrow(InvalidOrchestratorOutputError);
    try {
      provider.plan(input);
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidOrchestratorOutputError);
      expect((error as InvalidOrchestratorOutputError).code).toBe(
        "INVALID_ORCHESTRATOR_OUTPUT",
      );
      expect((error as InvalidOrchestratorOutputError).issues[0].code).toBe("INVALID_TYPE");
    }
  });
});
