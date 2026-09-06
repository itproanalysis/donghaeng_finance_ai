import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { RecoveryEvidence, RecoveryState, ReviewStatus } from "@/domain/recovery-journey";
import { BORROWER_SELECTED_IMPROVEMENT_CANDIDATE } from "@/domain/improvement-candidate-selection";
import type { Principal } from "./auth";
import type { InterviewService } from "./interview-service";
import { InterviewRepository } from "./interview-repository";
import { ApplicationError } from "./errors";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const invalid = (message: string) => new ApplicationError(400, "INVALID_RECOVERY_COMMAND", message);
function fields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw invalid("허용되지 않은 항목이 있습니다.");
  if (typeof body.clientCommandId !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(body.clientCommandId)) throw invalid("요청 식별자가 필요합니다.");
}
function text(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string" || value.trim().length < minimum || value.trim().length > maximum) throw invalid(`기록은 ${minimum}~${maximum}자로 입력해 주세요.`);
  return value.trim();
}

export class RecoveryService {
  private readonly repository: InterviewRepository;
  constructor(private readonly database: DatabaseSync, private readonly interviews: InterviewService) { this.repository = new InterviewRepository(database); }
  get(interviewId: string, principal: Principal): RecoveryState {
    const snapshot = this.interviews.getInterviewSnapshot(interviewId, principal);
    if (snapshot.snapshotType !== "FINAL") throw new ApplicationError(409, "FINAL_REQUIRED", "인터뷰 결과를 확인하고 FINAL로 보존한 뒤 실행기록을 남길 수 있습니다.");
    const rows = this.database.prepare("SELECT * FROM recovery_evidence WHERE tenant_id = ? AND interview_id = ? ORDER BY created_at, id").all(principal.tenantId, interviewId);
    const evidence: RecoveryEvidence[] = rows.map((row) => ({ id: String(row.id), interviewId, finalSnapshotId: String(row.final_snapshot_id), missionId: Number(row.mission_id), title: String(row.title), note: String(row.note), observedOn: String(row.observed_on), createdAt: String(row.created_at), kind: "SELF_REPORTED", eventType: "NEW_EVIDENCE", contentHash: `sha256:${row.content_hash}` }));
    const review = this.database.prepare("SELECT status, revision, note, created_at FROM data_review_decisions WHERE tenant_id = ? AND interview_id = ? ORDER BY revision DESC LIMIT 1").get(principal.tenantId, interviewId);
    return { interviewId, finalSnapshotId: snapshot.id, selection: this.repository.getBorrowerImprovementSelection(principal.tenantId, interviewId), evidence,
      completedMissionIds: [...new Set(evidence.map((item) => item.missionId))].sort(), revision: evidence.length,
      review: { status: review ? String(review.status) as ReviewStatus : "PENDING", revision: review ? Number(review.revision) : 0, note: review ? String(review.note) : "", reviewedAt: review ? String(review.created_at) : null },
    };
  }
  select(interviewId: string, principal: Principal, body: Record<string, unknown>) {
    fields(body, ["candidateId", "clientCommandId"]);
    const candidateId = text(body.candidateId, 1, 160);
    return this.repository.transaction(() => {
      const state = this.get(interviewId, principal);
      if (state.selection) {
        const selectedId = state.selection.choice === "SKIP" ? "SKIP" : state.selection.choice.id;
        if (selectedId === candidateId) return state;
        throw new ApplicationError(409, "ACTION_ALREADY_SELECTED", "기존 선택은 변경하지 않습니다. 선택 기록을 확인해 주세요.");
      }
      const review = this.interviews.getDataReview(interviewId, principal);
      const choice = candidateId === "SKIP" ? "SKIP" : review.candidates.find((candidate) => candidate.id === candidateId);
      if (!choice) throw invalid("서버가 제시한 개선 후보에서 선택해 주세요.");
      const now = new Date().toISOString();
      this.repository.insertBorrowerImprovementSelection({ id: randomUUID(), tenantId: principal.tenantId, interviewId, finalSnapshotId: state.finalSnapshotId, choice, liveVersion: review.version, clientCommandId: String(body.clientCommandId), createdAt: now });
      this.repository.insertAuditEvent(randomUUID(), interviewId, BORROWER_SELECTED_IMPROVEMENT_CANDIDATE, { choice, actorUserId: principal.userId, phase: "POST_ANALYSIS", nonBinding: true, excludedFrom: ["CREDIT", "APPROVAL", "DATA_QUALITY_SCORE", "CONFIRMED_GOAL"] }, now);
      return this.get(interviewId, principal);
    });
  }
  addEvidence(interviewId: string, principal: Principal, body: Record<string, unknown>) {
    fields(body, ["missionId", "title", "note", "observedOn", "expectedRevision", "clientCommandId"]);
    const missionId = Number(body.missionId);
    const title = text(body.title, 1, 120), note = text(body.note, 10, 2000), observedOn = text(body.observedOn, 10, 10);
    if (!Number.isInteger(body.missionId) || ![1, 2, 3].includes(missionId) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) throw invalid("미션과 저장 버전을 확인해 주세요.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || !Number.isFinite(Date.parse(observedOn)) || new Date(observedOn).toISOString().slice(0, 10) !== observedOn || observedOn > new Date().toISOString().slice(0, 10)) throw invalid("기록 기준일은 유효한 과거 또는 오늘 날짜여야 합니다.");
    const payload = { missionId, title, note, observedOn, expectedRevision: body.expectedRevision };
    const requestHash = hash(payload);
    return this.repository.transaction(() => {
      const state = this.get(interviewId, principal);
      const receipt = this.database.prepare("SELECT request_hash FROM recovery_evidence WHERE tenant_id = ? AND interview_id = ? AND client_command_id = ?").get(principal.tenantId, interviewId, String(body.clientCommandId));
      if (receipt) {
        if (receipt.request_hash !== requestHash) throw new ApplicationError(409, "IDEMPOTENCY_CONFLICT", "같은 요청 식별자로 다른 기록을 보낼 수 없습니다.");
        return state;
      }
      if (!state.selection || state.selection.choice === "SKIP") throw new ApplicationError(409, "ACTION_REQUIRED", "개선 Action을 직접 선택한 뒤 기록할 수 있습니다.");
      if (state.revision !== body.expectedRevision) throw new ApplicationError(409, "RECOVERY_REVISION_CONFLICT", "다른 창에서 기록이 추가되었습니다. 최신 기록을 불러와 주세요.");
      if (state.revision >= 30) throw new ApplicationError(409, "RECOVERY_RECORD_LIMIT", "데모의 인터뷰별 기록 한도(30개)에 도달했습니다.");
      if (missionId > 1 && !state.completedMissionIds.includes(missionId - 1)) throw new ApplicationError(409, "PREVIOUS_MISSION_REQUIRED", "앞 단계의 기록을 먼저 남겨 주세요.");
      const id = randomUUID(), createdAt = new Date().toISOString();
      const contentHash = hash({ id, interviewId, finalSnapshotId: state.finalSnapshotId, missionId, title, note, observedOn, createdAt, kind: "SELF_REPORTED" });
      this.database.prepare("INSERT INTO recovery_evidence(id, tenant_id, interview_id, final_snapshot_id, mission_id, title, note, observed_on, created_at, created_by, client_command_id, request_hash, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, principal.tenantId, interviewId, state.finalSnapshotId, missionId, title, note, observedOn, createdAt, principal.userId, String(body.clientCommandId), requestHash, contentHash);
      this.repository.insertAuditEvent(randomUUID(), interviewId, "RECOVERY_NEW_EVIDENCE", { evidenceId: id, missionId, finalSnapshotId: state.finalSnapshotId, kind: "SELF_REPORTED", excludedFromAutomaticAssessment: true }, createdAt);
      return this.get(interviewId, principal);
    });
  }
  review(interviewId: string, principal: Principal, body: Record<string, unknown>) {
    if (!principal.roles.some((role) => ["ADMIN", "INTERVIEWER"].includes(role))) throw new ApplicationError(403, "OPERATOR_REQUIRED", "담당자 계정으로 검토 상태를 기록할 수 있습니다.");
    fields(body, ["status", "note", "expectedRevision", "clientCommandId"]);
    if (!["NEEDS_INFORMATION", "REVIEWED"].includes(String(body.status)) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) throw invalid("검토 상태와 버전을 확인해 주세요.");
    const note = text(body.note, 1, 2000);
    const requestHash = hash({ status: body.status, note, expectedRevision: body.expectedRevision });
    return this.repository.transaction(() => {
      const state = this.get(interviewId, principal);
      const receipt = this.database.prepare("SELECT request_hash FROM data_review_decisions WHERE tenant_id = ? AND interview_id = ? AND client_command_id = ?").get(principal.tenantId, interviewId, String(body.clientCommandId));
      if (receipt) {
        if (receipt.request_hash !== requestHash) throw new ApplicationError(409, "IDEMPOTENCY_CONFLICT", "같은 요청 식별자로 다른 검토를 저장할 수 없습니다.");
        return state;
      }
      if (state.review.revision !== body.expectedRevision) throw new ApplicationError(409, "REVIEW_REVISION_CONFLICT", "다른 창에서 검토 상태가 바뀌었습니다. 최신 기록을 불러와 주세요.");
      const now = new Date().toISOString();
      this.database.prepare("INSERT INTO data_review_decisions(id, tenant_id, interview_id, revision, status, note, created_at, created_by, client_command_id, request_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), principal.tenantId, interviewId, state.review.revision + 1, String(body.status), note, now, principal.userId, String(body.clientCommandId), requestHash);
      this.repository.insertAuditEvent(randomUUID(), interviewId, "HUMAN_DATA_REVIEW_RECORDED", { revision: state.review.revision + 1, status: body.status, actorUserId: principal.userId, approvalDecision: null }, now);
      return this.get(interviewId, principal);
    });
  }
}
