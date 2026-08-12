import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it, vi } from "vitest";

import {
  CLAUDE_INTERVIEW_TURN_TOOL,
  CLAUDE_RUBRIC_TOOL,
  ClaudeInterviewTurnPlanner,
  ClaudeRubricClassifier,
  InvalidClaudeTurnWireOutputError,
  encodeClaudeTurnPlanWire,
  parseClaudeTurnPlanWire,
  type ClaudeTurnWireOutput,
} from "../../src/ai/claude-interview-providers";
import type {
  AnthropicMessagesClient,
  ClaudeCallMetadata,
} from "../../src/ai/anthropic-messages";
import {
  InvalidOrchestratorOutputError,
  createDevV1AcceptanceRequiredInformationItems,
  createDevV1RequiredInformationItems,
  planDeterministicInterviewTurn,
  type InformationItem,
  type OrchestratorTurnInput,
} from "../../src/domain";

const sampleBorrowerAnswerByInfoCode: Record<string, string> = {
  platform_fee_pressure: "배달 수수료와 광고비 부담이 큽니다.",
  hall_customer_decline: "최근 홀 손님이 줄었습니다.",
  repeat_customer_share: "최근 한 달 기준 단골 매출은 45%입니다.",
  monthly_average_sales: "최근 3개월 월평균 매출은 2,300만원입니다.",
  fixed_operating_costs: "월 고정 운영비는 1,100만원입니다.",
  improvement_plan: "직접주문을 18%에서 30%로 두 달 안에 늘리고 POS로 확인하겠습니다.",
  execution_readiness: "인력과 예산, 일정을 준비했습니다.",
  confirmed_reservations: "앞으로 4주 확정 예약은 6건입니다.",
  seasonality_outlook: "과거 매출과 예약을 보면 향후 3개월 수요가 늘 것으로 봅니다.",
  essential_household_expenses: "월 필수 가계지출은 320만원입니다.",
  emergency_buffer_months: "비상자금은 4개월입니다.",
};

const metadata: ClaudeCallMetadata = {
  provider: "anthropic",
  model: "claude-sonnet-5",
  requestId: "req_provider-test",
  inputTokens: 100,
  outputTokens: 40,
  stopReason: "tool_use",
};

function input(): OrchestratorTurnInput {
  const informationItems: InformationItem[] = createDevV1RequiredInformationItems().map(
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

function clientReturning(value: Record<string, unknown>): AnthropicMessagesClient {
  return {
    provider: "anthropic",
    model: metadata.model,
    timeoutMs: 5_000,
    maxTokens: 2_048,
    createToolResult: vi.fn(async () => ({ input: value, metadata })),
  };
}

function asRecord(value: ClaudeTurnWireOutput): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function unionParameterCount(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + unionParameterCount(item), 0);
  }
  if (typeof value !== "object" || value === null) return 0;
  const record = value as Record<string, unknown>;
  return (
    (Array.isArray(record.anyOf) ? 1 : 0) +
    (Array.isArray(record.oneOf) ? 1 : 0) +
    (Array.isArray(record.type) ? 1 : 0) +
    Object.values(record).reduce<number>(
      (total, item) => total + unionParameterCount(item),
      0,
    )
  );
}

const UNSUPPORTED_STRICT_SCHEMA_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "maxItems",
  "uniqueItems",
]);

function unsupportedKeywordCount(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce(
      (total, item) => total + unsupportedKeywordCount(item),
      0,
    );
  }
  if (typeof value !== "object" || value === null) return 0;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).filter((key) =>
      UNSUPPORTED_STRICT_SCHEMA_KEYWORDS.has(key),
    ).length +
    Object.values(record).reduce<number>(
      (total, item) => total + unsupportedKeywordCount(item),
      0,
    )
  );
}

