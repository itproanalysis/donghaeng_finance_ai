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
  fixed_operating_costs: "고정비는 월 1,000만원입니다",
  improvement_plan:
    "개선 계획은 폐기 비용이 문제입니다. 앞으로 3개월 안에 폐기를 줄이고 POS로 현재 10%에서 목표 5%를 확인하겠습니다.",
  execution_readiness: "실행 준비는 인력과 예산을 확보했고 일정도 준비 완료했습니다",
  confirmed_reservations: "확정 예약은 3건이고 총액은 120만원입니다",
  seasonality_outlook: "계절성 전망은 작년보다 수요가 10% 증가할 것으로 봅니다",
  essential_household_expenses: "필수 가계지출은 월 300만원입니다",
  emergency_buffer_months: "비상자금은 4개월입니다",
};

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("evaluation status pipeline", () => {
  it("commits a FAILED evaluation and immutable FINAL when generation fails", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      idFactory: () => `evaluation-failure-${++id}`,
      evaluationBuilder: () => {
        throw new Error("synthetic evaluation adapter failure");
      },
    });
    const created = service.createInterview(principal);
    let snapshot = created;
    for (let turn = 0; turn < 8; turn += 1) {
      const infoCode = snapshot.nextQuestion?.infoCode;
      if (!infoCode || !answers[infoCode]) throw new Error(`fixture missing: ${infoCode}`);
      snapshot = service.addMessageCommand(
        created.session.id,
        {
          text: answers[infoCode],
          clientMessageId: `evaluation-failure-turn-${turn + 1}`,
          expectedVersion: snapshot.session.version,
          currentQuestionInfoCode: infoCode,
        },
        principal,
      ).snapshot;
    }

    const completed = service.completeInterviewCommand(
      created.session.id,
      {
        clientCommandId: "evaluation-failure-complete",
        expectedVersion: snapshot.session.version,
        mode: "COMPLETE",
        borrowerConfirmed: true,
        reason: null,
      },
      principal,
    );

    expect(completed.snapshot).toMatchObject({
      snapshotType: "FINAL",
      completionStatus: "COMPLETE",
      evaluationId: completed.evaluation?.id,
    });
    expect(completed.evaluation).toMatchObject({
      status: "FAILED",
      overall: { score: 0, grade: "UNGRADED", completionStatus: "COMPLETE" },
      failureReasons: ["EVALUATION_GENERATION_FAILED"],
      approvalDecision: null,
      creditGrade: null,
    });
    expect(
      database
        .prepare("SELECT status FROM evaluations WHERE interview_id = ?")
        .get(created.session.id),
    ).toEqual({ status: "FAILED" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM evaluation_pillars").get()?.count).toBe(0);
    const transitions = database
      .prepare(
        `SELECT payload_json FROM audit_events
         WHERE interview_id = ? AND event_type = 'EVALUATION_STATUS_CHANGED'
         ORDER BY rowid ASC`,
      )
      .all(created.session.id)
      .map((row) => JSON.parse(String(row.payload_json)) as { to: string });
    expect(transitions.map((transition) => transition.to)).toEqual([
      "PENDING",
      "GENERATING",
      "FAILED",
    ]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM final_snapshots").get()?.count).toBe(1);
  });
});
