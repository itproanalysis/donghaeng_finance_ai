import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it, vi } from "vitest";

import {
  CLAUDE_INTERVIEW_TURN_TOOL,
  CLAUDE_RUBRIC_TOOL,
  ClaudeInterviewTurnPlanner,
  ClaudeRubricClassifier,
  InvalidClaudeTurnWireOutputError,
  applyClaudeRealtimePhrasing,
  createClaudeRealtimePhrasingTool,
  encodeClaudeTurnPlanWire,
  parseClaudeTurnPlanWire,
  type ClaudeRealtimePhrasingWireOutput,
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
  selectTurnNextQuestionCandidates,
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

function compactOutputFor(
  draft: ReturnType<typeof planDeterministicInterviewTurn>,
  overrides: Partial<ClaudeRealtimePhrasingWireOutput> = {},
): Record<string, unknown> {
  if (!draft.nextQuestion) throw new Error("Test draft requires a next question.");
  return {
    selectedInfoCode: draft.nextQuestion.infoCode,
    reaction: "말씀하신 내용을 확인했어요.",
    question: "다음 내용도 편하게 말씀해 주실 수 있을까요?",
    ...overrides,
  };
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
    let largestExactWireBytes = 0;

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
      largestExactWireBytes = Math.max(
        largestExactWireBytes,
        new TextEncoder().encode(JSON.stringify(wire)).byteLength,
      );

      expect(
        validate(wire),
        `${active.infoCode}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
      expect(parseClaudeTurnPlanWire(wire, turnInput)).toEqual(draft);
      await expect(
        new ClaudeInterviewTurnPlanner(
          clientReturning(compactOutputFor(draft)),
        ).plan(turnInput),
      ).resolves.toMatchObject({ metadata });
      draft.extractedItems.forEach((candidate) =>
        roundTrippedCodes.add(candidate.infoCode),
      );
    }

    expect(roundTrippedCodes).toEqual(
      new Set(definitions.map((definition) => definition.infoCode)),
    );
    // This is deliberately stricter than a tokenizer estimate: one output
    // token cannot encode fewer than one UTF-8 byte. Every exact canonical
    // single-question plan therefore fits the 2,304-token realtime cap.
    expect(largestExactWireBytes).toBeLessThanOrEqual(2_304);
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
      createClaudeRealtimePhrasingTool("monthly_average_sales").inputSchema,
      CLAUDE_RUBRIC_TOOL.inputSchema,
    ]) {
      const serializedSchema = JSON.parse(JSON.stringify(schema));
      expect(unsupportedKeywordCount(serializedSchema)).toBe(0);
      for (const keyword of UNSUPPORTED_STRICT_SCHEMA_KEYWORDS) {
        expect(JSON.stringify(serializedSchema)).not.toContain(`"${keyword}"`);
      }
    }
  });

  it("sends only a compact phrasing payload and records actual Anthropic metadata", async () => {
    const turnInput = input();
    const expected = planDeterministicInterviewTurn(turnInput);
    const compactOutput = compactOutputFor(expected);
    const client = clientReturning(compactOutput);
    const planner = new ClaudeInterviewTurnPlanner(client);

    await expect(planner.plan(turnInput)).resolves.toEqual({
      plan: applyClaudeRealtimePhrasing(compactOutput, expected, turnInput.text),
      metadata,
    });
    expect(client.createToolResult).toHaveBeenCalledOnce();
    const request = vi.mocked(client.createToolResult).mock.calls[0][0];
    expect(request.tool.name).toBe("phrase_realtime_interview_turn");
    expect(request.maxTokens).toBe(192);
    expect(request.user).toMatchObject({
      contractVersion: "realtime-phrasing-v1",
      untrustedBorrowerAnswer: turnInput.text,
      currentInfoCode: turnInput.currentInfoCode,
      allowedCandidates: expect.arrayContaining([
        expect.objectContaining({
          infoCode: expected.nextQuestion?.infoCode,
          canonicalQuestion: expected.nextQuestion?.text,
        }),
      ]),
    });
    expect(JSON.stringify(request.user)).not.toContain("extractedItems");
    expect(JSON.stringify(request.user)).not.toContain("stateChanges");
    expect(JSON.stringify(request.user).length).toBeLessThan(1_500);
    expect(JSON.stringify(request.user)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("returns the authoritative plan at the deadline and ignores a late success", async () => {
    const turnInput = input();
    const draft = planDeterministicInterviewTurn(turnInput);
    const createToolResult: AnthropicMessagesClient["createToolResult"] = vi.fn(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 35));
        return { input: compactOutputFor(draft), metadata };
      },
    );
    const client: AnthropicMessagesClient = {
      provider: "anthropic",
      model: metadata.model,
      timeoutMs: 5_000,
      maxTokens: 2_048,
      createToolResult,
    };

    const result = await new ClaudeInterviewTurnPlanner(client, {
      softDeadlineMs: 10,
    }).plan(turnInput);

    const presentedQuestion = result.plan.nextQuestion?.text;
    expect(result.plan).toEqual(draft);
    expect(result.metadata).toMatchObject({
      provider: "deterministic",
      model: "local-realtime-fallback-v1",
      stopReason: "soft_deadline",
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(result.plan.nextQuestion?.text).toBe(presentedQuestion);
    expect(createToolResult).toHaveBeenCalledOnce();
  });

  it("converts a provider failure into a deterministic applicable result", async () => {
    const turnInput = input();
    const draft = planDeterministicInterviewTurn(turnInput);
    const client: AnthropicMessagesClient = {
      ...clientReturning(compactOutputFor(draft)),
      createToolResult: vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    };

    await expect(
      new ClaudeInterviewTurnPlanner(client).plan(turnInput),
    ).resolves.toEqual({
      plan: draft,
      metadata: {
        provider: "deterministic",
        model: "local-realtime-fallback-v1",
        requestId: null,
        inputTokens: null,
        outputTokens: null,
        stopReason: "provider_failure",
      },
    });
  });

  it("ignores a legacy full-plan response instead of letting it rewrite facts", async () => {
    const turnInput = input();
    const draft = planDeterministicInterviewTurn(turnInput);
    const wire = encodeClaudeTurnPlanWire(
      draft,
    );
    wire.text = "모델이 고친 문장";
    const planner = new ClaudeInterviewTurnPlanner(
      clientReturning(asRecord(wire)),
    );

    await expect(planner.plan(turnInput)).resolves.toEqual({
      plan: draft,
      metadata: expect.objectContaining({
        provider: "deterministic",
        stopReason: "provider_failure",
      }),
    });
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

  it("allows only bounded reaction/question phrasing and preserves every server fact", async () => {
    const turnInput = input();
    const draft = planDeterministicInterviewTurn(turnInput);
    const phrasing = compactOutputFor(draft, {
      reaction: "말씀하신 내용을 확인했어요.",
      question: "이어서 월 고정 운영비도 알려주시겠어요?",
    });
    const planner = new ClaudeInterviewTurnPlanner(
      clientReturning(phrasing),
    );

    const result = await planner.plan(turnInput);
    expect(result.metadata).toEqual(metadata);
    expect(result.plan.extractedItems).toEqual(draft.extractedItems);
    expect(result.plan.stateChanges).toEqual(draft.stateChanges);
    expect(result.plan.text).toBe(draft.text);
    expect(result.plan.currentInfoCode).toBe(draft.currentInfoCode);
    expect(result.plan.nextQuestion).toEqual({
      ...draft.nextQuestion,
      text: `말씀하신 내용을 확인했어요. ${draft.nextQuestion?.text}`,
    });
  });

  it("lets Claude choose only within the server-owned top-three candidate set", async () => {
    const definitions = createDevV1AcceptanceRequiredInformationItems();
    const turnInput: OrchestratorTurnInput = {
      text: "최근 3개월 월평균 매출은 2,300만원입니다.",
      currentInfoCode: "monthly_average_sales",
      informationItems: definitions.map((item, index) => ({
        ...item,
        status: item.infoCode === "monthly_average_sales"
          ? "ASKING"
          : item.infoCode === "fixed_operating_costs"
            ? "CONFIRMED"
            : "NEEDED",
        valueState: "MISSING",
        value: null,
        quality: null,
        extractionConfidence: null,
        verification: null,
        evidenceIds: [],
        prefill: null,
        updatedAt: `2026-08-10T00:00:${String(index).padStart(2, "0")}.000Z`,
      })),
    };
    const draft = planDeterministicInterviewTurn(turnInput);
    const allowed = selectTurnNextQuestionCandidates(turnInput, draft.stateChanges, 3);
    expect(allowed.map((question) => question.infoCode)).toEqual([
      "improvement_plan",
      "confirmed_reservations",
      "seasonality_outlook",
    ]);
    const selected = allowed[1]!;
    const client = clientReturning({
      selectedInfoCode: selected.infoCode,
      reaction: "알려주신 내용을 정리했어요.",
      question: "플랫폼 비용도 이어서 살펴볼까요?",
    });
    const planner = new ClaudeInterviewTurnPlanner(client);

    const result = await planner.plan(turnInput);
    expect(result.plan.nextQuestion).toEqual({
      ...selected,
      text: `알려주신 내용을 정리했어요. ${selected.text}`,
    });
    const request = vi.mocked(client.createToolResult).mock.calls[0][0];
    expect(request.tool.inputSchema).toMatchObject({
      properties: {
        selectedInfoCode: {
          enum: allowed.map((candidate) => candidate.infoCode),
        },
      },
    });
  });

  it("falls back when Claude selects another code, adds a number, or asks twice", async () => {
    const turnInput = input();
    const draft = planDeterministicInterviewTurn(turnInput);
    for (const unsafe of [
      compactOutputFor(draft, { selectedInfoCode: "execution_readiness" }),
      compactOutputFor(draft, { question: "월 고정비가 999억 원인가요?" }),
      compactOutputFor(draft, { question: "고정비인가요? 임차료도 있나요?" }),
      compactOutputFor(draft, { reaction: "매출이 줄었다고요?" }),
    ]) {
      const result = await new ClaudeInterviewTurnPlanner(
        clientReturning(unsafe),
      ).plan(turnInput);
      expect(result.plan).toEqual(draft);
      expect(result.metadata).toMatchObject({
        provider: "deterministic",
        stopReason: "provider_failure",
      });
    }
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
