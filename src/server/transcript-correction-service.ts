import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { Principal } from "./auth";
import { ApplicationError, InterviewNotFoundError } from "./errors";

export interface TranscriptCorrectionCommand {
  clientCorrectionId: string;
  expectedVersion: number;
  correctedText: string;
  reason: string;
}

export type TranscriptCorrectionReprocessingEventType =
  | "info.status_changed"
  | "info.value_changed"
  | "coverage.changed"
  | "feature.preview_updated"
  | "summary.preview_updated"
  | "question.generated"
  | "conflict.detected"
  | "ready_to_complete";

export interface TranscriptCorrectionReprocessingEventDraft {
  type: TranscriptCorrectionReprocessingEventType;
  data: Record<string, unknown>;
}

export interface TranscriptCorrectionReprocessingContext {
  database: DatabaseSync;
  tenantId: string;
  interviewId: string;
  segmentId: string;
  correctionId: string;
  clientCorrectionId: string;
  aggregateVersion: number;
  revision: number;
  rawText: string;
  previousEffectiveText: string;
  correctedText: string;
  reason: string;
  actor: Principal;
  occurredAt: string;
}

export interface TranscriptCorrectionReprocessingResult {
  outboxEvents?: readonly TranscriptCorrectionReprocessingEventDraft[];
}

export type TranscriptCorrectionReprocessingHook = (
  context: TranscriptCorrectionReprocessingContext,
) => TranscriptCorrectionReprocessingResult | void;

export interface TranscriptCorrectionServiceOptions {
  now?: () => Date;
  idFactory?: () => string;
  reprocessingHook?: TranscriptCorrectionReprocessingHook;
  /** Alias retained for lightweight composition in tests and adapters. */
  reprocess?: TranscriptCorrectionReprocessingHook;
}

export type TranscriptCorrectionOutboxEventType =
  | "transcript.corrected"
  | TranscriptCorrectionReprocessingEventType;

export interface TranscriptCorrectionOutboxEvent {
  schemaVersion: 1;
  eventId: string;
  seq: number;
  type: TranscriptCorrectionOutboxEventType;
  interviewId: string;
  aggregateVersion: number;
  snapshotType: "PREVIEW";
  occurredAt: string;
  turnId: string;
  batchIndex: number;
  batchSize: number;
  isBatchFinal: boolean;
  snapshotUrl: string;
  data: Record<string, unknown>;
}

export interface CorrectedTranscriptSegmentView {
  id: string;
  interviewId: string;
  sequence: number;
  speaker: "ASSISTANT" | "BORROWER";
  confirmation: "FINAL";
  startMs: number | null;
  endMs: number | null;
  sttConfidence: number | null;
  sttProvider: string | null;
  rawText: string;
  correctedText: string;
  text: string;
  revision: number;
  createdAt: string;
}

export interface TranscriptCorrectionView {
  id: string;
  interviewId: string;
  segmentId: string;
  clientCorrectionId: string;
  actorUserId: string;
  expectedVersion: number;
  resultingVersion: number;
  revision: number;
  rawText: string;
  previousEffectiveText: string;
  correctedText: string;
  reason: string;
  createdAt: string;
}

export interface TranscriptCorrectionResult {
  correction: TranscriptCorrectionView;
  segment: CorrectedTranscriptSegmentView;
  interview: {
    id: string;
    lifecycleStatus: "ACTIVE";
    version: number;
    lastEventSeq: number;
  };
  events: TranscriptCorrectionOutboxEvent[];
}

interface AggregateRow {
  id: unknown;
  lifecycle_status: unknown;
  version: unknown;
  event_seq: unknown;
}

interface SegmentRow {
  id: unknown;
  interview_id: unknown;
  sequence: unknown;
  speaker: unknown;
  confirmation: unknown;
  start_ms: unknown;
  end_ms: unknown;
  stt_confidence: unknown;
  stt_provider: unknown;
  raw_text: unknown;
  corrected_text: unknown;
  text: unknown;
  revision: unknown;
  created_at: unknown;
}

const REPROCESSING_EVENT_TYPES = new Set<TranscriptCorrectionReprocessingEventType>([
  "info.status_changed",
  "info.value_changed",
  "coverage.changed",
  "feature.preview_updated",
  "summary.preview_updated",
  "question.generated",
  "conflict.detected",
  "ready_to_complete",
]);

