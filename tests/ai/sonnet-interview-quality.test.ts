import { describe, expect, it, vi } from "vitest";

import {
  ClaudeInterviewTurnPlanner,
  type ClaudeRealtimePhrasingWireOutput,
} from "../../src/ai/claude-interview-providers";
import type {
  AnthropicMessagesClient,
  ClaudeCallMetadata,
} from "../../src/ai/anthropic-messages";
import {
  createDevV1AcceptanceRequiredInformationItems,
  createDevV1RequiredInformationItems,
  planDeterministicInterviewTurn,
  selectEligibleNextQuestions,
  type InformationItem,
  type InformationStatus,
  type OrchestratorTurnInput,
  type ProposedInformationTransition,
} from "../../src/domain";
import { SONNET_QUALITY_CORPUS } from "../fixtures/sonnet-interview-quality-corpus";

const metadata: ClaudeCallMetadata = {
  provider: "anthropic",
  model: "claude-sonnet-5",
  requestId: "req_sonnet-quality-corpus",
  inputTokens: 120,
  outputTokens: 24,
  stopReason: "tool_use",
};

function informationItems(
  options: {
    acceptance?: boolean;
    statuses?: Readonly<Record<string, InformationStatus>>;
  } = {},
): InformationItem[] {
  const definitions = options.acceptance
    ? createDevV1AcceptanceRequiredInformationItems()
    : createDevV1RequiredInformationItems();
  return definitions.map((definition, index) => ({
    ...definition,
    status: options.statuses?.[definition.infoCode] ?? definition.status,
    valueState: "MISSING",
    value: null,
    quality: null,
    extractionConfidence: null,
    verification: null,
    evidenceIds: [],
    prefill: null,
    updatedAt: `2026-08-15T00:00:${String(index).padStart(2, "0")}.000Z`,
  }));
}

function clientReturning(
  output: ClaudeRealtimePhrasingWireOutput,
): AnthropicMessagesClient {
  return {
    provider: "anthropic",
    model: metadata.model,
    timeoutMs: 5_000,
    maxTokens: 192,
    createToolResult: vi.fn(async () => ({
      input: { ...output } as Record<string, unknown>,
      metadata,
    })),
  };
}

function validOutput(
  selectedInfoCode: string,
  overrides: Partial<ClaudeRealtimePhrasingWireOutput> = {},
): ClaudeRealtimePhrasingWireOutput {
  return {
    selectedInfoCode,
    reaction: SONNET_QUALITY_CORPUS.validPhrasing.reaction,
    question: SONNET_QUALITY_CORPUS.validPhrasing.modelQuestion,
    ...overrides,
  };
}

function projectStatuses(
  items: InformationItem[],
  transitions: readonly ProposedInformationTransition[],
): InformationItem[] {
  const finalStatus = new Map<string, InformationStatus>();
  for (const transition of transitions) {
    finalStatus.set(transition.infoCode, transition.to);
  }
  return items.map((item) => ({
    ...item,
    status: finalStatus.get(item.infoCode) ?? item.status,
  }));
}