describe("Claude interview providers", () => {
  it("round-trips and authorizes all 11 information codes through the JSON wire schema", async () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      CLAUDE_INTERVIEW_TURN_TOOL.inputSchema,
    );
    const definitions = createDevV1AcceptanceRequiredInformationItems();
    const roundTrippedCodes = new Set<string>();

    for (const active of definitions) {
      const informationItems: InformationItem[] = definitions.map((item, index) => ({
        ...item,
        status: item.infoCode === active.infoCode ? "ASKING" : "NEEDED",
        valueState: "MISSING",
        value: null,
        quality: null,
        extractionConfidence: null,
        verification: null,
        evidenceIds: [],
        prefill: null,
        updatedAt: `2026-08-10T00:00:${String(index).padStart(2, "0")}.000Z`,
      }));
      const turnInput: OrchestratorTurnInput = {
        text: sampleBorrowerAnswerByInfoCode[active.infoCode]!,
        currentInfoCode: active.infoCode,
        informationItems,
      };
      const draft = planDeterministicInterviewTurn(turnInput);
      const wire = encodeClaudeTurnPlanWire(draft);

      expect(
        validate(wire),
        `${active.infoCode}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
      expect(parseClaudeTurnPlanWire(wire, turnInput)).toEqual(draft);
      await expect(
        new ClaudeInterviewTurnPlanner(
          clientReturning(
            JSON.parse(JSON.stringify(wire)) as Record<string, unknown>,
          ),
        ).plan(turnInput),
      ).resolves.toMatchObject({ metadata });
      draft.extractedItems.forEach((candidate) =>
        roundTrippedCodes.add(candidate.infoCode),
      );
    }

    expect(roundTrippedCodes).toEqual(
      new Set(definitions.map((definition) => definition.infoCode)),
    );
  });

  it("keeps the actually serialized schema below Anthropic's union limit", () => {
    const serializedSchema = JSON.parse(
      JSON.stringify(CLAUDE_INTERVIEW_TURN_TOOL.inputSchema),
    );
    expect(unionParameterCount(serializedSchema)).toBeLessThanOrEqual(16);
    expect(unionParameterCount(serializedSchema)).toBe(0);
    expect(JSON.stringify(serializedSchema)).not.toContain('"anyOf"');
    expect(JSON.stringify(serializedSchema)).not.toContain('"oneOf"');
  });

  it("sends only Anthropic's supported native strict-schema subset", () => {
    for (const schema of [
      CLAUDE_INTERVIEW_TURN_TOOL.inputSchema,
      CLAUDE_RUBRIC_TOOL.inputSchema,
    ]) {
      const serializedSchema = JSON.parse(JSON.stringify(schema));
      expect(unsupportedKeywordCount(serializedSchema)).toBe(0);
      for (const keyword of UNSUPPORTED_STRICT_SCHEMA_KEYWORDS) {
        expect(JSON.stringify(serializedSchema)).not.toContain(`"${keyword}"`);
      }
    }
  });

  it("passes a decoded tool result through the existing fail-closed validator", async () => {
    const turnInput = input();
    const expected = planDeterministicInterviewTurn(turnInput);
    const client = clientReturning(asRecord(encodeClaudeTurnPlanWire(expected)));
    const planner = new ClaudeInterviewTurnPlanner(client);

    await expect(planner.plan(turnInput)).resolves.toEqual({
      plan: expected,
      metadata,
    });
    expect(client.createToolResult).toHaveBeenCalledOnce();
    const request = vi.mocked(client.createToolResult).mock.calls[0][0];
    expect(request.tool.name).toBe("commit_interview_turn");
    expect(request.user).toMatchObject({
      contractVersion: "dev-v1",
      sourceTranscript: turnInput.text,
      currentInfoCode: turnInput.currentInfoCode,
    });
    expect(JSON.stringify(request.user)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("rejects a model plan that rewrites the FINAL transcript", async () => {
    const turnInput = input();
    const wire = encodeClaudeTurnPlanWire(
      planDeterministicInterviewTurn(turnInput),
    );
    wire.text = "모델이 고친 문장";
    const planner = new ClaudeInterviewTurnPlanner(
      clientReturning(asRecord(wire)),
    );

    await expect(planner.plan(turnInput)).rejects.toBeInstanceOf(
      InvalidOrchestratorOutputError,
    );
  });

  it("accepts a contract-valid model-authored next question instead of requiring draft echo", () => {
    const turnInput = input();
    const draft = planDeterministicInterviewTurn(turnInput);
    const wire = encodeClaudeTurnPlanWire(draft);
    expect(wire.nextQuestionPresent).toBe(true);
    wire.nextQuestionText = "다음 필수 항목을 구체적인 금액으로 확인해 주세요.";

    const parsed = parseClaudeTurnPlanWire(wire, turnInput);
    expect(parsed.nextQuestion?.text).toBe(wire.nextQuestionText);
    expect(parsed.nextQuestion?.text).not.toBe(draft.nextQuestion?.text);
  });

  it("allows explanation and next-question rewrites without changing authoritative candidate facts", async () => {
    const turnInput = input();
    const draft = planDeterministicInterviewTurn(turnInput);
    const wire = encodeClaudeTurnPlanWire(draft);
    wire.extractedItems[0].explanation = "서버 추출 근거를 간결하게 설명합니다.";
    wire.nextQuestionText = "다음 필수 항목을 구체적으로 알려주세요.";
    const planner = new ClaudeInterviewTurnPlanner(
      clientReturning(asRecord(wire)),
    );

    const result = await planner.plan(turnInput);
    expect(result.plan.extractedItems[0].explanation).toBe(
      wire.extractedItems[0].explanation,
    );
    expect(result.plan.nextQuestion?.text).toBe(wire.nextQuestionText);
  });

  it("allows Claude to omit a local candidate but not invent one", async () => {
    const turnInput = input();
    const draft = planDeterministicInterviewTurn(turnInput);
    const omitted = encodeClaudeTurnPlanWire(draft);
    omitted.extractedItems = [];
    omitted.stateChanges = [];

    await expect(
      new ClaudeInterviewTurnPlanner(
        clientReturning(asRecord(omitted)),
      ).plan(turnInput),
    ).resolves.toMatchObject({ plan: { extractedItems: [], stateChanges: [] } });

    const transitionWithoutCandidate = encodeClaudeTurnPlanWire(draft);
    transitionWithoutCandidate.extractedItems = [];
    await expect(
      new ClaudeInterviewTurnPlanner(
        clientReturning(asRecord(transitionWithoutCandidate)),
      ).plan(turnInput),
    ).rejects.toMatchObject({
      name: "InvalidOrchestratorOutputError",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "TRANSITION_WITHOUT_EXTRACTION" }),
      ]),
    });

    const invented = encodeClaudeTurnPlanWire(draft);
    const inventedCandidate = structuredClone(invented.extractedItems[0]);
    inventedCandidate.infoCode = "fixed_operating_costs";
    invented.extractedItems.push(inventedCandidate);
    expect(() => parseClaudeTurnPlanWire(invented, turnInput)).not.toThrow();

    await expect(
      new ClaudeInterviewTurnPlanner(
        clientReturning(asRecord(invented)),
      ).plan(turnInput),
    ).rejects.toMatchObject({
      issueCode: "UNAUTHORIZED_EXTRACTION_CANDIDATE",
      path: "wire.extractedItems[1].infoCode",
    });
  });

  it("rejects a domain-valid inflated canonical amount not produced by the server parser", async () => {
    const turnInput = input();
    const wire = encodeClaudeTurnPlanWire(
      planDeterministicInterviewTurn(turnInput),
    );
    const canonical = JSON.parse(wire.extractedItems[0].valueJson) as {
      amount: { value: number };
    };
    canonical.amount.value = 999_999_999_999;
    wire.extractedItems[0].valueJson = JSON.stringify(canonical);
    expect(() => parseClaudeTurnPlanWire(wire, turnInput)).not.toThrow();

    await expect(
      new ClaudeInterviewTurnPlanner(
        clientReturning(asRecord(wire)),
      ).plan(turnInput),
    ).rejects.toMatchObject({
      issueCode: "UNAUTHORIZED_EXTRACTION_CANDIDATE",
      path: "wire.extractedItems[0].value",
    });
  });

  it("rejects transcript-only evidence promoted to TRANSACTION_SUPPORTED", async () => {
    const turnInput = input();
    const wire = encodeClaudeTurnPlanWire(
      planDeterministicInterviewTurn(turnInput),
    );
    wire.extractedItems[0].verification = "TRANSACTION_SUPPORTED";
    expect(() => parseClaudeTurnPlanWire(wire, turnInput)).not.toThrow();

    await expect(
      new ClaudeInterviewTurnPlanner(
        clientReturning(asRecord(wire)),
      ).plan(turnInput),
    ).rejects.toMatchObject({
      issueCode: "UNAUTHORIZED_EXTRACTION_CANDIDATE",
      path: "wire.extractedItems[0].verification",
    });
  });

  it("rejects malformed valueJson, trailing data, and non-object JSON", () => {
    const turnInput = input();
    const validWire = encodeClaudeTurnPlanWire(
      planDeterministicInterviewTurn(turnInput),
    );
    expect(validWire.extractedItems[0].valuePresent).toBe(true);

    for (const malformed of ["{", "{} trailing"]) {
      const wire = structuredClone(validWire);
      wire.extractedItems[0].valueJson = malformed;
      expect(() => parseClaudeTurnPlanWire(wire, turnInput)).toThrowError(
        InvalidClaudeTurnWireOutputError,
      );
      try {
        parseClaudeTurnPlanWire(wire, turnInput);
      } catch (error) {
        expect(error).toMatchObject({ issueCode: "INVALID_VALUE_JSON" });
      }
    }

    const arrayJson = structuredClone(validWire);
    arrayJson.extractedItems[0].valueJson = "[]";
    expect(() => parseClaudeTurnPlanWire(arrayJson, turnInput)).toThrowError(
      expect.objectContaining({ issueCode: "VALUE_JSON_NOT_OBJECT" }),
    );
  });

  it("lets the canonical validator reject additional data hidden inside valueJson", () => {
    const turnInput = input();
    const wire = encodeClaudeTurnPlanWire(
      planDeterministicInterviewTurn(turnInput),
    );
    const canonical = JSON.parse(wire.extractedItems[0].valueJson);
    canonical.providerScore = 1;
    wire.extractedItems[0].valueJson = JSON.stringify(canonical);

    expect(() => parseClaudeTurnPlanWire(wire, turnInput)).toThrowError(
      InvalidOrchestratorOutputError,
    );
    try {
      parseClaudeTurnPlanWire(wire, turnInput);
    } catch (error) {
      expect(error).toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "ADDITIONAL_PROPERTY" }),
        ]),
      });
    }
  });

  it("rejects additional wire fields instead of silently dropping them", () => {
    const turnInput = input();
    const wire = encodeClaudeTurnPlanWire(
      planDeterministicInterviewTurn(turnInput),
    );
    const additional = { ...wire, providerNarrative: "trust the model" };

    expect(() => parseClaudeTurnPlanWire(additional, turnInput)).toThrowError(
      InvalidClaudeTurnWireOutputError,
    );
    try {
      parseClaudeTurnPlanWire(additional, turnInput);
    } catch (error) {
      expect(error).toMatchObject({
        issueCode: "UNEXPECTED_OR_MISSING_KEYS",
        path: "wire",
      });
    }

    const nested = structuredClone(wire) as ClaudeTurnWireOutput & {
      extractedItems: Array<ClaudeTurnWireOutput["extractedItems"][number] & {
        providerScore?: number;
      }>;
    };
    nested.extractedItems[0].providerScore = 1;
    expect(() => parseClaudeTurnPlanWire(nested, turnInput)).toThrowError(
      InvalidClaudeTurnWireOutputError,
    );
  });

  it("enforces every explicit nullable sentinel pair", () => {
    const turnInput = input();
    const base = encodeClaudeTurnPlanWire(
      planDeterministicInterviewTurn(turnInput),
    );
    const cases: ClaudeTurnWireOutput[] = [];

    const current = structuredClone(base);
    current.currentInfoCodePresent = false;
    cases.push(current);

    const value = structuredClone(base);
    value.extractedItems[0].valuePresent = false;
    cases.push(value);

    const quality = structuredClone(base);
    quality.extractedItems[0].qualityPresent = false;
    cases.push(quality);

    const terminal = structuredClone(base);
    terminal.extractedItems[0].terminalDispositionPresent = false;
    terminal.extractedItems[0].terminalDisposition = "REFUSED";
    cases.push(terminal);

    const nextQuestion = structuredClone(base);
    nextQuestion.nextQuestionPresent = false;
    cases.push(nextQuestion);

    for (const wire of cases) {
      expect(() => parseClaudeTurnPlanWire(wire, turnInput)).toThrowError(
        InvalidClaudeTurnWireOutputError,
      );
    }
  });

  it("accepts only rubric evidence from the server-provided lineage", async () => {
    const client = clientReturning({
      level: 4,
      reason: "행동, 기간, 목표가 구체적으로 제시되었습니다.",
      evidenceIds: ["evidence-1"],
    });
    const classifier = new ClaudeRubricClassifier(client);
    const result = await classifier.classify({
      rubric: "plan_specificity",
      plan: {
        schemaVersion: "dev-v1",
        kind: "IMPROVEMENT_PLAN",
        planExists: true,
        problem: "전화 주문 비중이 낮음",
        actions: [],
        owner: "BORROWER",
        schedule: null,
        baseline: null,
        target: null,
        measurementSources: ["POS"],
        origin: "BORROWER_DIRECT",
      },
      allowedEvidenceIds: ["evidence-1"],
    });

    expect(result).toEqual({
      classification: {
        level: 4,
        reason: "행동, 기간, 목표가 구체적으로 제시되었습니다.",
        evidenceIds: ["evidence-1"],
      },
      metadata,
    });
    expect(client.createToolResult).toHaveBeenCalledOnce();
  });

  it("fails closed when a rubric response cites unknown evidence", async () => {
    const classifier = new ClaudeRubricClassifier(
      clientReturning({
        level: 5,
        reason: "근거가 충분합니다.",
        evidenceIds: ["invented-evidence"],
      }),
    );
    await expect(
      classifier.classify({
        rubric: "problem_specificity",
        plan: {
          schemaVersion: "dev-v1",
          kind: "IMPROVEMENT_PLAN",
          planExists: false,
          problem: null,
          actions: [],
          owner: null,
          schedule: null,
          baseline: null,
          target: null,
          measurementSources: [],
          origin: "BORROWER_DIRECT",
        },
        allowedEvidenceIds: ["evidence-1"],
      }),
    ).rejects.toMatchObject({
      name: "RubricClassifierOutputValidationError",
      issues: [expect.objectContaining({ code: "UNKNOWN_EVIDENCE_ID" })],
    });
  });
});