function requiredTrimmedString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new ApplicationError(400, "INVALID_CORRECTION_COMMAND", `${field} 값이 올바르지 않습니다.`, {
      field,
    });
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new ApplicationError(400, "INVALID_CORRECTION_COMMAND", `${field} 값이 올바르지 않습니다.`, {
      field,
    });
  }
  return trimmed;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapSegment(row: SegmentRow): CorrectedTranscriptSegmentView {
  if (row.raw_text === null || row.raw_text === undefined) {
    throw new ApplicationError(
      500,
      "TRANSCRIPT_RAW_TEXT_MISSING",
      "원본 transcript가 손상되어 correction을 완료할 수 없습니다.",
    );
  }
  return {
    id: String(row.id),
    interviewId: String(row.interview_id),
    sequence: Number(row.sequence),
    speaker: String(row.speaker) as CorrectedTranscriptSegmentView["speaker"],
    confirmation: String(row.confirmation) as "FINAL",
    startMs: nullableNumber(row.start_ms),
    endMs: nullableNumber(row.end_ms),
    sttConfidence: nullableNumber(row.stt_confidence),
    sttProvider:
      row.stt_provider === null || row.stt_provider === undefined
        ? null
        : String(row.stt_provider),
    rawText: String(row.raw_text),
    correctedText:
      row.corrected_text === null || row.corrected_text === undefined
        ? String(row.text)
        : String(row.corrected_text),
    text: String(row.text),
    revision: Number(row.revision),
    createdAt: String(row.created_at),
  };
}

function parseStoredResult(value: unknown): TranscriptCorrectionResult {
  if (typeof value !== "string") {
    throw new ApplicationError(
      500,
      "CORRECTION_RECEIPT_CORRUPT",
      "저장된 transcript correction 결과가 손상되었습니다.",
    );
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    return parsed as TranscriptCorrectionResult;
  } catch {
    throw new ApplicationError(
      500,
      "CORRECTION_RECEIPT_CORRUPT",
      "저장된 transcript correction 결과가 손상되었습니다.",
    );
  }
}

export class TranscriptCorrectionService {
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly reprocessingHook: TranscriptCorrectionReprocessingHook;
  private savepointSequence = 0;

  constructor(
    readonly database: DatabaseSync,
    options: TranscriptCorrectionServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.reprocessingHook = options.reprocessingHook ?? options.reprocess ?? (() => undefined);
  }

