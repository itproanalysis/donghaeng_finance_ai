import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import Ajv2020 from "ajv/dist/2020";
import { afterEach, describe, expect, it } from "vitest";

import { buildInterviewDataQualityEvaluationV1 } from "@/domain/data-quality-evaluation";
import type { ImmutableFinalInterviewSnapshotV1 } from "@/domain/final-snapshot-v1";
import { GET as getEvaluationRoute } from "@/app/api/interview-evaluations/[id]/route";
import {
  AuthService,
  SESSION_COOKIE_NAME,
} from "@/server/auth";
import { createInMemoryDatabase } from "@/server/database";
import { InterviewRepository } from "@/server/interview-repository";
import { InterviewService } from "@/server/interview-service";

type JsonObject = Record<string, unknown>;

const ANSWERS: Record<string, string> = {
  monthly_average_sales: "카드 매출 월평균은 2,300만원입니다",
  fixed_operating_costs: "고정비는 월 1,000만원입니다",
  improvement_plan:
    "개선 계획은 폐기 비용이 문제입니다. 앞으로 3개월 안에 폐기를 줄이고 POS로 현재 10%에서 목표 5%를 확인하겠습니다.",
  execution_readiness: "실행 준비는 인력과 예산을 확보했고 일정도 준비 완료했습니다",
  confirmed_reservations: "확정 예약은 3건이고 총액은 120만원입니다",
  seasonality_outlook: "계절성 전망은 작년보다 수요가 10% 증가할 것으로 봅니다",
  essential_household_expenses: "필수 가계지출은 월 300만원입니다",
  emergency_buffer_months: "비상자금은 4개월입니다",
};

const openApiDocument = JSON.parse(
  readFileSync(new URL("../../contracts/openapi.json", import.meta.url), "utf8"),
) as JsonObject;
const validateEvaluationEnvelope = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
}).compile({
  $schema: String(openApiDocument.jsonSchemaDialect),
  components: openApiDocument.components,
  $ref: "#/components/schemas/EvaluationSuccessEnvelope",
});

const databases: DatabaseSync[] = [];
const runtimeGlobals = globalThis as typeof globalThis & {
  __donghaengInterviewService?: InterviewService;
  __donghaengAuthService?: AuthService;
};

function completedInterviewHarness() {
  const database = createInMemoryDatabase();
  databases.push(database);
  let id = 0;
  const now = () => new Date("2026-08-10T00:00:00.000Z");
  const auth = new AuthService(database, now);
  const session = auth.bootstrapLocalWorkspace();
  const service = new InterviewService(new InterviewRepository(database), {
    now,
    idFactory: () => `evaluation-contract-${++id}`,
  });
  const created = service.createInterview(session.principal);
  let preview = created;

  for (let turn = 0; turn < 8; turn += 1) {
    const infoCode = preview.nextQuestion?.infoCode;
    if (!infoCode) throw new Error(`turn ${turn + 1}: next question is missing`);
    const answer = ANSWERS[infoCode];
    if (!answer) throw new Error(`answer fixture is missing: ${infoCode}`);
    preview = service.addMessageCommand(
      created.session.id,
      {
        text: answer,
        clientMessageId: `evaluation-contract-message-${turn + 1}`,
        expectedVersion: preview.session.version,
        currentQuestionInfoCode: infoCode,
      },
      session.principal,
    ).snapshot;
  }

  const completed = service.completeInterviewCommand(
    created.session.id,
    {
      clientCommandId: "evaluation-contract-complete",
      expectedVersion: preview.session.version,
      mode: "COMPLETE",
      borrowerConfirmed: true,
      reason: null,
    },
    session.principal,
  );
  return { auth, completed, service, session };
}

function snapshotWithConfidence(
  snapshot: ImmutableFinalInterviewSnapshotV1,
  parserConfidence: number,
): ImmutableFinalInterviewSnapshotV1 {
  const clone = structuredClone(snapshot);
  for (const record of clone.informationItems) {
    const revision = record.revisions.find(
      (candidate) => candidate.id === record.selectedRevisionId,
    );
    if (!revision) continue;
    revision.quality = record.minQuality;
    revision.verification = "SELF_REPORTED";
    revision.parserConfidence = parserConfidence;
  }
  return clone;
}

afterEach(() => {
  delete runtimeGlobals.__donghaengInterviewService;
  delete runtimeGlobals.__donghaengAuthService;
  while (databases.length > 0) databases.pop()?.close();
});

