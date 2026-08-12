import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import type { MoneyValue } from "../../src/domain/interview";
import { InvalidInformationTransitionError } from "../../src/domain/state-machine";
import { createInMemoryDatabase } from "../../src/server/database";
import { ApplicationError } from "../../src/server/errors";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const databases: DatabaseSync[] = [];

function createHarness() {
  const database = createInMemoryDatabase();
  databases.push(database);
  const repository = new InterviewRepository(database);
  let id = 0;
  const service = new InterviewService(repository, {
    now: () => new Date("2026-08-09T12:00:00.000Z"),
    idFactory: () => `test-id-${++id}`,
  });
  return { database, repository, service };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("InterviewService vertical slice", () => {
  it("빈 인터뷰는 사장님이 확인할 때까지 어떤 매출 사실도 가정하지 않는다", () => {
    const { service } = createHarness();
    const snapshot = service.createInterview();

    expect(snapshot.session.snapshotType).toBe("PREVIEW");
    expect(snapshot.borrower.name).toBe("사장님");
    expect(snapshot.business.industry).toBe("카페");
    expect(snapshot.informationItems.length).toBeGreaterThanOrEqual(6);
    expect(new Set(snapshot.informationItems.map((item) => item.category)).size).toBe(4);
    expect(snapshot.nextQuestion?.infoCode).toBe("monthly_average_sales");
    expect(
      snapshot.informationItems.find((item) => item.infoCode === "monthly_average_sales"),
    ).toMatchObject({
      priority: "P0",
      status: "ASKING",
      valueState: "MISSING",
      value: null,
      quality: null,
      verification: null,
      evidenceIds: [],
    });
    expect(snapshot.coverage).toMatchObject({
      resolvedRequired: 0,
      evaluableRequired: 0,
      overallRate: 0,
    });
    expect(snapshot.nextQuestion?.text).toContain("최근 매출 흐름");
  });

  it("allow-list된 업종 프로필을 실제 interview business에 반영한다", () => {
    const { service } = createHarness();
    const snapshot = service.createInterview(
      undefined,
      null,
      "ONLINE_SHOPPING",
    );

    expect(snapshot.business).toMatchObject({
      industry: "온라인 쇼핑",
      businessName: "온라인 쇼핑 사업체",
    });
  });

  it("정상 금액 답변에서 transcript, evidence, 상태와 coverage를 함께 갱신한다", () => {
    const { service } = createHarness();
    const created = service.createInterview();
    const result = service.addMessage(created.session.id, "월 2,300만원입니다");
    const monthlySales = result.snapshot.informationItems.find(
      (item) => item.infoCode === "monthly_average_sales",
    );

    expect(monthlySales?.status).toBe("CONFIRMED");
    expect(monthlySales?.valueState).toBe("PRESENT");
    expect((monthlySales?.value as MoneyValue).amount).toBe(23_000_000);
    expect(monthlySales?.evidenceIds).toEqual([result.evidenceAdded[0].id]);
    expect(result.acceptedTranscript.confirmation).toBe("FINAL");
    expect(result.snapshot.transcript.some((segment) => segment.text.includes("2,300만원"))).toBe(true);
    expect(result.snapshot.coverage.evaluableRequired).toBe(1);
    expect(result.snapshot.nextQuestion).toBeNull();
    expect(result.snapshot.coverage.statusConfirmationRate).toBeGreaterThan(0);
    expect(result.stateChanges.map((event) => event.toStatus)).toContain("COLLECTED");
    expect(result.stateChanges.map((event) => event.toStatus)).toContain("CONFIRMED");
  });

  it("0원을 missing과 구분하고 사장님이 직접 확인한 값으로 보존한다", () => {
    const { service } = createHarness();
    const created = service.createInterview();
    const result = service.addMessage(created.session.id, "이번 달은 0원입니다");
    const monthlySales = result.snapshot.informationItems.find(
      (item) => item.infoCode === "monthly_average_sales",
    );

    expect(monthlySales?.valueState).toBe("PRESENT");
    expect((monthlySales?.value as MoneyValue).amount).toBe(0);
    expect(monthlySales?.status).toBe("CONFIRMED");
    expect(monthlySales?.prefill).toBeNull();
    expect(monthlySales?.verification).toBe("SELF_REPORTED");
  });

  it("모호한 답변에는 숫자를 만들지 않고 후속질문을 반환한다", () => {
    const { service } = createHarness();
    const created = service.createInterview();
    const result = service.addMessage(created.session.id, "월마다 다르다");
    const monthlySales = result.snapshot.informationItems.find(
      (item) => item.infoCode === "monthly_average_sales",
    );

    expect(monthlySales).toMatchObject({
      status: "NEEDS_FOLLOWUP",
      valueState: "UNKNOWN",
      value: null,
    });
    expect(result.snapshot.nextQuestion?.infoCode).toBe("monthly_average_sales");
    expect(result.snapshot.nextQuestion?.text).toContain("가장 낮은 달과 높은 달");
  });

  it("불가능한 전이를 차단하고 거절 event를 기록한다", () => {
    const { repository, service } = createHarness();
    const created = service.createInterview();

    expect(() =>
      repository.transitionStatus(
        created.session.id,
        "monthly_average_sales",
        "CONFIRMED",
        "테스트용 잘못된 건너뛰기",
        "rejected-event",
        "2026-08-09T12:00:01.000Z",
      ),
    ).toThrow(InvalidInformationTransitionError);
    expect(repository.listEventsAfter(created.session.id, 0)).toContainEqual(
      expect.objectContaining({
        eventType: "STATUS_CHANGE_REJECTED",
        accepted: false,
        fromStatus: "ASKING",
        toStatus: "CONFIRMED",
      }),
    );
  });

  it("FINAL snapshot을 고정하고 종료 뒤 PREVIEW 변경을 거부한다", () => {
    const { database, repository, service } = createHarness();
    const created = service.createInterview();
    service.addMessage(created.session.id, "2300만 원입니다");
    const first = service.completeInterview(created.session.id);
    const serialized = JSON.stringify(first.snapshot);

    expect(first.snapshot.snapshotType).toBe("FINAL");
    expect(first.evaluation.decisionScope).toBe("DATA_SUFFICIENCY_ONLY");
    expect(first.evaluation.approvalDecision).toBeNull();
    expect(() => service.addMessage(created.session.id, "수정 답변입니다")).toThrow(
      ApplicationError,
    );
    expect(service.completeInterview(created.session.id).snapshot.id).toBe(first.snapshot.id);
    expect(JSON.stringify(repository.getFinalSnapshot(created.session.id))).toBe(serialized);
    expect(service.getLiveSnapshot(created.session.id).nextQuestion).toBeNull();
    expect(() =>
      database
        .prepare("UPDATE final_snapshots SET snapshot_json = ? WHERE interview_id = ?")
        .run("{}", created.session.id),
    ).toThrow(/immutable/i);
    expect(() =>
      database
        .prepare(
          `INSERT OR REPLACE INTO final_snapshots(
            id, interview_id, version, snapshot_json, created_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          first.snapshot.id,
          created.session.id,
          99,
          '{"changed":true}',
          first.snapshot.finalizedAt,
        ),
    ).toThrow(/immutable/i);
  });
});
