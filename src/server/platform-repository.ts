import type { DatabaseSync } from "node:sqlite";

import { ApplicationError, EvaluationNotFoundError, InterviewNotFoundError } from "./errors";
import { outboxEventBroker } from "./outbox-broker";

export type CommandType = "MESSAGE" | "COMPLETE";

export const REALTIME_EVENT_TYPES = [
  "transcript.finalized",
  "info.status_changed",
  "info.value_changed",
  "coverage.changed",
  "feature.preview_updated",
  "summary.preview_updated",
  "question.generated",
  "conflict.detected",
  "ready_to_complete",
  "evaluation.ready",
  "interview.completed",
  "transcript.corrected",
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export interface InterviewAggregateState {
  id: string;
  tenantId: string;
  lifecycleStatus: "ACTIVE" | "COMPLETE" | "INCOMPLETE";
  version: number;
  currentQuestionCode: string | null;
  lastEventSeq: number;
}

export interface StoredCommandReceipt<T> {
  requestHash: string;
  resultingVersion: number;
  response: T;
}

export interface MessageCommandStage {
  id: string;
  tenantId: string;
  interviewId: string;
  clientMessageId: string;
  requestHash: string;
  expectedVersion: number;
  currentQuestionCode: string | null;
  transcriptSegmentId: string;
  transcriptMetadata: {
    startMs: number | null;
    endMs: number | null;
    sttConfidence: number | null;
    sttProvider: string | null;
  } | null;
  processingLeaseExpiresAt: string | null;
  status: "PENDING" | "APPLIED" | "FAILED";
  providerMetadata: Record<string, unknown> | null;
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RealtimeEventEnvelope {
  schemaVersion: 1;
  eventId: string;
  seq: number;
  type: RealtimeEventType;
  interviewId: string;
  aggregateVersion: number;
  snapshotType: "PREVIEW" | "FINAL";
  occurredAt: string;
  turnId: string;
  batchIndex: number;
  batchSize: number;
  isBatchFinal: boolean;
  snapshotUrl: string;
  data: Record<string, unknown>;
}

export interface RealtimeEventDraft {
  type: RealtimeEventEnvelope["type"];
  snapshotType: RealtimeEventEnvelope["snapshotType"];
  data: Record<string, unknown>;
}

export interface StoredEvaluationListRecord {
  evaluationId: string;
  interviewId: string;
  status: "PENDING" | "GENERATING" | "READY" | "FAILED";
  createdAt: string;
  completedAt: string | null;
  borrowerName: string;
  businessName: string;
  industry: string;
  confirmedGoalCount: number;
  evaluation: Record<string, unknown>;
  finalSnapshot: Record<string, unknown>;
}

export interface ListEvaluationRecordsOptions {
  search?: string | null;
  industry?: string | null;
  level?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

const EVALUATION_LIST_JOINS = `FROM evaluations e
  JOIN interviews i ON i.id = e.interview_id
  JOIN borrowers b ON b.id = i.borrower_id AND b.tenant_id = i.tenant_id
  JOIN business_profiles p ON p.id = i.business_profile_id AND p.tenant_id = i.tenant_id
  JOIN final_snapshots f ON f.id = e.final_snapshot_id`;
const EVALUATION_LEVEL = "COALESCE(json_extract(e.evaluation_json, '$.overall.grade'), json_extract(e.evaluation_json, '$.overall.level'), 'UNGRADED')";

function evaluationFilters(tenantId: string, options: ListEvaluationRecordsOptions) {
  const conditions = ["i.tenant_id = ?"];
  const params: Array<string | number> = [tenantId];
  if (options.industry?.trim()) { conditions.push("p.industry = ?"); params.push(options.industry.trim()); }
  if (options.from?.trim()) { conditions.push("e.created_at >= ?"); params.push(options.from.trim()); }
  if (options.to?.trim()) { conditions.push("e.created_at <= ?"); params.push(options.to.trim() + "T23:59:59.999Z"); }
  if (options.search?.trim()) {
    const term = `%${options.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push("(b.name LIKE ? ESCAPE '\\' OR p.business_name LIKE ? ESCAPE '\\' OR p.industry LIKE ? ESCAPE '\\' OR i.id LIKE ? ESCAPE '\\' OR e.id LIKE ? ESCAPE '\\')");
    params.push(term, term, term, term, term);
  }
  if (options.level?.trim()) { conditions.push(`${EVALUATION_LEVEL} = ?`); params.push(options.level.trim()); }
  return { where: conditions.join(" AND "), params };
}

interface AggregateRow {
  id: unknown;
  tenant_id: unknown;
  lifecycle_status: unknown;
  version: unknown;
  current_question_code: unknown;
  event_seq: unknown;
}

function parseStoredResponse<T>(value: unknown): T {
  if (typeof value !== "string") {
    throw new ApplicationError(500, "COMMAND_RECEIPT_CORRUPT", "저장된 명령 결과가 손상되었습니다.");
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    return parsed as T;
  } catch {
    throw new ApplicationError(500, "COMMAND_RECEIPT_CORRUPT", "저장된 명령 결과가 손상되었습니다.");
  }
}

function parseStoredObject(
  value: unknown,
  artifact: "evaluation" | "final snapshot",
): Record<string, unknown> {
  if (typeof value !== "string") {
    throw new ApplicationError(
      500,
      "EVALUATION_LIST_PAYLOAD_CORRUPT",
      `저장된 ${artifact} 목록 데이터가 손상되었습니다.`,
    );
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("shape");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApplicationError(
      500,
      "EVALUATION_LIST_PAYLOAD_CORRUPT",
      `저장된 ${artifact} 목록 데이터가 손상되었습니다.`,
    );
  }
}

function mapAggregate(row: AggregateRow): InterviewAggregateState {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    lifecycleStatus: String(row.lifecycle_status) as InterviewAggregateState["lifecycleStatus"],
    version: Number(row.version),
    currentQuestionCode:
      row.current_question_code === null ? null : String(row.current_question_code),
    lastEventSeq: Number(row.event_seq),
  };
}

export class PlatformRepository {
  constructor(readonly database: DatabaseSync) {}

  getInterviewAggregate(tenantId: string, interviewId: string): InterviewAggregateState {
    const row = this.database
      .prepare(
        `SELECT id, tenant_id, lifecycle_status, version, current_question_code, event_seq
         FROM interviews WHERE tenant_id = ? AND id = ?`,
      )
      .get(tenantId, interviewId) as AggregateRow | undefined;
    if (!row) throw new InterviewNotFoundError(interviewId);
    return mapAggregate(row);
  }

  assertEvaluationAccess(tenantId: string, idOrInterviewId: string): void {
    const row = this.database
      .prepare(
        `SELECT e.id
         FROM evaluations e
         JOIN interviews i ON i.id = e.interview_id
         WHERE i.tenant_id = ? AND (e.id = ? OR e.interview_id = ?)
         LIMIT 1`,
      )
      .get(tenantId, idOrInterviewId, idOrInterviewId);
    if (!row) throw new EvaluationNotFoundError(idOrInterviewId);
  }

  findEvaluationIdForInterview(tenantId: string, interviewId: string): string | null {
    const row = this.database
      .prepare(
        `SELECT e.id
         FROM evaluations e
         JOIN interviews i ON i.id = e.interview_id
         WHERE i.tenant_id = ? AND i.id = ?
         LIMIT 1`,
      )
      .get(tenantId, interviewId);
    return row ? String(row.id) : null;
  }

  listEvaluationRecords(
    tenantId: string,
    options: ListEvaluationRecordsOptions = {},
  ): StoredEvaluationListRecord[] {
    const limit = Math.min(500, Math.max(1, Math.trunc(options.limit ?? 200)));
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));

    const { where, params } = evaluationFilters(tenantId, options);
    params.push(limit, offset);

    const querySql = `SELECT
           e.id AS evaluation_id,
           e.interview_id,
           e.status,
           e.created_at,
           i.completed_at,
           b.name AS borrower_name,
           p.business_name,
           p.industry,
           e.evaluation_json,
           f.snapshot_json,
           (
             SELECT COUNT(*)
             FROM evaluation_goals g
             WHERE g.tenant_id = i.tenant_id
               AND g.evaluation_id = e.id
               AND g.status = 'BORROWER_CONFIRMED'
           ) AS confirmed_goal_count
         ${EVALUATION_LIST_JOINS}
         WHERE ${where}
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT ? OFFSET ?`;

    return this.database
      .prepare(querySql)
      .all(...params)
      .map((row): StoredEvaluationListRecord => ({
        evaluationId: String(row.evaluation_id),
        interviewId: String(row.interview_id),
        status: String(row.status) as StoredEvaluationListRecord["status"],
        createdAt: String(row.created_at),
        completedAt: row.completed_at === null ? null : String(row.completed_at),
        borrowerName: String(row.borrower_name),
        businessName: String(row.business_name),
        industry: String(row.industry),
        confirmedGoalCount: Number(row.confirmed_goal_count ?? 0),
        evaluation: parseStoredObject(row.evaluation_json, "evaluation"),
        finalSnapshot: parseStoredObject(row.snapshot_json, "final snapshot"),
      }));
  }

  evaluationListMetadata(tenantId: string, options: ListEvaluationRecordsOptions = {}) {
    const { where, params } = evaluationFilters(tenantId, options);
    const count = this.database.prepare(`SELECT COUNT(*) AS total ${EVALUATION_LIST_JOINS} WHERE ${where}`).get(...params);
    // Facets inspect scalar fields across the tenant, never hundreds of full transcripts.
    const facets = this.database.prepare(`SELECT DISTINCT p.industry, ${EVALUATION_LEVEL} AS level ${EVALUATION_LIST_JOINS} WHERE i.tenant_id = ?`).all(tenantId);
    return { total: Number(count?.total ?? 0), facets: facets.map(row => ({ industry: String(row.industry), level: String(row.level) })) };
  }

  getCommandReceipt<T>(
    tenantId: string,
    interviewId: string,
    commandType: CommandType,
    clientCommandId: string,
  ): StoredCommandReceipt<T> | null {
    const row = this.database
      .prepare(
        `SELECT request_hash, resulting_version, response_json
         FROM command_receipts
         WHERE tenant_id = ? AND interview_id = ?
           AND command_type = ? AND client_command_id = ?`,
      )
      .get(tenantId, interviewId, commandType, clientCommandId);
    if (!row) return null;
    return {
      requestHash: String(row.request_hash),
      resultingVersion: Number(row.resulting_version),
      response: parseStoredResponse<T>(row.response_json),
    };
  }

  getMessageCommandStage(
    tenantId: string,
    interviewId: string,
    clientMessageId: string,
  ): MessageCommandStage | null {
    const row = this.database
      .prepare(
        `SELECT id, tenant_id, interview_id, client_message_id, request_hash,
                expected_version, current_question_code, transcript_segment_id,
                transcript_metadata_json, processing_lease_expires_at,
                status, provider_metadata_json, failure_code, created_at, completed_at
         FROM message_command_stages
         WHERE tenant_id = ? AND interview_id = ? AND client_message_id = ?`,
      )
      .get(tenantId, interviewId, clientMessageId);
    if (!row) return null;
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      interviewId: String(row.interview_id),
      clientMessageId: String(row.client_message_id),
      requestHash: String(row.request_hash),
      expectedVersion: Number(row.expected_version),
      currentQuestionCode:
        row.current_question_code === null ? null : String(row.current_question_code),
      transcriptSegmentId: String(row.transcript_segment_id),
      transcriptMetadata:
        row.transcript_metadata_json === null
          ? null
          : parseStoredResponse<MessageCommandStage["transcriptMetadata"]>(
              row.transcript_metadata_json,
            ),
      processingLeaseExpiresAt:
        row.processing_lease_expires_at === null
          ? null
          : String(row.processing_lease_expires_at),
      status: String(row.status) as MessageCommandStage["status"],
      providerMetadata:
        row.provider_metadata_json === null
          ? null
          : parseStoredResponse<Record<string, unknown>>(row.provider_metadata_json),
      failureCode: row.failure_code === null ? null : String(row.failure_code),
      createdAt: String(row.created_at),
      completedAt: row.completed_at === null ? null : String(row.completed_at),
    };
  }

  claimMessageCommandStage(input: {
    tenantId: string;
    interviewId: string;
    clientMessageId: string;
    leaseToken: string;
    now: string;
    leaseExpiresAt: string;
  }): void {
    const claimed = this.database
      .prepare(
        `UPDATE message_command_stages
         SET processing_lease_token = ?, processing_lease_expires_at = ?
         WHERE tenant_id = ? AND interview_id = ? AND client_message_id = ?
           AND status = 'PENDING'
           AND (
             processing_lease_token IS NULL
             OR processing_lease_expires_at IS NULL
             OR processing_lease_expires_at <= ?
           )
         RETURNING id`,
      )
      .get(
        input.leaseToken,
        input.leaseExpiresAt,
        input.tenantId,
        input.interviewId,
        input.clientMessageId,
        input.now,
      );
    if (!claimed) {
      throw new ApplicationError(
        409,
        "MESSAGE_STAGE_BUSY",
        "This answer is already being processed by Claude.",
      );
    }
  }

  releaseMessageCommandStageClaim(input: {
    tenantId: string;
    interviewId: string;
    clientMessageId: string;
    leaseToken: string;
  }): void {
    const result = this.database
      .prepare(
        `UPDATE message_command_stages
         SET processing_lease_token = NULL, processing_lease_expires_at = NULL
         WHERE tenant_id = ? AND interview_id = ? AND client_message_id = ?
           AND status = 'PENDING' AND processing_lease_token = ?`,
      )
      .run(
        input.tenantId,
        input.interviewId,
        input.clientMessageId,
        input.leaseToken,
      );
    if (Number(result.changes) !== 1) {
      throw new ApplicationError(
        409,
        "MESSAGE_STAGE_CLAIM_LOST",
        "The Claude processing claim is no longer current.",
      );
    }
  }

  getPendingMessageCommandStage(
    tenantId: string,
    interviewId: string,
  ): MessageCommandStage | null {
    const row = this.database
      .prepare(
        `SELECT client_message_id
         FROM message_command_stages
         WHERE tenant_id = ? AND interview_id = ? AND status = 'PENDING'
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
      )
      .get(tenantId, interviewId);
    return row
      ? this.getMessageCommandStage(
          tenantId,
          interviewId,
          String(row.client_message_id),
        )
      : null;
  }

  insertMessageCommandStage(input: {
    id: string;
    tenantId: string;
    interviewId: string;
    clientMessageId: string;
    requestHash: string;
    expectedVersion: number;
    currentQuestionCode: string | null;
    transcriptSegmentId: string;
    transcriptMetadata: MessageCommandStage["transcriptMetadata"];
    now: string;
  }): void {
    try {
      this.database
        .prepare(
          `INSERT INTO message_command_stages(
            id, tenant_id, interview_id, client_message_id, request_hash,
            expected_version, current_question_code, transcript_segment_id,
            transcript_metadata_json, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
        )
        .run(
          input.id,
          input.tenantId,
          input.interviewId,
          input.clientMessageId,
          input.requestHash,
          input.expectedVersion,
          input.currentQuestionCode,
          input.transcriptSegmentId,
          input.transcriptMetadata === null
            ? null
            : JSON.stringify(input.transcriptMetadata),
          input.now,
        );
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code.startsWith("SQLITE_CONSTRAINT")) {
        throw new ApplicationError(
          409,
          "MESSAGE_STAGE_PENDING",
          "An unresolved message is already waiting for Claude processing.",
        );
      }
      throw error;
    }
  }

  failMessageCommandStageIfPending(input: {
    tenantId: string;
    interviewId: string;
    clientMessageId: string;
    failureCode: string;
    now: string;
  }): boolean {
    const result = this.database
      .prepare(
        `UPDATE message_command_stages
         SET status = 'FAILED', failure_code = ?, completed_at = ?,
             processing_lease_token = NULL, processing_lease_expires_at = NULL
         WHERE tenant_id = ? AND interview_id = ? AND client_message_id = ?
           AND status = 'PENDING'`,
      )
      .run(
        input.failureCode,
        input.now,
        input.tenantId,
        input.interviewId,
        input.clientMessageId,
      );
    return Number(result.changes) === 1;
  }

  finishMessageCommandStage(input: {
    tenantId: string;
    interviewId: string;
    clientMessageId: string;
    status: "APPLIED" | "FAILED";
    providerMetadata: Record<string, unknown> | null;
    failureCode: string | null;
    leaseToken: string;
    now: string;
  }): void {
    const result = this.database
      .prepare(
        `UPDATE message_command_stages
         SET status = ?, provider_metadata_json = ?, failure_code = ?, completed_at = ?,
             processing_lease_token = NULL, processing_lease_expires_at = NULL
         WHERE tenant_id = ? AND interview_id = ? AND client_message_id = ?
           AND status = 'PENDING' AND processing_lease_token = ?`,
      )
      .run(
        input.status,
        input.providerMetadata === null ? null : JSON.stringify(input.providerMetadata),
        input.failureCode,
        input.now,
        input.tenantId,
        input.interviewId,
        input.clientMessageId,
        input.leaseToken,
      );
    if (Number(result.changes) !== 1) {
      throw new ApplicationError(
        409,
        "MESSAGE_STAGE_CONFLICT",
        "메시지 처리 단계가 이미 완료되었거나 변경되었습니다.",
      );
    }
  }

  insertCommandReceipt<T>(input: {
    id: string;
    tenantId: string;
    interviewId: string;
    commandType: CommandType;
    clientCommandId: string;
    requestHash: string;
    expectedVersion: number;
    resultingVersion: number;
    response: T;
    now: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO command_receipts(
          id, tenant_id, interview_id, command_type, client_command_id,
          request_hash, expected_version, resulting_version, response_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        input.interviewId,
        input.commandType,
        input.clientCommandId,
        input.requestHash,
        input.expectedVersion,
        input.resultingVersion,
        JSON.stringify(input.response),
        input.now,
      );
  }

  assertReceiptMatches(existingHash: string, requestHash: string): void {
    if (existingHash !== requestHash) {
      throw new ApplicationError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "같은 client command ID가 다른 요청 내용에 재사용되었습니다.",
      );
    }
  }

  advanceMessageVersion(input: {
    tenantId: string;
    interviewId: string;
    expectedVersion: number;
    currentQuestionCode: string | null;
    now: string;
  }): number {
    const result = this.database
      .prepare(
        `UPDATE interviews
         SET version = version + 1, updated_at = ?
         WHERE tenant_id = ? AND id = ?
           AND lifecycle_status = 'ACTIVE'
           AND version = ?
           AND (
             (current_question_code IS NULL AND ? IS NULL)
             OR current_question_code = ?
           )
         RETURNING version`,
      )
      .get(
        input.now,
        input.tenantId,
        input.interviewId,
        input.expectedVersion,
        input.currentQuestionCode,
        input.currentQuestionCode,
      );
    if (result) return Number(result.version);
    this.throwAggregateConflict(input);
  }

  assertMessagePreconditions(input: {
    tenantId: string;
    interviewId: string;
    expectedVersion: number;
    currentQuestionCode: string | null;
  }): InterviewAggregateState {
    const aggregate = this.getInterviewAggregate(input.tenantId, input.interviewId);
    if (
      aggregate.lifecycleStatus !== "ACTIVE" ||
      aggregate.version !== input.expectedVersion ||
      aggregate.currentQuestionCode !== input.currentQuestionCode
    ) {
      this.throwAggregateConflict(input);
    }
    return aggregate;
  }

  advanceCompletionVersion(input: {
    tenantId: string;
    interviewId: string;
    expectedVersion: number;
    now: string;
  }): number {
    const result = this.database
      .prepare(
        `UPDATE interviews
         SET version = version + 1, updated_at = ?
         WHERE tenant_id = ? AND id = ?
           AND lifecycle_status = 'ACTIVE' AND version = ?
         RETURNING version`,
      )
      .get(input.now, input.tenantId, input.interviewId, input.expectedVersion);
    if (result) return Number(result.version);
    this.throwAggregateConflict({ ...input, currentQuestionCode: undefined });
  }

  private throwAggregateConflict(input: {
    tenantId: string;
    interviewId: string;
    expectedVersion: number;
    currentQuestionCode?: string | null;
  }): never {
    const aggregate = this.getInterviewAggregate(input.tenantId, input.interviewId);
    if (aggregate.lifecycleStatus !== "ACTIVE") {
      throw new ApplicationError(409, "INTERVIEW_FINALIZED", "종료된 인터뷰는 변경할 수 없습니다.", {
        lifecycleStatus: aggregate.lifecycleStatus,
        actualVersion: aggregate.version,
      });
    }
    if (aggregate.version !== input.expectedVersion) {
      throw new ApplicationError(409, "VERSION_CONFLICT", "인터뷰가 다른 요청에 의해 변경되었습니다.", {
        expectedVersion: input.expectedVersion,
        actualVersion: aggregate.version,
      });
    }
    throw new ApplicationError(409, "STALE_QUESTION", "현재 질문이 이미 변경되었습니다.", {
      expectedQuestion: input.currentQuestionCode ?? null,
      actualQuestion: aggregate.currentQuestionCode,
      actualVersion: aggregate.version,
    });
  }

  appendOutboxEvents(input: {
    tenantId: string;
    interviewId: string;
    aggregateVersion: number;
    turnId: string;
    now: string;
    eventIdFactory: () => string;
    drafts: RealtimeEventDraft[];
  }): RealtimeEventEnvelope[] {
    if (input.drafts.length === 0) return [];
    const reservation = this.database
      .prepare(
        `UPDATE interviews
         SET event_seq = event_seq + ?
         WHERE tenant_id = ? AND id = ? AND version = ?
         RETURNING event_seq`,
      )
      .get(
        input.drafts.length,
        input.tenantId,
        input.interviewId,
        input.aggregateVersion,
      );
    if (!reservation) {
      const aggregate = this.getInterviewAggregate(input.tenantId, input.interviewId);
      throw new ApplicationError(
        409,
        "OUTBOX_VERSION_CONFLICT",
        "현재 aggregate version과 일치하지 않아 이벤트를 기록할 수 없습니다.",
        { expectedVersion: input.aggregateVersion, actualVersion: aggregate.version },
      );
    }
    const finalSequence = Number(reservation.event_seq);
    const firstSequence = finalSequence - input.drafts.length + 1;
    const expiresAt = new Date(new Date(input.now).getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    const insert = this.database.prepare(
      `INSERT INTO outbox_events(
        event_id, tenant_id, interview_id, sequence, aggregate_version,
        event_type, turn_id, batch_index, batch_size, event_json,
        created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const batchSize = input.drafts.length;
    const envelopes = input.drafts.map((draft, batchIndex) => {
      const envelope: RealtimeEventEnvelope = {
        schemaVersion: 1,
        eventId: input.eventIdFactory(),
        seq: firstSequence + batchIndex,
        type: draft.type,
        interviewId: input.interviewId,
        aggregateVersion: input.aggregateVersion,
        snapshotType: draft.snapshotType,
        occurredAt: input.now,
        turnId: input.turnId,
        batchIndex,
        batchSize,
        isBatchFinal: batchIndex === batchSize - 1,
        snapshotUrl: `/api/interviews/${encodeURIComponent(input.interviewId)}`,
        data: draft.data,
      };
      insert.run(
        envelope.eventId,
        input.tenantId,
        input.interviewId,
        envelope.seq,
        envelope.aggregateVersion,
        envelope.type,
        envelope.turnId,
        envelope.batchIndex,
        envelope.batchSize,
        JSON.stringify(envelope),
        input.now,
        expiresAt,
      );
      return envelope;
    });
    outboxEventBroker.notify(input.interviewId);
    return envelopes;
  }

  listOutboxEventsAfter(
    tenantId: string,
    interviewId: string,
    after: number,
    limit = 500,
  ): RealtimeEventEnvelope[] {
    this.getInterviewAggregate(tenantId, interviewId);
    return this.database
      .prepare(
        `SELECT event_json FROM outbox_events
         WHERE tenant_id = ? AND interview_id = ? AND sequence > ?
         ORDER BY sequence ASC LIMIT ?`,
      )
      .all(tenantId, interviewId, after, limit)
      .map((row) => parseStoredResponse<RealtimeEventEnvelope>(row.event_json));
  }

  getReplayBounds(tenantId: string, interviewId: string): {
    minimumAvailable: number | null;
    lastEventSeq: number;
  } {
    const aggregate = this.getInterviewAggregate(tenantId, interviewId);
    const row = this.database
      .prepare(
        `SELECT MIN(sequence) AS minimum_available
         FROM outbox_events WHERE tenant_id = ? AND interview_id = ?`,
      )
      .get(tenantId, interviewId);
    return {
      minimumAvailable:
        row?.minimum_available === null || row?.minimum_available === undefined
          ? aggregate.lastEventSeq > 0
            ? aggregate.lastEventSeq + 1
            : null
          : Number(row.minimum_available),
      lastEventSeq: aggregate.lastEventSeq,
    };
  }
}