  correctTranscriptSegment(
    interviewIdInput: string,
    segmentIdInput: string,
    commandInput: TranscriptCorrectionCommand,
    principal: Principal,
  ): TranscriptCorrectionResult {
    const interviewId = requiredTrimmedString(interviewIdInput, "interviewId", 256);
    const segmentId = requiredTrimmedString(segmentIdInput, "segmentId", 256);
    const command = this.normalizeCommand(commandInput);
    const requestHash = this.requestHash(interviewId, segmentId, command);

    return this.transaction(() => {
      const aggregate = this.getAggregate(principal.tenantId, interviewId);
      const receipt = this.database
        .prepare(
          `SELECT request_hash, response_json
           FROM transcript_corrections
           WHERE tenant_id = ? AND interview_id = ? AND client_correction_id = ?`,
        )
        .get(principal.tenantId, interviewId, command.clientCorrectionId);
      if (receipt) {
        if (String(receipt.request_hash) !== requestHash) {
          throw new ApplicationError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "같은 clientCorrectionId가 다른 correction 요청에 재사용되었습니다.",
          );
        }
        return parseStoredResult(receipt.response_json);
      }

      this.assertActiveVersion(aggregate, command.expectedVersion);
      const previousSegment = this.getSegment(principal.tenantId, interviewId, segmentId);
      const pendingMessage = this.database
        .prepare(
          `SELECT client_message_id
           FROM message_command_stages
           WHERE tenant_id = ? AND interview_id = ? AND transcript_segment_id = ?
             AND status = 'PENDING'
           LIMIT 1`,
        )
        .get(principal.tenantId, interviewId, segmentId);
      if (pendingMessage) {
        throw new ApplicationError(
          409,
          "TRANSCRIPT_PROCESSING_PENDING",
          "A transcript cannot be corrected while its Claude processing is pending.",
          { clientMessageId: String(pendingMessage.client_message_id) },
        );
      }
      if (previousSegment.confirmation !== "FINAL") {
        throw new ApplicationError(
          409,
          "TRANSCRIPT_NOT_FINAL",
          "FINAL transcript segment만 correction할 수 있습니다.",
          { segmentId },
        );
      }
      if (previousSegment.text === command.correctedText) {
        throw new ApplicationError(
          422,
          "CORRECTION_HAS_NO_CHANGE",
          "correctedText는 현재 transcript와 달라야 합니다.",
          { segmentId, revision: previousSegment.revision },
        );
      }

      const occurredAt = this.now().toISOString();
      const correctionId = this.idFactory();
      const resultingVersion = this.advanceVersion(
        principal.tenantId,
        interviewId,
        command.expectedVersion,
        occurredAt,
      );
      const row = this.database
        .prepare(
          `UPDATE transcript_segments
           SET text = ?, corrected_text = ?, revision = revision + 1
           WHERE interview_id = ? AND id = ?
             AND confirmation = 'FINAL' AND revision = ?
           RETURNING id, interview_id, sequence, speaker, confirmation,
                     start_ms, end_ms, stt_confidence, stt_provider, raw_text,
                     corrected_text, text, revision, created_at`,
        )
        .get(
          command.correctedText,
          command.correctedText,
          interviewId,
          segmentId,
          previousSegment.revision,
        ) as SegmentRow | undefined;
      if (!row) {
        throw new ApplicationError(
          409,
          "TRANSCRIPT_REVISION_CONFLICT",
          "transcript segment가 다른 요청에 의해 변경되었습니다.",
          { segmentId, expectedRevision: previousSegment.revision },
        );
      }
      const segment = mapSegment(row);

      const hookResult = this.reprocessingHook({
        database: this.database,
        tenantId: principal.tenantId,
        interviewId,
        segmentId,
        correctionId,
        clientCorrectionId: command.clientCorrectionId,
        aggregateVersion: resultingVersion,
        revision: segment.revision,
        rawText: segment.rawText,
        previousEffectiveText: previousSegment.text,
        correctedText: command.correctedText,
        reason: command.reason,
        actor: principal,
        occurredAt,
      });
      if (hookResult && typeof (hookResult as { then?: unknown }).then === "function") {
        throw new ApplicationError(
          500,
          "ASYNC_REPROCESSING_HOOK_UNSUPPORTED",
          "Transcript reprocessing hook은 동일 transaction 안에서 동기적으로 완료되어야 합니다.",
        );
      }
      const reprocessingDrafts = this.validateReprocessingDrafts(hookResult?.outboxEvents);
      this.assertReprocessingInvariant(
        principal.tenantId,
        interviewId,
        resultingVersion,
      );

      const events = this.appendOutboxEvents({
        tenantId: principal.tenantId,
        interviewId,
        aggregateVersion: resultingVersion,
        turnId: command.clientCorrectionId,
        occurredAt,
        drafts: [
          {
            type: "transcript.corrected",
            data: {
              correctionId,
              segmentId,
              revision: segment.revision,
              rawText: segment.rawText,
              previousEffectiveText: previousSegment.text,
              correctedText: command.correctedText,
              reason: command.reason,
            },
          },
          ...reprocessingDrafts,
        ],
      });
      const lastEventSeq = events.at(-1)?.seq ?? aggregate.eventSeq;
      const correction: TranscriptCorrectionView = {
        id: correctionId,
        interviewId,
        segmentId,
        clientCorrectionId: command.clientCorrectionId,
        actorUserId: principal.userId,
        expectedVersion: command.expectedVersion,
        resultingVersion,
        revision: segment.revision,
        rawText: segment.rawText,
        previousEffectiveText: previousSegment.text,
        correctedText: command.correctedText,
        reason: command.reason,
        createdAt: occurredAt,
      };
      const response: TranscriptCorrectionResult = {
        correction,
        segment,
        interview: {
          id: interviewId,
          lifecycleStatus: "ACTIVE",
          version: resultingVersion,
          lastEventSeq,
        },
        events,
      };
      this.database
        .prepare(
          `INSERT INTO transcript_corrections(
            id, tenant_id, interview_id, segment_id, client_correction_id,
            actor_user_id, expected_version, resulting_version, revision,
            request_hash, raw_text, previous_effective_text, corrected_text,
            reason, response_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          correctionId,
          principal.tenantId,
          interviewId,
          segmentId,
          command.clientCorrectionId,
          principal.userId,
          command.expectedVersion,
          resultingVersion,
          segment.revision,
          requestHash,
          segment.rawText,
          previousSegment.text,
          command.correctedText,
          command.reason,
          JSON.stringify(response),
          occurredAt,
        );
      return response;
    });
  }

  /** Alias for callers that model corrections as commands. */
  correctSegment(
    interviewId: string,
    segmentId: string,
    command: TranscriptCorrectionCommand,
    principal: Principal,
  ): TranscriptCorrectionResult {
    return this.correctTranscriptSegment(interviewId, segmentId, command, principal);
  }

  private normalizeCommand(command: TranscriptCorrectionCommand): TranscriptCorrectionCommand {
    if (!command || typeof command !== "object") {
      throw new ApplicationError(400, "INVALID_CORRECTION_COMMAND", "Correction 명령이 필요합니다.");
    }
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw new ApplicationError(
        400,
        "INVALID_EXPECTED_VERSION",
        "expectedVersion은 1 이상의 정수여야 합니다.",
        { field: "expectedVersion" },
      );
    }
    return {
      clientCorrectionId: requiredTrimmedString(
        command.clientCorrectionId,
        "clientCorrectionId",
        128,
      ),
      expectedVersion: command.expectedVersion,
      correctedText: requiredTrimmedString(command.correctedText, "correctedText", 5_000),
      reason: requiredTrimmedString(command.reason, "reason", 1_000),
    };
  }

  private getAggregate(tenantId: string, interviewId: string): {
    id: string;
    lifecycleStatus: "ACTIVE" | "COMPLETE" | "INCOMPLETE";
    version: number;
    eventSeq: number;
  } {
    const row = this.database
      .prepare(
        `SELECT id, lifecycle_status, version, event_seq
         FROM interviews WHERE tenant_id = ? AND id = ?`,
      )
      .get(tenantId, interviewId) as AggregateRow | undefined;
    if (!row) throw new InterviewNotFoundError(interviewId);
    return {
      id: String(row.id),
      lifecycleStatus: String(row.lifecycle_status) as
        | "ACTIVE"
        | "COMPLETE"
        | "INCOMPLETE",
      version: Number(row.version),
      eventSeq: Number(row.event_seq),
    };
  }

  private getSegment(
    tenantId: string,
    interviewId: string,
    segmentId: string,
  ): CorrectedTranscriptSegmentView {
    const row = this.database
      .prepare(
        `SELECT s.id, s.interview_id, s.sequence, s.speaker, s.confirmation,
                s.start_ms, s.end_ms, s.stt_confidence, s.stt_provider, s.raw_text,
                s.corrected_text, s.text, s.revision, s.created_at
         FROM transcript_segments s
         JOIN interviews i ON i.id = s.interview_id
         WHERE i.tenant_id = ? AND i.id = ? AND s.id = ?`,
      )
      .get(tenantId, interviewId, segmentId) as SegmentRow | undefined;
    if (!row) {
      throw new ApplicationError(
        404,
        "TRANSCRIPT_SEGMENT_NOT_FOUND",
        "Transcript segment를 찾을 수 없습니다.",
        { segmentId },
      );
    }
    return mapSegment(row);
  }

  private assertActiveVersion(
    aggregate: ReturnType<TranscriptCorrectionService["getAggregate"]>,
    expectedVersion: number,
  ): void {
    if (aggregate.lifecycleStatus !== "ACTIVE") {
      throw new ApplicationError(
        409,
        "INTERVIEW_FINALIZED",
        "종료된 인터뷰의 transcript는 변경할 수 없습니다.",
        { lifecycleStatus: aggregate.lifecycleStatus, actualVersion: aggregate.version },
      );
    }
    if (aggregate.version !== expectedVersion) {
      throw new ApplicationError(
        409,
        "VERSION_CONFLICT",
        "인터뷰가 다른 요청에 의해 변경되었습니다.",
        { expectedVersion, actualVersion: aggregate.version },
      );
    }
  }

  private advanceVersion(
    tenantId: string,
    interviewId: string,
    expectedVersion: number,
    occurredAt: string,
  ): number {
    const row = this.database
      .prepare(
        `UPDATE interviews
         SET version = version + 1, updated_at = ?
         WHERE tenant_id = ? AND id = ?
           AND lifecycle_status = 'ACTIVE' AND version = ?
         RETURNING version`,
      )
      .get(occurredAt, tenantId, interviewId, expectedVersion);
    if (row) return Number(row.version);
    const aggregate = this.getAggregate(tenantId, interviewId);
    this.assertActiveVersion(aggregate, expectedVersion);
    throw new ApplicationError(409, "VERSION_CONFLICT", "인터뷰 version 갱신에 실패했습니다.");
  }

  private assertReprocessingInvariant(
    tenantId: string,
    interviewId: string,
    aggregateVersion: number,
  ): void {
    const aggregate = this.getAggregate(tenantId, interviewId);
    if (aggregate.lifecycleStatus !== "ACTIVE" || aggregate.version !== aggregateVersion) {
      throw new ApplicationError(
        500,
        "REPROCESSING_INVARIANT_VIOLATION",
        "Transcript reprocessing이 인터뷰 aggregate version 또는 상태를 변경했습니다.",
      );
    }
  }

  private validateReprocessingDrafts(
    drafts: readonly TranscriptCorrectionReprocessingEventDraft[] | undefined,
  ): TranscriptCorrectionReprocessingEventDraft[] {
    if (!drafts) return [];
    if (!Array.isArray(drafts) || drafts.length > 50) {
      throw new ApplicationError(
        500,
        "INVALID_REPROCESSING_EVENTS",
        "Transcript reprocessing event 결과가 올바르지 않습니다.",
      );
    }
    return drafts.map((draft) => {
      if (
        !draft ||
        typeof draft !== "object" ||
        !REPROCESSING_EVENT_TYPES.has(draft.type) ||
        !draft.data ||
        typeof draft.data !== "object" ||
        Array.isArray(draft.data)
      ) {
        throw new ApplicationError(
          500,
          "INVALID_REPROCESSING_EVENTS",
          "Transcript reprocessing event 결과가 올바르지 않습니다.",
        );
      }
      return { type: draft.type, data: draft.data };
    });
  }

  private appendOutboxEvents(input: {
    tenantId: string;
    interviewId: string;
    aggregateVersion: number;
    turnId: string;
    occurredAt: string;
    drafts: readonly {
      type: TranscriptCorrectionOutboxEventType;
      data: Record<string, unknown>;
    }[];
  }): TranscriptCorrectionOutboxEvent[] {
    const reservation = this.database
      .prepare(
        `UPDATE interviews
         SET event_seq = event_seq + ?
         WHERE tenant_id = ? AND id = ?
           AND lifecycle_status = 'ACTIVE' AND version = ?
         RETURNING event_seq`,
      )
      .get(
        input.drafts.length,
        input.tenantId,
        input.interviewId,
        input.aggregateVersion,
      );
    if (!reservation) {
      throw new ApplicationError(
        500,
        "CORRECTION_OUTBOX_RESERVATION_FAILED",
        "Transcript correction event sequence를 예약하지 못했습니다.",
      );
    }
    const finalSequence = Number(reservation.event_seq);
    const firstSequence = finalSequence - input.drafts.length + 1;
    const batchSize = input.drafts.length;
    const expiresAt = new Date(
      new Date(input.occurredAt).getTime() + 7 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const insert = this.database.prepare(
      `INSERT INTO outbox_events(
        event_id, tenant_id, interview_id, sequence, aggregate_version,
        event_type, turn_id, batch_index, batch_size, event_json,
        created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    return input.drafts.map((draft, batchIndex) => {
      const event: TranscriptCorrectionOutboxEvent = {
        schemaVersion: 1,
        eventId: this.idFactory(),
        seq: firstSequence + batchIndex,
        type: draft.type,
        interviewId: input.interviewId,
        aggregateVersion: input.aggregateVersion,
        snapshotType: "PREVIEW",
        occurredAt: input.occurredAt,
        turnId: input.turnId,
        batchIndex,
        batchSize,
        isBatchFinal: batchIndex === batchSize - 1,
        snapshotUrl: `/api/interviews/${encodeURIComponent(input.interviewId)}`,
        data: draft.data,
      };
      insert.run(
        event.eventId,
        input.tenantId,
        input.interviewId,
        event.seq,
        event.aggregateVersion,
        event.type,
        event.turnId,
        event.batchIndex,
        event.batchSize,
        JSON.stringify(event),
        input.occurredAt,
        expiresAt,
      );
      return event;
    });
  }

  private requestHash(
    interviewId: string,
    segmentId: string,
    command: TranscriptCorrectionCommand,
  ): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          clientCorrectionId: command.clientCorrectionId,
          correctedText: command.correctedText,
          expectedVersion: command.expectedVersion,
          interviewId,
          reason: command.reason,
          segmentId,
        }),
        "utf8",
      )
      .digest("hex");
  }

  private transaction<T>(operation: () => T): T {
    if (this.database.isTransaction) {
      const savepoint = `transcript_correction_${++this.savepointSequence}`;
      this.database.exec(`SAVEPOINT ${savepoint};`);
      try {
        const result = operation();
        this.database.exec(`RELEASE SAVEPOINT ${savepoint};`);
        return result;
      } catch (error) {
        this.database.exec(`ROLLBACK TO SAVEPOINT ${savepoint};`);
        this.database.exec(`RELEASE SAVEPOINT ${savepoint};`);
        throw error;
      }
    }
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }
}
