import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { CONSULTATION_DOCUMENTS, emptyConsultationDraft } from "../../src/domain/consultation-draft";
import { LOCAL_WORKSPACE_EMAIL, LOCAL_WORKSPACE_TENANT_ID, LOCAL_WORKSPACE_USER_ID, type Principal } from "../../src/server/auth";
import { ConsultationDraftService, readConsultationDraftData } from "../../src/server/consultation-draft-service";
import { createInMemoryDatabase } from "../../src/server/database";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const principal: Principal = { tenantId: LOCAL_WORKSPACE_TENANT_ID, userId: LOCAL_WORKSPACE_USER_ID, email: LOCAL_WORKSPACE_EMAIL, displayName: "담당자", roles: ["INTERVIEWER"] };
const databases: DatabaseSync[] = [];
afterEach(() => { while (databases.length) databases.pop()?.close(); });
function harness() {
  const db = createInMemoryDatabase(); databases.push(db);
  const interview = new InterviewService(new InterviewRepository(db));
  const session = interview.createInterview(principal, null, "BEAUTY", { borrowerName: "김사장", businessName: "초안 테스트 가게" });
  return { db, interview, session, service: new ConsultationDraftService(db) };
}

describe("persisted consultation working drafts", () => {
  it("starts empty without modifying an interview", () => {
    const { service, session } = harness();
    expect(service.get(session.session.id, principal)).toEqual({ interviewId: session.session.id, revision: 0, updatedAt: null, data: emptyConsultationDraft() });
  });
  it("persists every selection across service instances, with one audit entry", () => {
    const { db, service, session } = harness();
    const data = { ...emptyConsultationDraft(), proposalId: "sales_record", owner: "사장님 + 경영지원 담당자", period: "4주 후 점검", documents: [...CONSULTATION_DOCUMENTS].reverse(), reviewed: true, institutionId: "koreg" };
    const saved = service.save(session.session.id, principal, 0, data);
    expect(saved.revision).toBe(1); expect(saved.updatedAt).toBeTruthy();
    expect(saved.data).toEqual({ ...data, documents: [...CONSULTATION_DOCUMENTS] });
    expect(new ConsultationDraftService(db).get(session.session.id, principal)).toEqual(saved);
    const audit = db.prepare("SELECT payload_json FROM audit_events WHERE event_type = 'CONSULTATION_DRAFT_SAVED'").all();
    expect(audit).toHaveLength(1);
    expect(String(audit[0].payload_json)).not.toContain("sales_record");
    expect(String(audit[0].payload_json)).toContain("WORKING_DRAFT_ONLY");
    expect(db.prepare("SELECT version FROM interviews WHERE id = ?").get(session.session.id)?.version).toBe(session.session.version);
  });
  it("rejects stale overwrites but accepts a lost-response retry without duplicate audit", () => {
    const { db, service, session } = harness();
    const first = { ...emptyConsultationDraft(), proposalId: "first" };
    const saved = service.save(session.session.id, principal, 0, first);
    expect(service.save(session.session.id, principal, 0, first)).toEqual(saved);
    expect(() => service.save(session.session.id, principal, 0, { ...first, proposalId: "stale" })).toThrow("다른 창");
    expect(service.get(session.session.id, principal)).toEqual(saved);
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'CONSULTATION_DRAFT_SAVED'").get()?.count).toBe(1);
    expect(service.save(session.session.id, principal, 1, { ...first, proposalId: "latest" }).revision).toBe(2);
  });
  it("keeps FINAL interview and evaluation artifacts immutable when saving a later draft", () => {
    const { db, service, interview, session } = harness();
    interview.completeInterviewCommand(session.session.id, { clientCommandId: "stop-for-consultation", expectedVersion: session.session.version, mode: "FORCE_INCOMPLETE", reason: "다음 상담에서 확인", borrowerConfirmed: true }, principal);
    const readOriginals = () => ({ final: db.prepare("SELECT * FROM final_snapshots").all(), evaluation: db.prepare("SELECT * FROM evaluations").all() });
    const originals = readOriginals();
    service.save(session.session.id, principal, 0, { ...emptyConsultationDraft(), proposalId: "working-only" });
    expect(readOriginals()).toEqual(originals);
  });
  it("denies another tenant, missing interviews and non-operator access", () => {
    const { service, session } = harness();
    expect(() => service.get(session.session.id, { ...principal, tenantId: "other" })).toThrow();
    expect(() => service.save(session.session.id, { ...principal, tenantId: "other" }, 0, emptyConsultationDraft())).toThrow();
    expect(() => service.get("nonexistent", principal)).toThrow();
    expect(() => service.get(session.session.id, { ...principal, roles: [] })).toThrow("담당자");
  });
  it.each([-1, 1.5, NaN, "0", null])("rejects invalid revision %s", (revision) => {
    const { service, session } = harness();
    expect(() => service.save(session.session.id, principal, revision as number, emptyConsultationDraft())).toThrow("버전");
  });
  it.each([
    { owner: "unknown" }, { period: "tomorrow" }, { documents: ["fake"] },
    { documents: [CONSULTATION_DOCUMENTS[0], CONSULTATION_DOCUMENTS[0]] },
    { reviewed: "true" }, { institutionId: "arbitrary-site" }, { proposalId: "" },
    { proposalId: "x".repeat(161) }, { creditScore: 999 },
  ])("rejects invalid or undeclared draft fields %j", (invalid) => {
    expect(() => readConsultationDraftData({ ...emptyConsultationDraft(), ...invalid })).toThrow("입력값");
  });
});
