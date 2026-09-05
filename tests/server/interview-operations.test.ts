import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { interviewNextAction } from "../../src/domain/interview-operations";
import { LOCAL_WORKSPACE_EMAIL, LOCAL_WORKSPACE_TENANT_ID, LOCAL_WORKSPACE_USER_ID, type Principal } from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const principal: Principal = { tenantId: LOCAL_WORKSPACE_TENANT_ID, userId: LOCAL_WORKSPACE_USER_ID, email: LOCAL_WORKSPACE_EMAIL, displayName: "담당자", roles: ["ADMIN", "INTERVIEWER"] };
const databases: DatabaseSync[] = [];
afterEach(() => { while (databases.length) databases.pop()?.close(); });
function harness() {
  const db = createInMemoryDatabase(); databases.push(db);
  let id = 0;
  const service = new InterviewService(new InterviewRepository(db), { idFactory: () => `operations-${++id}`, now: () => new Date("2026-09-04T01:00:00.000Z") });
  function create(name = "봄날헤어", actor = principal) { return service.createInterview(actor, null, "BEAUTY", { borrowerName: "김사장", businessName: name }); }
  return { db, service, create };
}

describe("real administrator case board", () => {
  it("has an honest empty state without fabricated cases", () => {
    const { service } = harness();
    expect(service.listInterviewOperations(principal)).toEqual({ items: [], total: 0, limit: 24, offset: 0, hasMore: false, summary: { total: 0, active: 0, attention: 0, complete: 0, incomplete: 0 } });
  });
  it("uses the actual profile, current question and saved answer count", () => {
    const { service, create } = harness();
    const session = create();
    const updated = service.addMessageCommand(session.session.id, { text: "월평균 매출은 1500만원입니다.", clientMessageId: "board-answer", expectedVersion: session.session.version, currentQuestionInfoCode: session.nextQuestion!.infoCode }, principal);
    const result = service.listInterviewOperations(principal);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ id: session.session.id, businessName: "봄날헤어", borrowerName: "김사장", lifecycleStatus: "ACTIVE", borrowerAnswerCount: 1, conflictCount: 0, processingFailed: false, currentQuestionCode: updated.snapshot.nextQuestion?.infoCode });
    expect(result.items[0].industry).not.toContain("카페");
    expect(result.items[0].currentQuestionLabel).toBeTruthy();
    expect(interviewNextAction(result.items[0]).href).toBe(`/interviews/${session.session.id}`);
  });
  it("does not label unavailable or refused information as missing", () => {
    const { db, service, create } = harness(); const session = create();
    db.prepare("UPDATE information_items SET status = 'UNAVAILABLE' WHERE interview_id = ?").run(session.session.id);
    expect(service.listInterviewOperations(principal).items[0].unresolvedRequiredCount).toBe(0);
    db.prepare("UPDATE information_items SET status = 'REFUSED' WHERE interview_id = ?").run(session.session.id);
    expect(service.listInterviewOperations(principal).items[0].unresolvedRequiredCount).toBe(0);
  });
  it("filters conflicts and completed or stopped records independently", () => {
    const { db, service, create } = harness(); const active = create("확인할 가게"); const stopped = create("중단한 가게");
    db.prepare("UPDATE information_items SET status = 'CONFLICT' WHERE interview_id = ? AND info_code = ?").run(active.session.id, active.nextQuestion!.infoCode);
    const finalized = service.completeInterviewCommand(stopped.session.id, { clientCommandId: "board-stop", expectedVersion: stopped.session.version, mode: "FORCE_INCOMPLETE", reason: "사장님 요청", borrowerConfirmed: true }, principal);
    const result = service.listInterviewOperations(principal, { status: "ATTENTION" });
    expect(result.items.map((item) => item.id)).toEqual([active.session.id]);
    expect(result.summary).toEqual({ total: 2, active: 1, attention: 1, complete: 0, incomplete: 1 });
    const item = service.listInterviewOperations(principal, { status: "INCOMPLETE" }).items[0];
    expect(item.id).toBe(stopped.session.id);
    expect(finalized.evaluation).toBeNull();
    expect(item.evaluationId).toBeNull();
    expect(interviewNextAction(item).href).toBe(`/interviews/${item.id}`);
    expect(interviewNextAction({ ...item, lifecycleStatus: "COMPLETE", evaluationId: "evaluation-1" }).href).toBe("/interview-evaluations/evaluation-1");
    expect(interviewNextAction(result.items[0]).tone).toBe("attention");
  });
  it("shows failed processing only when the latest answer stage is failed", () => {
    const { db, service, create } = harness(); const session = create();
    const addStage = (sequence: number, status: string) => {
      const transcript = `stage-transcript-${sequence}`;
      db.prepare("INSERT INTO transcript_segments(id, interview_id, sequence, speaker, text, confirmation, created_at) VALUES (?, ?, ?, 'BORROWER', '응답', 'FINAL', ?)").run(transcript, session.session.id, 100 + sequence, `2026-09-04T01:00:0${sequence}.000Z`);
      db.prepare("INSERT INTO message_command_stages(id, tenant_id, interview_id, client_message_id, request_hash, expected_version, transcript_segment_id, status, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)").run(`stage-${sequence}`, principal.tenantId, session.session.id, `stage-command-${sequence}`, "0".repeat(64), transcript, status, `2026-09-04T01:00:0${sequence}.000Z`);
    };
    addStage(1, "FAILED");
    expect(service.listInterviewOperations(principal, { status: "ATTENTION" }).items[0].processingFailed).toBe(true);
    addStage(2, "APPLIED");
    expect(service.listInterviewOperations(principal, { status: "ATTENTION" }).total).toBe(0);
  });
  it("searches names literally and paginates deterministically with equal timestamps", () => {
    const { service, create } = harness(); for (let i = 0; i < 5; i++) create(`가게 ${i}`);
    const first = service.listInterviewOperations(principal, { limit: 2 });
    const next = service.listInterviewOperations(principal, { limit: 2, offset: 2 });
    const last = service.listInterviewOperations(principal, { limit: 2, offset: 4 });
    expect(new Set([...first.items, ...next.items, ...last.items].map((item) => item.id)).size).toBe(5);
    expect(first.hasMore).toBe(true); expect(last.hasMore).toBe(false);
    expect(service.listInterviewOperations(principal, { q: "가게 1" }).total).toBe(1);
    expect(service.listInterviewOperations(principal, { q: "' OR 1=1 --" }).total).toBe(0);
    expect(service.listInterviewOperations(principal, { q: "%" }).total).toBe(0);
  });
  it("isolates tenants and denies non-operator roles", () => {
    const { service, create } = harness(); create();
    expect(service.listInterviewOperations({ ...principal, tenantId: "other-tenant" }).total).toBe(0);
    expect(() => service.listInterviewOperations({ ...principal, roles: ["BORROWER"] })).toThrow("담당자");
  });
});