describe("canonical evaluation runtime contract", () => {
  it("validates the actual authenticated GET 200 envelope against OpenAPI", async () => {
    const { auth, completed, service, session } = completedInterviewHarness();
    runtimeGlobals.__donghaengInterviewService = service;
    runtimeGlobals.__donghaengAuthService = auth;

    const evaluationId = completed.evaluation?.id;
    if (!evaluationId) throw new Error("eligible completion did not create an evaluation");
    const response = await getEvaluationRoute(
      new Request(`http://localhost/api/interview-evaluations/${evaluationId}`, {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${session.token}`,
          "x-request-id": "evaluation-contract-request",
        },
      }),
      { params: Promise.resolve({ id: evaluationId }) },
    );
    const envelope = await response.json() as JsonObject;

    expect(response.status).toBe(200);
    expect(envelope).toMatchObject({
      error: null,
      meta: { requestId: "evaluation-contract-request" },
      data: {
        decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
        approvalDecision: null,
        creditGrade: null,
        overall: { completionStatus: "COMPLETE" },
        items: expect.arrayContaining([
          expect.objectContaining({
            infoCode: "monthly_average_sales",
            score: expect.any(Number),
            grade: expect.stringMatching(/^[A-E]$/),
            source: expect.any(String),
            asOf: "2026-08-10T00:00:00.000Z",
          }),
        ]),
      },
    });
    expect(
      validateEvaluationEnvelope(envelope),
      JSON.stringify(validateEvaluationEnvelope.errors, null, 2),
    ).toBe(true);
  });

  it("reaches A through E deterministically without changing STRICT completion eligibility", () => {
    const { completed } = completedInterviewHarness();
    const finalSnapshot = completed.snapshot as ImmutableFinalInterviewSnapshotV1;
    expect(finalSnapshot.completionAssessment.evaluationEligible).toBe(true);

    const scenarios = [
      { confidence: 1, grade: "A" },
      { confidence: 0.75, grade: "B" },
      { confidence: 0.45, grade: "C" },
      { confidence: 0.2, grade: "D" },
      { confidence: 0, grade: "E" },
    ] as const;

    for (const scenario of scenarios) {
      const snapshot = snapshotWithConfidence(finalSnapshot, scenario.confidence);
      const first = buildInterviewDataQualityEvaluationV1(snapshot);
      const second = buildInterviewDataQualityEvaluationV1(structuredClone(snapshot));

      expect(second).toEqual(first);
      expect(first).toMatchObject({
        status: "READY",
        decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
        approvalDecision: null,
        creditGrade: null,
        overall: {
          grade: scenario.grade,
          completionStatus: "COMPLETE",
        },
      });
      expect(first.overall.score).toBeGreaterThanOrEqual(0);
      expect(first.overall.score).toBeLessThanOrEqual(100);
    }

    const nominal = buildInterviewDataQualityEvaluationV1(
      snapshotWithConfidence(finalSnapshot, 1),
    );
    expect(nominal.overall.score).toBeLessThan(100);
  });

  it("keeps INCOMPLETE snapshots NOT_ELIGIBLE and UNGRADED", () => {
    const { completed } = completedInterviewHarness();
    const incomplete = snapshotWithConfidence(
      completed.snapshot as ImmutableFinalInterviewSnapshotV1,
      1,
    );
    incomplete.completionStatus = "INCOMPLETE";
    incomplete.completionAssessment = {
      ...incomplete.completionAssessment,
      completionStatus: "INCOMPLETE",
      evaluationEligible: false,
    };

    const evaluation = buildInterviewDataQualityEvaluationV1(incomplete);
    expect(evaluation.status).toBe("NOT_ELIGIBLE");
    expect(evaluation.overall).toMatchObject({
      grade: "UNGRADED",
      completionStatus: "INCOMPLETE",
    });
    expect(evaluation.pillars.every((pillar) => pillar.grade === "UNGRADED")).toBe(true);
    expect(evaluation.items).toHaveLength(incomplete.informationItems.length);
    expect(
      evaluation.items.every(
        (item) => item.grade === "UNGRADED" && item.score === null,
      ),
    ).toBe(true);
    expect(evaluation.items.find((item) => item.infoCode === "monthly_average_sales"))
      .toMatchObject({
        source: expect.any(String),
        asOf: "2026-08-10T00:00:00.000Z",
      });
    expect(evaluation.approvalDecision).toBeNull();
    expect(evaluation.creditGrade).toBeNull();
  });
});
