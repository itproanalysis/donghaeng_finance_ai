import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  createDevV1AcceptanceRequiredInformationItems,
  validateImmutableFinalSnapshotV1,
  type ImmutableFinalInterviewSnapshotV1,
} from "../../src/domain";
import {
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const principal: Principal = {
  tenantId: LOCAL_WORKSPACE_TENANT_ID,
  userId: LOCAL_WORKSPACE_USER_ID,
  email: LOCAL_WORKSPACE_EMAIL,
  displayName: "수용 테스트 담당자",
  roles: ["ADMIN", "INTERVIEWER"],
};

const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("acceptance signals through the persisted server pipeline", () => {
  it("persists multi-extraction, range revision, exact confirmation and FINAL lineage", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    let minute = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      now: () => new Date(`2026-08-10T00:${String(minute++).padStart(2, "0")}:00.000Z`),
      idFactory: () => `acceptance-service-${++id}`,
    });
    const created = service.createInterview(
      principal,
      createDevV1AcceptanceRequiredInformationItems().map((item) => ({
        ...item,
        priority: item.required ? item.priority : "P0",
        status: item.infoCode === "platform_fee_pressure" ? "ASKING" : "NEEDED",
      })),
    );
    expect(created.nextQuestion?.infoCode).toBe("platform_fee_pressure");
    expect(created.nextQuestion?.text).toBe(
      "배달이나 온라인 플랫폼을 이용하고 계신다면, 최근 수수료나 광고비가 운영에 부담된 부분이 있었나요? 이용하지 않으시면 그렇지 않다고 말씀해 주세요.",
    );
    const initialMonthlyItem = created.informationItems.find(
      (item) => item.infoCode === "monthly_average_sales",
    )!;
    const initialMonthlyRecord = created.canonicalInformationItems.find(
      (record) => record.infoCode === "monthly_average_sales",
    )!;
    const initialMonthlyFeature = created.features.features.find(
      (feature) => feature.name === "monthly_average_sales",
    )!;
    expect(initialMonthlyItem).toMatchObject({
      status: "NEEDED",
      valueState: "MISSING",
      value: null,
      quality: null,
      verification: null,
      evidenceIds: [],
    });
    expect(initialMonthlyRecord).toMatchObject({
      status: "NEEDED",
      valueState: "MISSING",
      selectedRevisionId: null,
    });
    expect(initialMonthlyFeature).toMatchObject({ state: "MISSING" });
    expect(created.coverage).toMatchObject({
      resolvedRequired: 0,
      evaluableRequired: 0,
      overallRate: 0,
    });
    expect(created.evidence).toEqual([]);

    const first = service.addMessageCommand(
      created.session.id,
      {
        text: "배달은 계속 나오는데 수수료가 많이 나가고 홀 손님이 줄었어요. 그래도 단골 매출은 절반 정도 됩니다.",
        clientMessageId: "acceptance-message-1",
        expectedVersion: created.session.version,
        currentQuestionInfoCode: "platform_fee_pressure",
      },
      principal,
    );
    expect(first.processing.status).toBe("APPLIED");
    expect(first.evidenceAdded.map((ref) => ref.infoCode)).toEqual([
      "platform_fee_pressure",
      "hall_customer_decline",
      "repeat_customer_share",
    ]);
    expect(
      first.snapshot.informationItems.find(
        (item) => item.infoCode === "monthly_average_sales",
      ),
    ).toEqual(initialMonthlyItem);
    expect(
      first.snapshot.canonicalInformationItems.find(
        (record) => record.infoCode === "monthly_average_sales",
      ),
    ).toEqual(initialMonthlyRecord);
    expect(
      first.snapshot.features.features.find(
        (feature) => feature.name === "monthly_average_sales",
      ),
    ).toEqual(initialMonthlyFeature);
    expect(first.snapshot.informationItems.find((item) => item.infoCode === "platform_fee_pressure")?.status).toBe("CONFIRMED");
    expect(first.snapshot.informationItems.find((item) => item.infoCode === "hall_customer_decline")?.status).toBe("CONFIRMED");
    expect(first.snapshot.informationItems.find((item) => item.infoCode === "repeat_customer_share")?.status).toBe("NEEDS_FOLLOWUP");
    expect(first.snapshot.nextQuestion?.infoCode).toBe("repeat_customer_share");
    expect(first.snapshot.features.features.find((feature) => feature.name === "repeat_customer_share")).toMatchObject({
      state: "COMPUTED",
      raw: { kind: "RANGE", min: 0.45, max: 0.55 },
    });

    const second = service.addMessageCommand(
      created.session.id,
      {
        text: "최근 한 달 기준 단골 매출은 45% 정도입니다.",
        clientMessageId: "acceptance-message-2",
        expectedVersion: first.snapshot.session.version,
        currentQuestionInfoCode: "repeat_customer_share",
      },
      principal,
    );
    expect(second.snapshot.nextQuestion?.infoCode).toBe("improvement_plan");
    const repeatRecord = second.snapshot.canonicalInformationItems.find(
      (record) => record.infoCode === "repeat_customer_share",
    )!;
    expect(repeatRecord.status).toBe("CONFIRMED");
    expect(repeatRecord.revisions).toHaveLength(2);
    expect(repeatRecord.revisions.map((revision) => revision.status)).toEqual([
      "SUPERSEDED",
      "SELECTED",
    ]);
    expect(repeatRecord.revisions.at(-1)?.value).toMatchObject({
      kind: "PERCENTAGE",
      percentage: { kind: "EXACT", value: 45 },
    });

    const third = service.addMessageCommand(
      created.session.id,
      {
        text: "단골들은 전화주문을 받고 싶어요. 지금 직접주문이 18%인데 두 달 안에 30%까지 늘리고 싶습니다.",
        clientMessageId: "acceptance-message-3",
        expectedVersion: second.snapshot.session.version,
        currentQuestionInfoCode: "improvement_plan",
      },
      principal,
    );
    expect(third.snapshot.goalSnapshot).toMatchObject({
      status: "CONFIRMED",
      numericStatus: "DIRECT",
      baseline: { value: { kind: "EXACT", value: 18 }, unit: "%" },
      target: { value: { kind: "EXACT", value: 30 }, unit: "%" },
      period: { value: 8, unit: "WEEK" },
      measurementSources: ["PHONE_ORDER_LOG"],
    });
    expect(third.snapshot.features.features.find((feature) => feature.name === "plan_measurability")).toMatchObject({
      state: "COMPUTED",
      raw: true,
      normalized: 1,
    });
    expect(third.snapshot.liveSummary.plainText).toContain("반복고객 매출 비중은 45%");
    expect(third.snapshot.liveSummary.plainText).toContain("배달 플랫폼 수수료");

    const remainingAnswers: Record<string, string> = {
      monthly_average_sales: "카드 매출 월평균은 2,300만원입니다",
      fixed_operating_costs: "고정 운영비 합계는 월 1,000만원입니다",
      execution_readiness: "실행 준비는 인력과 예산을 확보했고 일정도 준비 완료했습니다",
      confirmed_reservations: "확정 예약은 3건이고 총액은 120만원입니다",
      seasonality_outlook: "계절성 전망은 과거 매출과 현재 예약을 보면 석 달간 수요가 10% 증가할 것으로 봅니다",
      essential_household_expenses: "필수 가계지출 합계는 월 300만원입니다",
      emergency_buffer_months: "비상자금은 4개월입니다",
    };
    let live = third.snapshot;
    for (let turn = 4; live.nextQuestion !== null && turn <= 12; turn += 1) {
      const infoCode = live.nextQuestion.infoCode;
      const text = remainingAnswers[infoCode];
      if (!text) throw new Error(`acceptance fixture missing: ${infoCode}`);
      live = service.addMessageCommand(
        created.session.id,
        {
          text,
          clientMessageId: `acceptance-message-${turn}`,
          expectedVersion: live.session.version,
          currentQuestionInfoCode: infoCode,
        },
        principal,
      ).snapshot;
    }
    expect(live.nextQuestion).toBeNull();
    expect(live.coverage.overallRate).toBe(1);
    expect(live.canonicalInformationItems).toHaveLength(11);
    expect(
      live.canonicalInformationItems
        .filter((record) => record.required)
        .every((record) => record.status === "CONFIRMED"),
    ).toBe(true);

    const completed = service.completeInterviewCommand(
      created.session.id,
      {
        clientCommandId: "acceptance-complete",
        expectedVersion: live.session.version,
        mode: "COMPLETE",
        borrowerConfirmed: true,
        reason: null,
      },
      principal,
    );
    expect(completed.evaluationEligibility).toMatchObject({
      eligible: true,
      mode: "COMPLETE",
      blockers: [],
    });
    expect(completed.evaluation).toMatchObject({
      status: "READY",
      decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
      approvalDecision: null,
      creditGrade: null,
    });
    const finalSnapshot = completed.snapshot as unknown as ImmutableFinalInterviewSnapshotV1;
    expect(finalSnapshot.snapshotType).toBe("FINAL");
    expect(finalSnapshot.completionStatus).toBe("COMPLETE");
    expect(finalSnapshot.features.snapshotType).toBe("FINAL");
    expect(finalSnapshot.borrowerSummary.snapshotType).toBe("FINAL");
    expect(validateImmutableFinalSnapshotV1(finalSnapshot)).toEqual([]);
    expect(
      finalSnapshot.evidenceManifest
        .filter((ref) => ref.transcriptSegmentId !== null)
        .every((ref) =>
          finalSnapshot.transcript.some(
            (segment) =>
              segment.id === ref.transcriptSegmentId && segment.confirmation === "FINAL",
          ),
        ),
    ).toBe(true);
  });
});
