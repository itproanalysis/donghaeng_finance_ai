import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryDatabase } from "../../src/server/database";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";
import { LOCAL_WORKSPACE_EMAIL, LOCAL_WORKSPACE_TENANT_ID, LOCAL_WORKSPACE_USER_ID, type Principal } from "../../src/server/auth";
import { createBorrowerRequiredInformationList } from "../../src/components/borrower-interview-preferences";
import { JUDGE_DEMO } from "../../src/domain/judge-demo";
import { RecoveryService } from "../../src/server/recovery-service";

const principal: Principal = { tenantId: LOCAL_WORKSPACE_TENANT_ID, userId: LOCAL_WORKSPACE_USER_ID, email: LOCAL_WORKSPACE_EMAIL, displayName: "테스트", roles: ["ADMIN", "INTERVIEWER"] };
const databases: DatabaseSync[] = [];
afterEach(() => { vi.unstubAllEnvs(); databases.splice(0).forEach((database) => database.close()); });
function harness() {
  const database = createInMemoryDatabase(); databases.push(database);
  const repository = new InterviewRepository(database);
  const service = new InterviewService(repository);
  const live = service.createInterview(principal, createBorrowerRequiredInformationList("CAFE", "FULL_REVIEW"), "CAFE", JUDGE_DEMO);
  return { database, repository, service, id: live.session.id };
}
describe("real interview → canonical → feature → evidence", () => {
  it("projects 23,000,000 KRW from actual input and traces the exact canonical revision to original evidence", () => {
    const { service, id } = harness();
    const before = service.getDataReview(id, principal);
    expect(before.metrics).toMatchObject({ computed: 0, missing: 100, evidence: 0 });
    const snapshot = service.getInterviewSnapshot(id, principal);
    const text = "최근 3개월 평균 매출은 2300만원입니다.";
    service.addMessageCommand(id, { text, clientMessageId: "sales-23m", expectedVersion: snapshot.session.version, currentQuestionInfoCode: "monthly_average_sales" }, principal);
    const review = service.getDataReview(id, principal);
    expect(review.canonical.find((item) => item.infoCode === "monthly_average_sales")?.selected?.value).toMatchObject({ amount: { kind: "EXACT", value: 23_000_000 } });
    const feature = review.features.find((item) => item.name === "fin_sales_avg_3m")!;
    expect(feature).toMatchObject({ state: "COMPUTED", value: 23_000_000, modelCandidate: false });
    expect(feature.traces[0].infoCode).toBe("monthly_average_sales");
    expect(feature.traces[0].revisionId).toBe(review.canonical.find((item) => item.infoCode === "monthly_average_sales")?.selectedRevisionId);
    expect(review.evidence.find((item) => item.id === feature.evidenceIds[0])?.originalText).toBe(text);
    expect(review.features.find((item) => item.name === "crd_credit_score")).toMatchObject({ state: "MISSING", value: null });
    expect(review.metrics.computed + review.metrics.missing + review.metrics.notCalculable).toBe(100);
  });
  it("freezes feature v2 with FINAL and leaves missing data explicit in the three-answer judge scenario", () => {
    const { service, repository, id } = harness();
    for (const [index, text] of JUDGE_DEMO.answers.entries()) {
      const snapshot = service.getInterviewSnapshot(id, principal);
      if (snapshot.snapshotType !== "PREVIEW") throw new Error("expected LIVE");
      service.addMessageCommand(id, { text, clientMessageId: `judge-${index}`, expectedVersion: snapshot.session.version, currentQuestionInfoCode: snapshot.nextQuestion?.infoCode ?? null }, principal);
    }
    const liveReview = service.getDataReview(id, principal);
    expect(liveReview.features.find((item) => item.name === "fin_sales_avg_3m")?.value).toBe(23_000_000);
    expect(liveReview.features.find((item) => item.name === "ops_repeat_customer_ratio")?.value).toBe(.5);
    expect(liveReview.features.find((item) => item.name === "fin_fixed_cost_ratio")?.value).toBe(.31);
    expect(liveReview.canonical.find((item) => item.infoCode === "improvement_plan")?.status).toBe("CONFIRMED");
    service.completeInterviewCommand(id, { clientCommandId: "judge-final", expectedVersion: liveReview.version, mode: "FORCE_INCOMPLETE", borrowerConfirmed: true, reason: "합성 시연에서 확인한 범위와 미확인 항목을 함께 보존" }, principal);
    const final = service.getDataReview(id, principal);
    expect(final.featureArtifactOrigin).toBe("FROZEN_FINAL");
    expect(final.features).toEqual(liveReview.features);
    const stored = repository.getFinalSnapshot(id);
    vi.stubEnv("ENABLE_FEATURE_V2", "false");
    expect(service.getDataReview(id, principal).features).toEqual(final.features);
    expect(repository.getFinalSnapshot(id)).toEqual(stored);
    expect(final.finalHash).toMatch(/^sha256:/);
    expect(() => service.getDataReview(id, { ...principal, tenantId: "another-tenant" })).toThrow();
  });
});

