import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const databases: DatabaseSync[] = [];
const principal: Principal = {
  tenantId: LOCAL_WORKSPACE_TENANT_ID,
  userId: LOCAL_WORKSPACE_USER_ID,
  email: LOCAL_WORKSPACE_EMAIL,
  displayName: "로컬 데모 담당자",
  roles: ["ADMIN", "INTERVIEWER"],
};

const answers: Record<string, string> = {
  monthly_average_sales: "카드 매출 월평균은 2,300만원입니다",
  fixed_operating_costs: "고정 운영비 합계는 월 1,000만원입니다",
  improvement_plan:
    "플랫폼 비용이 문제라 직접 주문을 늘리겠습니다. 앞으로 2개월 안에 POS로 현재 18%에서 목표 30%를 확인하겠습니다.",
  execution_readiness: "실행 준비는 인력과 예산을 확보했고 일정도 준비 완료했습니다",
  confirmed_reservations: "확정 예약은 3건이고 총액은 120만원입니다",
  seasonality_outlook: "계절성 전망은 과거 매출을 보면 석 달간 수요가 10% 증가할 것으로 봅니다",
  essential_household_expenses: "필수 가계지출 합계는 월 300만원입니다",
  emergency_buffer_months: "비상자금은 4개월입니다",
};

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function completeInterviewForTest(service: InterviewService) {
  const created = service.createInterview(principal);
  let snapshot = created;
  for (let turn = 0; turn < 8; turn += 1) {
    const infoCode = snapshot.nextQuestion?.infoCode;
    if (!infoCode || !answers[infoCode]) throw new Error(`fixture missing: ${infoCode}`);
    snapshot = service.addMessageCommand(
      created.session.id,
      {
        text: answers[infoCode],
        clientMessageId: `evaluation-list-turn-${turn + 1}`,
        expectedVersion: snapshot.session.version,
        currentQuestionInfoCode: infoCode,
      },
      principal,
    ).snapshot;
  }
  return service.completeInterviewCommand(
    created.session.id,
    {
      clientCommandId: "evaluation-list-complete",
      expectedVersion: snapshot.session.version,
      mode: "COMPLETE",
      borrowerConfirmed: true,
      reason: null,
    },
    principal,
  );
}

describe("tenant evaluation list", () => {
  it("returns searchable READY summaries without exposing a credit-grade scope", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      now: () => new Date("2026-08-10T03:00:00.000Z"),
      idFactory: () => `evaluation-list-${++id}`,
    });
    const completed = completeInterviewForTest(service);
    const evaluationId = completed.evaluation?.id;
    if (!evaluationId) throw new Error("evaluation fixture was not generated");

    const result = service.listEvaluationSummaries(principal);
    expect(result).toMatchObject({ total: 1, facets: { industries: ["카페"] } });
    expect(result.items[0]).toMatchObject({
      id: evaluationId,
      interviewId: completed.snapshot.interviewId,
      status: "READY",
      borrowerName: "사장님",
      businessName: "카페 사업체",
      industry: "카페",
      informationRate: 100,
      goalCount: 1,
      completionStatus: "COMPLETE",
      decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
    });
    expect(result.items[0].overallScore).toBeGreaterThan(0);
    expect(result.items[0].overallLevelLabel).toContain("데이터 품질");

    expect(service.listEvaluationSummaries(principal, { q: "카페 사업체" }).total).toBe(1);
    expect(service.listEvaluationSummaries(principal, { industry: "한식 음식점" }).total).toBe(0);
    expect(
      service.listEvaluationSummaries(principal, {
        level: result.items[0].overallLevel,
        from: "2026-08-10",
        to: "2026-08-10",
      }).total,
    ).toBe(1);
    expect(service.listEvaluationSummaries(principal, { from: "2026-08-11" }).total).toBe(0);
  });

  it("never returns another tenant's evaluation", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `evaluation-tenant-${++id}`,
    });
    completeInterviewForTest(service);

    expect(
      service.listEvaluationSummaries({
        ...principal,
        tenantId: "tenant-with-no-access",
        userId: "other-user",
      }),
    ).toEqual({ items: [], total: 0, facets: { industries: [], levels: [] } });
  });
});
