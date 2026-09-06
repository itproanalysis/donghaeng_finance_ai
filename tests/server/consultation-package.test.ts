import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryDatabase } from "../../src/server/database";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";
import { ConsultationPackageService } from "../../src/server/consultation-package-service";
import { ConsultationDraftService } from "../../src/server/consultation-draft-service";
import { RecoveryService } from "../../src/server/recovery-service";
import { LOCAL_WORKSPACE_EMAIL, LOCAL_WORKSPACE_TENANT_ID, LOCAL_WORKSPACE_USER_ID, type Principal } from "../../src/server/auth";
import { createBorrowerRequiredInformationList } from "../../src/components/borrower-interview-preferences";
import { CONSULTATION_DOCUMENTS, emptyConsultationDraft } from "../../src/domain/consultation-draft";
import { JUDGE_DEMO } from "../../src/domain/judge-demo";

const principal: Principal = { tenantId: LOCAL_WORKSPACE_TENANT_ID, userId: LOCAL_WORKSPACE_USER_ID, email: LOCAL_WORKSPACE_EMAIL, displayName: "상담 준비 시험", roles: ["INTERVIEWER"] };
const databases: DatabaseSync[] = [];
afterEach(() => { vi.unstubAllEnvs(); databases.splice(0).forEach((db) => db.close()); });
function harness(finalize = true) {
  const db = createInMemoryDatabase(); databases.push(db);
  const repository = new InterviewRepository(db);
  const interviews = new InterviewService(repository);
  const live = interviews.createInterview(principal, createBorrowerRequiredInformationList("CAFE", "FULL_REVIEW"), "CAFE", JUDGE_DEMO);
  const id = live.session.id;
  interviews.addMessageCommand(id, { text: JUDGE_DEMO.answers[0], clientMessageId: "sales", expectedVersion: 1, currentQuestionInfoCode: "monthly_average_sales" }, principal);
  if (finalize) interviews.completeInterviewCommand(id, { clientCommandId: "finish", expectedVersion: interviews.getDataReview(id, principal).version, mode: "FORCE_INCOMPLETE", borrowerConfirmed: true, reason: "미확인 정보를 포함한 상담 준비 시험" }, principal);
  return { db, id, repository, interviews, service: new ConsultationPackageService(db, interviews), drafts: new ConsultationDraftService(db), recovery: new RecoveryService(db, interviews) };
}

describe("financial institution consultation package", () => {
  it("requires a confirmed final record and retains tenant boundaries", () => {
    const { service, id } = harness(false);
    expect(() => service.get(id, principal)).toThrow(/인터뷰를 마친 뒤/);
    expect(() => service.get(id, { ...principal, tenantId: "another-tenant" })).toThrow();
    expect(() => service.get("missing", principal)).toThrow();
  });

  it("exports source lineage and missingness without requiring missions or a complete document checklist", () => {
    const { service, id, interviews, drafts, repository, db } = harness();
    const before = repository.getFinalSnapshot(id);
    const saved = drafts.save(id, principal, 0, { ...emptyConsultationDraft(), institutionId: "koreg", documents: [CONSULTATION_DOCUMENTS[0]] });
    const auditCount = db.prepare("SELECT count(*) AS n FROM audit_events").get()?.n;
    const first = service.get(id, principal);
    expect(first.review).toEqual(interviews.getDataReview(id, principal));
    expect(first.draft).toEqual(saved);
    expect(first.recovery).toMatchObject({ selection: null, evidence: [], completedMissionIds: [] });
    expect(first.deliveryStatus).toBe("NOT_SENT");
    const feature = first.review.features.find((item) => item.name === "fin_sales_avg_3m")!;
    expect(feature.value).toBe(23_000_000);
    expect(feature.evidenceIds.some((eid) => first.review.evidence.find((entry) => entry.id === eid)?.originalText === JUDGE_DEMO.answers[0])).toBe(true);
    expect(first.review.features.find((item) => item.name === "crd_credit_score")).toMatchObject({ value: null, state: "MISSING" });
    expect(service.get(id, principal).draft).toEqual(saved);
    expect(repository.getFinalSnapshot(id)).toEqual(before);
    expect(db.prepare("SELECT count(*) AS n FROM audit_events").get()?.n).toBe(auditCount);
    expect(db.isTransaction).toBe(false);
  });

  it("includes the saved action and latest self-reported evidence without changing final features", () => {
    const { id, interviews, service, recovery, repository } = harness();
    const final = repository.getFinalSnapshot(id);
    const before = service.get(id, principal);
    recovery.select(id, principal, { clientCommandId: "choose", candidateId: interviews.getDataReview(id, principal).candidates[0].id });
    const record = recovery.addEvidence(id, principal, { clientCommandId: "record", expectedRevision: 0, missionId: 1, title: "합성 매출 자료 준비", note: "최근 3개월의 합성 매출 자료를 상담용으로 준비했습니다.", observedOn: "2026-09-06" });
    const after = service.get(id, principal);
    expect(after.recovery).toEqual(record);
    expect(after.review.features).toEqual(before.review.features);
    expect(after.review.finalHash).toBe(before.review.finalHash);
    expect(repository.getFinalSnapshot(id)).toEqual(final);
  });

  it("does not expose the operator draft or grant draft access to a non-operator", () => {
    const { id, service, drafts } = harness();
    drafts.save(id, principal, 0, { ...emptyConsultationDraft(), institutionId: "kodit" });
    const borrower = { ...principal, roles: ["BORROWER"] };
    const result = service.get(id, borrower);
    expect(result.canEditDraft).toBe(false);
    expect(result.draft).toBeNull();
    expect(result.review.features).toHaveLength(100);
    expect(() => drafts.get(id, borrower)).toThrow(/담당자/);
    expect(() => service.get(id, { ...borrower, tenantId: "another-tenant" })).toThrow();
  });

  it("labels the public synthetic deployment without mislabeling workspace records", () => {
    const { id, service } = harness();
    vi.stubEnv("DONGHAENG_AUTH_MODE", "local");
    expect(service.get(id, principal).environment).toBe("WORKSPACE");
    vi.stubEnv("DONGHAENG_AUTH_MODE", "public-review");
    expect(service.get(id, principal).environment).toBe("SYNTHETIC_DEMO");
  });
});