describe("post-analysis recovery and human review", () => {
  function finalized() {
    const context = harness();
    context.service.completeInterviewCommand(context.id, { clientCommandId: "finish", expectedVersion: 1, mode: "FORCE_INCOMPLETE", borrowerConfirmed: true, reason: "합성 시험의 미확인 원본 보존" }, principal);
    const recovery = new RecoveryService(context.database, context.service);
    return { ...context, recovery };
  }
  const evidenceCommand = { clientCommandId: "evidence-1", expectedRevision: 0, missionId: 1, title: "합성 증빙 준비", note: "실제 고객자료가 아닌 합성 자료의 기준 기간을 확인한 기록입니다.", observedOn: "2026-09-05" };
  it("requires FINAL and a voluntary server-allowlisted action, never client-supplied feature values", () => {
    const { database, service, id } = harness();
    const recovery = new RecoveryService(database, service);
    expect(() => recovery.get(id, principal)).toThrow(/FINAL/);
    const finalizedCase = finalized();
    expect(() => finalizedCase.recovery.addEvidence(finalizedCase.id, principal, evidenceCommand)).toThrow(/Action/);
    expect(() => finalizedCase.recovery.select(finalizedCase.id, principal, { candidateId: "invented", clientCommandId: "select-1" })).toThrow(/서버/);
    expect(() => finalizedCase.recovery.select(finalizedCase.id, principal, { candidateId: "SKIP", clientCommandId: "select-1", score: 100 })).toThrow(/허용/);
  });
  it("appends idempotent evidence, preserves final/hash/features, protects tenants, and enforces mission order and CAS", () => {
    const { recovery, repository, database, service, id } = finalized();
    const finalBefore = repository.getFinalSnapshot(id);
    const featuresBefore = service.getDataReview(id, principal).features;
    const candidate = service.getDataReview(id, principal).candidates[0];
    recovery.select(id, principal, { candidateId: candidate.id, clientCommandId: "select-1" });
    expect(() => recovery.select(id, principal, { candidateId: "SKIP", clientCommandId: "select-2" })).toThrow(/기존 선택/);
    expect(() => recovery.addEvidence(id, principal, { ...evidenceCommand, missionId: 2 })).toThrow(/앞 단계/);
    const first = recovery.addEvidence(id, principal, evidenceCommand);
    expect(first.evidence[0]).toMatchObject({ note: evidenceCommand.note, kind: "SELF_REPORTED", eventType: "NEW_EVIDENCE" });
    expect(recovery.addEvidence(id, principal, evidenceCommand)).toEqual(first);
    expect(() => recovery.addEvidence(id, principal, { ...evidenceCommand, title: "변경" })).toThrow(/같은 요청/);
    expect(() => recovery.addEvidence(id, principal, { ...evidenceCommand, clientCommandId: "stale" })).toThrow(/다른 창/);
    expect(() => recovery.get(id, { ...principal, tenantId: "foreign" })).toThrow();
    expect(() => database.prepare("UPDATE recovery_evidence SET title = '변조' WHERE id = ?").run(first.evidence[0].id)).toThrow(/append-only/);
    expect(() => database.prepare("DELETE FROM recovery_evidence WHERE id = ?").run(first.evidence[0].id)).toThrow(/append-only/);
    for (const missionId of [2, 3]) recovery.addEvidence(id, principal, { ...evidenceCommand, missionId, expectedRevision: missionId - 1, clientCommandId: `evidence-${missionId}` });
    expect(recovery.get(id, principal).completedMissionIds).toEqual([1, 2, 3]);
    expect(repository.getFinalSnapshot(id)).toEqual(finalBefore);
    expect(service.getDataReview(id, principal).features).toEqual(featuresBefore);
  });
  it("limits human review to role-authorized information review and rejects forged approval states", () => {
    const { recovery, id, database } = finalized();
    const command = { clientCommandId: "review-1", expectedRevision: 0, status: "NEEDS_INFORMATION", note: "자료의 기준 기간 추가 확인" };
    expect(() => recovery.review(id, { ...principal, roles: ["BORROWER"] }, command)).toThrow(/담당자/);
    expect(() => recovery.review(id, principal, { ...command, status: "APPROVED" })).toThrow(/검토 상태/);
    const saved = recovery.review(id, principal, command);
    expect(saved.review).toMatchObject({ status: "NEEDS_INFORMATION", revision: 1 });
    expect(recovery.review(id, principal, command)).toEqual(saved);
    expect(() => recovery.review(id, principal, { ...command, clientCommandId: "review-stale" })).toThrow(/다른 창/);
    recovery.review(id, principal, { ...command, expectedRevision: 1, clientCommandId: "review-2", status: "REVIEWED" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM data_review_decisions").get()?.count).toBe(2);
    expect(() => database.prepare("DELETE FROM data_review_decisions").run()).toThrow(/append-only/);
  });
});
