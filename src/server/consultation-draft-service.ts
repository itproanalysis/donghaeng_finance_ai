import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  CONSULTATION_DOCUMENTS, CONSULTATION_INSTITUTIONS, CONSULTATION_OWNERS, CONSULTATION_PERIODS,
  emptyConsultationDraft, type ConsultationDraftData, type ConsultationDraftRecord,
} from "@/domain/consultation-draft";
import type { Principal } from "./auth";
import { ApplicationError } from "./errors";
import { PlatformRepository } from "./platform-repository";

export function readConsultationDraftData(value: unknown): ConsultationDraftData {
  const invalid = () => new ApplicationError(400, "INVALID_CONSULTATION_DRAFT", "상담 초안의 입력값을 확인해 주세요.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["proposalId", "owner", "period", "documents", "reviewed", "institutionId"].includes(key))
    || !(data.proposalId === null || (typeof data.proposalId === "string" && data.proposalId.length > 0 && data.proposalId.length <= 160))
    || typeof data.owner !== "string" || !(CONSULTATION_OWNERS as readonly string[]).includes(data.owner)
    || typeof data.period !== "string" || !(CONSULTATION_PERIODS as readonly string[]).includes(data.period)
    || !Array.isArray(data.documents) || data.documents.length > CONSULTATION_DOCUMENTS.length
    || !data.documents.every((item) => typeof item === "string" && (CONSULTATION_DOCUMENTS as readonly string[]).includes(item))
    || new Set(data.documents).size !== data.documents.length
    || typeof data.reviewed !== "boolean"
    || !(data.institutionId === null || (typeof data.institutionId === "string" && (CONSULTATION_INSTITUTIONS as readonly string[]).includes(data.institutionId)))) throw invalid();
  return {
    proposalId: data.proposalId as string | null, owner: data.owner, period: data.period,
    documents: CONSULTATION_DOCUMENTS.filter((document) => (data.documents as string[]).includes(document)),
    reviewed: data.reviewed, institutionId: data.institutionId as string | null,
  };
}

export class ConsultationDraftService {
  constructor(private readonly database: DatabaseSync) {}

  private assertAccess(interviewId: string, principal: Principal) {
    if (!principal.roles.some((role) => ["ADMIN", "INTERVIEWER"].includes(role))) {
      throw new ApplicationError(403, "OPERATOR_REQUIRED", "상담 초안은 담당자 계정에서만 확인할 수 있습니다.");
    }
    new PlatformRepository(this.database).getInterviewAggregate(principal.tenantId, interviewId);
  }

  get(interviewId: string, principal: Principal): ConsultationDraftRecord {
    this.assertAccess(interviewId, principal);
    const row = this.database.prepare("SELECT revision, draft_json, updated_at FROM consultation_drafts WHERE tenant_id = ? AND interview_id = ?").get(principal.tenantId, interviewId);
    return {
      interviewId, revision: row ? Number(row.revision) : 0, updatedAt: row ? String(row.updated_at) : null,
      data: row ? readConsultationDraftData(JSON.parse(String(row.draft_json))) : emptyConsultationDraft(),
    };
  }

  save(interviewId: string, principal: Principal, expectedRevision: number, input: unknown): ConsultationDraftRecord {
    this.assertAccess(interviewId, principal);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ApplicationError(400, "INVALID_DRAFT_REVISION", "상담 초안의 저장 버전을 확인해 주세요.");
    }
    const data = readConsultationDraftData(input);
    const serialized = JSON.stringify(data);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.get(interviewId, principal);
      if (current.revision !== expectedRevision) {
        // A lost response may be retried safely without a second revision/audit.
        if (current.revision === expectedRevision + 1 && JSON.stringify(current.data) === serialized) {
          this.database.exec("COMMIT;");
          return current;
        }
        throw new ApplicationError(409, "CONSULTATION_DRAFT_CONFLICT", "다른 창에서 초안이 변경됐습니다. 현재 입력을 확인한 뒤 최신 초안을 불러와 주세요.", { currentRevision: current.revision });
      }
      const updatedAt = new Date().toISOString();
      const revision = current.revision + 1;
      this.database.prepare(`INSERT INTO consultation_drafts(tenant_id, interview_id, revision, draft_json, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, interview_id) DO UPDATE SET revision = excluded.revision,
        draft_json = excluded.draft_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .run(principal.tenantId, interviewId, revision, serialized, principal.userId, updatedAt);
      this.database.prepare("INSERT INTO audit_events(id, interview_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(randomUUID(), interviewId, "CONSULTATION_DRAFT_SAVED", JSON.stringify({ revision, actorUserId: principal.userId, scope: "WORKING_DRAFT_ONLY" }), updatedAt);
      this.database.exec("COMMIT;");
      return { interviewId, revision, updatedAt, data };
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }
}