describe("Sonnet 5 interview quality corpus", () => {
  it("keeps a neutral business answer free of unsupported industry assumptions", async () => {
    const input: OrchestratorTurnInput = {
      text: SONNET_QUALITY_CORPUS.neutralBusiness.answer,
      currentInfoCode: "monthly_average_sales",
      informationItems: informationItems(),
    };
    const deterministic = planDeterministicInterviewTurn(input);
    expect(deterministic.nextQuestion?.infoCode).toBe("fixed_operating_costs");

    const client = clientReturning(validOutput("fixed_operating_costs"));
    const result = await new ClaudeInterviewTurnPlanner(client).plan(input);
    const request = vi.mocked(client.createToolResult).mock.calls[0][0];
    const serializedRequest = JSON.stringify(request.user);

    expect(result.metadata).toEqual(metadata);
    expect(request.tool.inputSchema).toMatchObject({
      properties: {
        selectedInfoCode: {
          enum: [
            "fixed_operating_costs",
            "improvement_plan",
            "confirmed_reservations",
          ],
        },
      },
    });
    for (const unsupported of SONNET_QUALITY_CORPUS.neutralBusiness
      .unsupportedIndustryTerms) {
      expect(serializedRequest).not.toContain(unsupported);
      expect(result.plan.nextQuestion?.text).not.toContain(unsupported);
    }

    const assumedIndustry = clientReturning(
      validOutput("fixed_operating_costs", {
        reaction: "카페 매출 흐름을 확인했어요.",
      }),
    );
    const rejected = await new ClaudeInterviewTurnPlanner(assumedIndustry).plan(input);
    expect(rejected.plan).toEqual(deterministic);
    expect(rejected.metadata).toMatchObject({
      provider: "deterministic",
      stopReason: "provider_failure",
    });
  });

  it("extracts facts already volunteered and never asks for either fact again", async () => {
    const input: OrchestratorTurnInput = {
      text: SONNET_QUALITY_CORPUS.incidentalFacts.answer,
      currentInfoCode: "monthly_average_sales",
      informationItems: informationItems(),
    };
    const deterministic = planDeterministicInterviewTurn(input);
    expect(deterministic.extractedItems.map((item) => item.infoCode)).toEqual(
      expect.arrayContaining([
        ...SONNET_QUALITY_CORPUS.incidentalFacts.answeredInfoCodes,
      ]),
    );
    expect(deterministic.nextQuestion?.infoCode).toBe(
      SONNET_QUALITY_CORPUS.incidentalFacts.expectedNextInfoCode,
    );

    const client = clientReturning(validOutput("improvement_plan"));
    const result = await new ClaudeInterviewTurnPlanner(client).plan(input);
    const request = vi.mocked(client.createToolResult).mock.calls[0][0];
    const allowedCodes = (
      request.user as {
        allowedCandidates: Array<{ infoCode: string }>;
      }
    ).allowedCandidates.map((candidate) => candidate.infoCode);

    expect(allowedCodes).toEqual([
      "improvement_plan",
      "confirmed_reservations",
      "seasonality_outlook",
    ]);
    expect(allowedCodes).not.toContain("monthly_average_sales");
    expect(allowedCodes).not.toContain("fixed_operating_costs");
    expect(result.plan.nextQuestion?.infoCode).toBe("improvement_plan");
  });

  it("makes conflict and follow-up mandatory before ordinary candidates", () => {
    const baseStatuses = {
      monthly_average_sales: "CONFIRMED",
      fixed_operating_costs: "CONFIRMED",
      repeat_customer_share: "CONFLICT",
      improvement_plan: "NEEDS_FOLLOWUP",
    } as const;
    const withConflict = informationItems({
      acceptance: true,
      statuses: baseStatuses,
    });
    expect(
      selectEligibleNextQuestions(withConflict).map((question) => ({
        infoCode: question.infoCode,
        reason: question.reason,
      })),
    ).toEqual([{ infoCode: "repeat_customer_share", reason: "CONFLICT" }]);

    const withFollowup = informationItems({
      acceptance: true,
      statuses: { ...baseStatuses, repeat_customer_share: "CONFIRMED" },
    });
    expect(
      selectEligibleNextQuestions(withFollowup).map((question) => ({
        infoCode: question.infoCode,
        reason: question.reason,
      })),
    ).toEqual([{ infoCode: "improvement_plan", reason: "FOLLOWUP" }]);
  });

  it("stays within the current business phase and leaves household questions last", () => {
    const afterSales = informationItems({
      statuses: { monthly_average_sales: "CONFIRMED" },
    });
    const afterSalesCandidates = selectEligibleNextQuestions(afterSales);
    expect(afterSalesCandidates.map((item) => item.infoCode)).toEqual([
      "fixed_operating_costs",
      "improvement_plan",
      "confirmed_reservations",
    ]);
    expect(afterSalesCandidates).toHaveLength(3);
    expect(
      afterSalesCandidates.map(
        (candidate) =>
          afterSales.find((item) => item.infoCode === candidate.infoCode)?.category,
      ),
    ).not.toContain("HOUSEHOLD_STATE");

    const afterCurrentState = informationItems({
      statuses: {
        monthly_average_sales: "CONFIRMED",
        fixed_operating_costs: "CONFIRMED",
      },
    });
    expect(selectEligibleNextQuestions(afterCurrentState).map((item) => item.infoCode))
      .toEqual([
        "improvement_plan",
        "confirmed_reservations",
        "seasonality_outlook",
      ]);

    const onlyHouseholdRemains = informationItems({
      statuses: {
        monthly_average_sales: "CONFIRMED",
        fixed_operating_costs: "CONFIRMED",
        improvement_plan: "CONFIRMED",
        execution_readiness: "CONFIRMED",
        confirmed_reservations: "CONFIRMED",
        seasonality_outlook: "CONFIRMED",
      },
    });
    expect(
      selectEligibleNextQuestions(onlyHouseholdRemains).map(
        (question) => question.infoCode,
      ),
    ).toEqual(["essential_household_expenses"]);
  });

  it("rejects a model code outside the server allowlist and uses the deterministic fallback", async () => {
    const input: OrchestratorTurnInput = {
      text: SONNET_QUALITY_CORPUS.neutralBusiness.answer,
      currentInfoCode: "monthly_average_sales",
      informationItems: informationItems(),
    };
    const deterministic = planDeterministicInterviewTurn(input);
    const client = clientReturning(validOutput("execution_readiness"));

    const result = await new ClaudeInterviewTurnPlanner(client).plan(input);
    expect(result.plan).toEqual(deterministic);
    expect(result.metadata).toMatchObject({
      provider: "deterministic",
      model: "local-realtime-fallback-v1",
      stopReason: "provider_failure",
    });
  });

  it("fails closed when a fluent reaction contradicts the answer without adding a number or industry", async () => {
    const input: OrchestratorTurnInput = {
      text: SONNET_QUALITY_CORPUS.semanticHallucination.answer,
      currentInfoCode: "monthly_average_sales",
      informationItems: informationItems(),
    };
    const deterministic = planDeterministicInterviewTurn(input);
    expect(deterministic.nextQuestion).toMatchObject({
      infoCode: "monthly_average_sales",
      reason: "FOLLOWUP",
    });

    const client = clientReturning(
      validOutput("monthly_average_sales", {
        reaction:
          SONNET_QUALITY_CORPUS.semanticHallucination.unsupportedReaction,
      }),
    );
    const result = await new ClaudeInterviewTurnPlanner(client).plan(input);

    expect(result.plan).toEqual(deterministic);
    expect(result.metadata).toMatchObject({
      provider: "deterministic",
      model: "local-realtime-fallback-v1",
      stopReason: "provider_failure",
    });
  });

  it("rejects arbitrary fluent reactions and exposes only server-owned neutral acknowledgements", async () => {
    const input: OrchestratorTurnInput = {
      text: SONNET_QUALITY_CORPUS.neutralBusiness.answer,
      currentInfoCode: "monthly_average_sales",
      informationItems: informationItems(),
    };
    const deterministic = planDeterministicInterviewTurn(input);
    const canonicalQuestion = deterministic.nextQuestion?.text;
    expect(canonicalQuestion).toBeTruthy();

    const boundaryReaction = "가".repeat(32);
    const arbitraryClient = clientReturning(
      validOutput("fixed_operating_costs", {
        reaction: boundaryReaction,
        question: "고정 운영비도 이어서 알려주실 수 있을까요?",
      }),
    );
    const rejectedArbitrary = await new ClaudeInterviewTurnPlanner(
      arbitraryClient,
    ).plan(input);
    expect(rejectedArbitrary.plan).toEqual(deterministic);
    expect(rejectedArbitrary.metadata).toMatchObject({
      provider: "deterministic",
      stopReason: "provider_failure",
    });
    const requestSchema = vi.mocked(
      arbitraryClient.createToolResult,
    ).mock.calls[0][0].tool.inputSchema as {
      properties: { reaction: unknown };
    };
    const reactionSchema = requestSchema.properties.reaction;
    expect(reactionSchema).toMatchObject({
      enum: [
        "",
        "말씀하신 내용을 확인했어요.",
        "알려주신 내용을 정리했어요.",
        "말씀해 주셔서 고마워요.",
        "그 내용을 바탕으로 이어갈게요.",
      ],
    });
    expect(JSON.stringify(reactionSchema)).not.toContain("매출");
    expect(canonicalQuestion).toBe(deterministic.nextQuestion?.text);

    const tooLong = await new ClaudeInterviewTurnPlanner(
      clientReturning(
        validOutput("fixed_operating_costs", {
          reaction: "가".repeat(33),
        }),
      ),
    ).plan(input);
    expect(tooLong.plan).toEqual(deterministic);
    expect(tooLong.metadata).toMatchObject({ stopReason: "provider_failure" });
  });

  for (const scenario of SONNET_QUALITY_CORPUS.clarificationBoundaries) {
    it(`asks at most one clarification for an explicit ${scenario.name}`, () => {
      const activeInfoCode = "essential_household_expenses";
      const initialItems = informationItems({
        statuses: {
          monthly_average_sales: "CONFIRMED",
          fixed_operating_costs: "CONFIRMED",
          improvement_plan: "CONFIRMED",
          execution_readiness: "CONFIRMED",
          confirmed_reservations: "CONFIRMED",
          seasonality_outlook: "CONFIRMED",
          [activeInfoCode]: "ASKING",
        },
      });
      const first = planDeterministicInterviewTurn({
        text: scenario.firstAnswer,
        currentInfoCode: activeInfoCode,
        informationItems: initialItems,
      });
      expect(first.extractedItems[0]).toMatchObject({
        infoCode: activeInfoCode,
        proposedStatus: "NEEDS_FOLLOWUP",
        valueState: "UNKNOWN",
      });
      expect(first.nextQuestion).toMatchObject({
        infoCode: activeInfoCode,
        reason: "FOLLOWUP",
      });

      const second = planDeterministicInterviewTurn({
        text: scenario.secondAnswer,
        currentInfoCode: activeInfoCode,
        informationItems: projectStatuses(initialItems, first.stateChanges),
        followupExhaustedInfoCodes: [activeInfoCode],
      });
      expect(second.extractedItems[0]).toMatchObject({
        infoCode: activeInfoCode,
        proposedStatus: scenario.expectedTerminalStatus,
        valueState: scenario.expectedTerminalValueState,
      });
      expect(second.nextQuestion?.infoCode).not.toBe(activeInfoCode);
      expect(second.stateChanges.at(-1)?.to).toBe(
        scenario.expectedTerminalStatus,
      );
    });
  }
});
