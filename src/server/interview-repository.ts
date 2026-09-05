import { createHash } from "node:crypto";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { InterviewOperationsQuery, InterviewOperationsResult, InterviewLifecycle } from "@/domain/interview-operations";

import {
  assertInformationTransition,
  BORROWER_SELECTED_IMPROVEMENT_CANDIDATE,
  InvalidInformationTransitionError,
  type BorrowerImprovementChoice,
  type BorrowerImprovementSelection,
  type Borrower,
  type BusinessProfile,
  type CanonicalInformationRecord,
  type CanonicalConflict,
  type CanonicalValueRevision,
  type EvidenceKind,
  type EvidenceRef,
  type FinalInterviewSnapshot,
  type InformationItem,
  type InformationQuality,
  type InformationStatus,
  type InformationStatusEvent,
  type InformationValueData,
  type InterviewEvaluation,
  type InterviewSessionSummary,
  type LiveFeatureSet,
  type TranscriptSegment,
  type TransitionContext,
  type ValueState,
} from "@/domain";

import {
  ApplicationError,
  EvaluationNotFoundError,
  InterviewNotFoundError,
} from "./errors";

type SqlRow = Record<string, SQLOutputValue>;

export interface StoredInterview {
  session: InterviewSessionSummary;
  borrower: Borrower;
  business: BusinessProfile;
  currentQuestionCode: string | null;
}

export interface CreateInterviewInput {
  session: InterviewSessionSummary;
  borrower: Borrower;
  business: BusinessProfile;
  informationItems: InformationItem[];
  transcript: TranscriptSegment;
  prefillEvidence?: EvidenceRef | null;
  currentQuestionCode: string;
  tenantId?: string;
  ownerUserId?: string;
}

export interface ValueUpdate {
  valueState: ValueState;
  value: InformationValueData | null;
  quality: InformationQuality | null;
  extractionConfidence: number | null;
  verification: EvidenceKind | null;
  evidenceIds: string[];
}

export interface TranscriptCaptureMetadata {
  startMs?: number | null;
  endMs?: number | null;
  sttConfidence?: number | null;
  sttProvider?: string | null;
  rawText?: string;
}

export interface PersistedTranscriptSegment extends TranscriptSegment {
  startMs: number | null;
  endMs: number | null;
  sttConfidence: number | null;
  sttProvider: string | null;
  rawText: string;
  correctedText: string | null;
  revision: number;
}

export interface EvaluationArtifactInput {
  id: string;
  code: string;
  ordinal: number;
  result: Record<string, unknown>;
  evidenceIds?: string[];
  pillarId?: string | null;
  status?: "UNRESOLVED" | "SUGGESTED" | "BORROWER_STATED" | "BORROWER_CONFIRMED";
}

export interface BorrowerImprovementSelectionInsert {
  id: string;
  tenantId: string;
  interviewId: string;
  finalSnapshotId: string;
  choice: BorrowerImprovementChoice;
  liveVersion: number;
  clientCommandId: string;
  createdAt: string;
}

interface PersistableFinalSnapshot {
  id: string;
  interviewId: string;
  snapshotType: "FINAL";
  finalizedAt: string;
  completionStatus: "COMPLETE" | "INCOMPLETE";
  version?: number;
  stateVersion?: number;
}

function parseJson<T>(value: SQLOutputValue | undefined, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function textValue(value: SQLOutputValue | undefined): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(value: SQLOutputValue | undefined): string | null {
  return value === null || value === undefined ? null : textValue(value);
}

function numberValue(value: SQLOutputValue | undefined): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function nullableNumber(value: SQLOutputValue | undefined): number | null {
  return value === null || value === undefined ? null : numberValue(value);
}

export class InterviewRepository {
  constructor(readonly database: DatabaseSync) {}

  transaction<T>(operation: () => T): T {
    if (this.database.isTransaction) return operation();
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

  createInterview(input: CreateInterviewInput): void {
    this.transaction(() => {
      const tenantId = input.tenantId ?? "local-workspace-tenant";
      const ownerUserId = input.ownerUserId ?? "local-workspace-user";
      this.database
        .prepare("INSERT INTO borrowers(id, name, created_at, tenant_id) VALUES (?, ?, ?, ?)")
        .run(input.borrower.id, input.borrower.name, input.session.createdAt, tenantId);

      this.database
        .prepare(
          "INSERT INTO business_profiles(id, borrower_id, business_name, industry, created_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.business.id,
          input.business.borrowerId,
          input.business.businessName,
          input.business.industry,
          input.session.createdAt,
          tenantId,
        );

      this.database
        .prepare(
          `INSERT INTO interviews(
            id, borrower_id, business_profile_id, lifecycle_status, version,
            current_question_code, created_at, updated_at, completed_at,
            tenant_id, owner_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.session.id,
          input.borrower.id,
          input.business.id,
          input.session.lifecycleStatus,
          input.session.version,
          input.currentQuestionCode,
          input.session.createdAt,
          input.session.updatedAt,
          input.session.completedAt,
          tenantId,
          ownerUserId,
        );

      const requiredStatement = this.database.prepare(
        `INSERT INTO required_items(
          interview_id, info_code, ordinal, label, category, priority, expected_type,
          required, min_quality, evidence_preference_json, dependencies_json,
          question, followup_question
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const informationStatement = this.database.prepare(
        `INSERT INTO information_items(
          interview_id, info_code, status, value_state, value_json, quality,
          extraction_confidence, verification, evidence_ids_json, prefill_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const canonicalRecordStatement = this.database.prepare(
        `INSERT INTO canonical_information_records(
          tenant_id, interview_id, info_code, aggregate_version, record_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );

      input.informationItems.forEach((item, index) => {
        requiredStatement.run(
          input.session.id,
          item.infoCode,
          index,
          item.label,
          item.category,
          item.priority,
          item.expectedType,
          item.required ? 1 : 0,
          item.minQuality,
          JSON.stringify(item.evidencePreference),
          JSON.stringify(item.dependencies),
          item.question,
          item.followupQuestion ?? null,
        );
        informationStatement.run(
          input.session.id,
          item.infoCode,
          item.status,
          item.valueState,
          item.value === null ? null : JSON.stringify(item.value),
          item.quality,
          item.extractionConfidence,
          item.verification,
          JSON.stringify(item.evidenceIds),
          item.prefill === null ? null : JSON.stringify(item.prefill),
          item.updatedAt,
        );
        const canonicalRecord: CanonicalInformationRecord = {
          infoCode: item.infoCode,
          category: item.category,
          required: item.required,
          priority: item.priority,
          minQuality: item.minQuality,
          status: item.status,
          valueState: item.valueState,
          selectedRevisionId: null,
          revisions: [],
          updatedAt: item.updatedAt,
        };
        canonicalRecordStatement.run(
          tenantId,
          input.session.id,
          item.infoCode,
          input.session.version,
          JSON.stringify(canonicalRecord),
          item.updatedAt,
        );
      });

      this.insertTranscript(input.transcript);
      if (input.prefillEvidence) this.insertEvidence(input.prefillEvidence);
      this.insertAuditEvent(
        `${input.session.id}:created`,
        input.session.id,
        "INTERVIEW_CREATED",
        { template: "DEFAULT_INTERVIEW_V1" },
        input.session.createdAt,
      );
    });
  }

  listInterviewOperations(tenantId: string, query: InterviewOperationsQuery = {}): InterviewOperationsResult {
    const limit = Math.max(1, Math.min(100, Math.floor(query.limit ?? 24)));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const status = query.status ?? "ALL";
    const search = (query.q ?? "").trim();
    const cases = `WITH cases AS (
      SELECT i.id, i.lifecycle_status, i.current_question_code, i.updated_at,
        b.name AS borrower_name, p.business_name, p.industry,
        (SELECT label FROM required_items r WHERE r.interview_id = i.id AND r.info_code = i.current_question_code) AS current_question_label,
        (SELECT COUNT(*) FROM information_items n JOIN required_items r
          ON r.interview_id = n.interview_id AND r.info_code = n.info_code
          WHERE n.interview_id = i.id AND r.required = 1
          AND n.status NOT IN ('CONFIRMED', 'UNAVAILABLE', 'REFUSED', 'NOT_APPLICABLE')) AS unresolved_count,
        (SELECT COUNT(*) FROM information_items n WHERE n.interview_id = i.id AND n.status = 'CONFLICT') AS conflict_count,
        (SELECT COUNT(*) FROM transcript_segments t WHERE t.interview_id = i.id AND t.speaker = 'BORROWER') AS answer_count,
        COALESCE((SELECT s.status = 'FAILED' FROM message_command_stages s WHERE s.interview_id = i.id AND s.tenant_id = i.tenant_id ORDER BY s.created_at DESC, s.rowid DESC LIMIT 1), 0) AS processing_failed,
        (SELECT e.id FROM evaluations e WHERE e.interview_id = i.id LIMIT 1) AS evaluation_id
      FROM interviews i
      JOIN borrowers b ON b.id = i.borrower_id AND b.tenant_id = i.tenant_id
      JOIN business_profiles p ON p.id = i.business_profile_id AND p.tenant_id = i.tenant_id
      WHERE i.tenant_id = ?
    )`;
    const attention = "(lifecycle_status = 'ACTIVE' AND (conflict_count > 0 OR processing_failed = 1))";
    const where = `WHERE (? = 'ALL' OR lifecycle_status = ? OR (? = 'ATTENTION' AND ${attention}))
      AND (? = '' OR instr(lower(business_name || ' ' || borrower_name || ' ' || industry || ' ' || id), lower(?)) > 0)`;
    const bindings = [tenantId, status, status, status, search, search];
    const total = numberValue(this.database.prepare(`${cases} SELECT COUNT(*) AS count FROM cases ${where}`).get(...bindings)?.count);
    const summary = this.database.prepare(`${cases} SELECT COUNT(*) AS total,
      SUM(lifecycle_status = 'ACTIVE') AS active, SUM(${attention}) AS attention,
      SUM(lifecycle_status = 'COMPLETE') AS complete, SUM(lifecycle_status = 'INCOMPLETE') AS incomplete FROM cases`).get(tenantId);
    const rows = this.database.prepare(`${cases} SELECT * FROM cases ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(...bindings, limit, offset);
    return {
      items: rows.map((row) => ({
        id: textValue(row.id), borrowerName: textValue(row.borrower_name), businessName: textValue(row.business_name),
        industry: textValue(row.industry), lifecycleStatus: textValue(row.lifecycle_status) as InterviewLifecycle,
        currentQuestionCode: nullableText(row.current_question_code), currentQuestionLabel: nullableText(row.current_question_label),
        updatedAt: textValue(row.updated_at), unresolvedRequiredCount: numberValue(row.unresolved_count),
        conflictCount: numberValue(row.conflict_count), borrowerAnswerCount: numberValue(row.answer_count),
        processingFailed: numberValue(row.processing_failed) === 1, evaluationId: nullableText(row.evaluation_id),
      })),
      total, limit, offset, hasMore: offset + rows.length < total,
      summary: {
        total: numberValue(summary?.total), active: numberValue(summary?.active), attention: numberValue(summary?.attention),
        complete: numberValue(summary?.complete), incomplete: numberValue(summary?.incomplete),
      },
    };
  }

  getInterview(interviewId: string): StoredInterview {
    const row = this.database
      .prepare(
        `SELECT
          i.id, i.lifecycle_status, i.version, i.current_question_code,
          i.created_at, i.updated_at, i.completed_at,
          b.id AS borrower_id, b.name AS borrower_name,
          p.id AS business_id, p.business_name, p.industry
        FROM interviews i
        JOIN borrowers b ON b.id = i.borrower_id
        JOIN business_profiles p ON p.id = i.business_profile_id
        WHERE i.id = ?`,
      )
      .get(interviewId);

    if (!row) throw new InterviewNotFoundError(interviewId);
    return this.mapInterview(row);
  }

  private mapInterview(row: SqlRow): StoredInterview {
    const interviewId = textValue(row.id);
    const borrowerId = textValue(row.borrower_id);
    return {
      session: {
        id: interviewId,
        lifecycleStatus: textValue(row.lifecycle_status) as InterviewSessionSummary["lifecycleStatus"],
        snapshotType: "PREVIEW",
        version: numberValue(row.version),
        createdAt: textValue(row.created_at),
        updatedAt: textValue(row.updated_at),
        completedAt: nullableText(row.completed_at),
      },
      borrower: { id: borrowerId, name: textValue(row.borrower_name) },
      business: {
        id: textValue(row.business_id),
        borrowerId,
        businessName: textValue(row.business_name),
        industry: textValue(row.industry),
      },
      currentQuestionCode: nullableText(row.current_question_code),
    };
  }

  listInformationItems(interviewId: string): InformationItem[] {
    const rows = this.database
      .prepare(
        `SELECT
          r.info_code, r.label, r.category, r.priority, r.expected_type, r.required,
          r.min_quality, r.evidence_preference_json, r.dependencies_json,
          r.question, r.followup_question,
          i.status, i.value_state, i.value_json, i.quality, i.extraction_confidence,
          i.verification, i.evidence_ids_json, i.prefill_json, i.updated_at
        FROM required_items r
        JOIN information_items i
          ON i.interview_id = r.interview_id AND i.info_code = r.info_code
        WHERE r.interview_id = ?
        ORDER BY r.ordinal ASC`,
      )
      .all(interviewId);
    return rows.map((row) => this.mapInformationItem(row));
  }

  getInformationItem(interviewId: string, infoCode: string): InformationItem | null {
    const row = this.database
      .prepare(
        `SELECT
          r.info_code, r.label, r.category, r.priority, r.expected_type, r.required,
          r.min_quality, r.evidence_preference_json, r.dependencies_json,
          r.question, r.followup_question,
          i.status, i.value_state, i.value_json, i.quality, i.extraction_confidence,
          i.verification, i.evidence_ids_json, i.prefill_json, i.updated_at
        FROM required_items r
        JOIN information_items i
          ON i.interview_id = r.interview_id AND i.info_code = r.info_code
        WHERE r.interview_id = ? AND r.info_code = ?`,
      )
      .get(interviewId, infoCode);
    return row ? this.mapInformationItem(row) : null;
  }

  private mapInformationItem(row: SqlRow): InformationItem {
    return {
      infoCode: textValue(row.info_code),
      label: textValue(row.label),
      category: textValue(row.category) as InformationItem["category"],
      priority: textValue(row.priority) as InformationItem["priority"],
      expectedType: textValue(row.expected_type) as InformationItem["expectedType"],
      required: numberValue(row.required) === 1,
      minQuality: textValue(row.min_quality) as InformationItem["minQuality"],
      evidencePreference: parseJson(row.evidence_preference_json, []),
      dependencies: parseJson(row.dependencies_json, []),
      status: textValue(row.status) as InformationStatus,
      question: textValue(row.question),
      followupQuestion: nullableText(row.followup_question) ?? undefined,
      valueState: textValue(row.value_state) as ValueState,
      value: row.value_json === null ? null : parseJson(row.value_json, null),
      quality: nullableText(row.quality) as InformationQuality | null,
      extractionConfidence:
        row.extraction_confidence === null ? null : numberValue(row.extraction_confidence),
      verification: nullableText(row.verification) as EvidenceKind | null,
      evidenceIds: parseJson(row.evidence_ids_json, []),
      prefill: row.prefill_json === null ? null : parseJson(row.prefill_json, null),
      updatedAt: textValue(row.updated_at),
    };
  }

  listCanonicalRecords(tenantId: string, interviewId: string): CanonicalInformationRecord[] {
    return this.database
      .prepare(
        `SELECT record_json FROM canonical_information_records
         WHERE tenant_id = ? AND interview_id = ? ORDER BY rowid ASC`,
      )
      .all(tenantId, interviewId)
      .map((row) => {
        if (typeof row.record_json !== "string") {
          throw new Error("canonical information record payload is missing");
        }
        const parsed = JSON.parse(row.record_json) as CanonicalInformationRecord;
        if (!parsed.infoCode || !Array.isArray(parsed.revisions)) {
          throw new Error("canonical information record payload is invalid");
        }
        return parsed;
      });
  }

  upsertCanonicalRecord(
    tenantId: string,
    interviewId: string,
    aggregateVersion: number,
    record: CanonicalInformationRecord,
  ): void {
    this.database
      .prepare(
        `INSERT INTO canonical_information_records(
          tenant_id, interview_id, info_code, aggregate_version, record_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, interview_id, info_code) DO UPDATE SET
          aggregate_version = excluded.aggregate_version,
          record_json = excluded.record_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        tenantId,
        interviewId,
        record.infoCode,
        aggregateVersion,
        JSON.stringify(record),
        record.updatedAt,
      );
  }

  insertCanonicalRevision(
    tenantId: string,
    interviewId: string,
    revision: CanonicalValueRevision,
  ): void {
    this.database
      .prepare(
        `INSERT INTO canonical_value_revisions(
          id, tenant_id, interview_id, info_code, revision_number, revision_json, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revision.id,
        tenantId,
        interviewId,
        revision.infoCode,
        revision.revision,
        JSON.stringify(revision),
        revision.observedAt,
      );
  }

  insertCanonicalConflict(
    tenantId: string,
    interviewId: string,
    conflict: CanonicalConflict,
    createdAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO canonical_value_conflicts(
          id, tenant_id, interview_id, info_code, status,
          conflict_json, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, NULL)`,
      )
      .run(
        conflict.id,
        tenantId,
        interviewId,
        conflict.infoCode,
        JSON.stringify(conflict),
        createdAt,
      );
  }

  getOpenCanonicalConflict(
    tenantId: string,
    interviewId: string,
    infoCode: string,
  ): CanonicalConflict | null {
    const row = this.database
      .prepare(
        `SELECT conflict_json
         FROM canonical_value_conflicts
         WHERE tenant_id = ? AND interview_id = ? AND info_code = ? AND status = 'OPEN'
         LIMIT 1`,
      )
      .get(tenantId, interviewId, infoCode);
    return row ? parseJson<CanonicalConflict>(row.conflict_json, null as never) : null;
  }

  resolveCanonicalConflict(
    tenantId: string,
    interviewId: string,
    conflict: CanonicalConflict,
    resolvedAt: string,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE canonical_value_conflicts
         SET status = 'RESOLVED', conflict_json = ?, resolved_at = ?
         WHERE id = ? AND tenant_id = ? AND interview_id = ? AND status = 'OPEN'`,
      )
      .run(
        JSON.stringify(conflict),
        resolvedAt,
        conflict.id,
        tenantId,
        interviewId,
      );
    if (result.changes !== 1) {
      throw new Error(`open canonical conflict not found: ${conflict.id}`);
    }
  }

  replaceLiveFeatures(
    tenantId: string,
    interviewId: string,
    featureSet: LiveFeatureSet,
    now: string,
  ): void {
    this.database
      .prepare("DELETE FROM live_features WHERE tenant_id = ? AND interview_id = ?")
      .run(tenantId, interviewId);
    const insert = this.database.prepare(
      `INSERT INTO live_features(
        tenant_id, interview_id, feature_code, status, snapshot_type,
        aggregate_version, registry_version, raw_value_json, normalized_value_json,
        evidence_ids_json, calculation_json, updated_at
      ) VALUES (?, ?, ?, ?, 'PREVIEW', ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const feature of featureSet.features) {
      insert.run(
        tenantId,
        interviewId,
        feature.name,
        feature.state,
        featureSet.stateVersion,
        feature.registryVersion,
        feature.raw === null ? null : JSON.stringify(feature.raw),
        feature.normalized === null ? null : JSON.stringify(feature.normalized),
        JSON.stringify(feature.evidenceIds),
        JSON.stringify({
          sourceInfoCodes: feature.sourceInfoCodes,
          verification: feature.verification,
          formula: feature.formula,
          reason: feature.reason,
        }),
        now,
      );
    }
  }

  listTranscript(interviewId: string): PersistedTranscriptSegment[] {
    return this.database
      .prepare(
        `SELECT id, interview_id, sequence, speaker, text, confirmation,
                start_ms, end_ms, stt_confidence, stt_provider,
                raw_text, corrected_text,
                revision, created_at
         FROM transcript_segments WHERE interview_id = ? ORDER BY sequence ASC`,
      )
      .all(interviewId)
      .map((row) => ({
        id: textValue(row.id),
        interviewId: textValue(row.interview_id),
        sequence: numberValue(row.sequence),
        speaker: textValue(row.speaker) as TranscriptSegment["speaker"],
        text: textValue(row.text),
        confirmation: "FINAL" as const,
        startMs: nullableNumber(row.start_ms),
        endMs: nullableNumber(row.end_ms),
        sttConfidence: nullableNumber(row.stt_confidence),
        sttProvider: nullableText(row.stt_provider),
        rawText: nullableText(row.raw_text) ?? textValue(row.text),
        correctedText: nullableText(row.corrected_text),
        revision: numberValue(row.revision),
        createdAt: textValue(row.created_at),
      }));
  }

  nextTranscriptSequence(interviewId: string): number {
    const row = this.database
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM transcript_segments WHERE interview_id = ?")
      .get(interviewId);
    return numberValue(row?.next_sequence);
  }

  insertTranscript(
    segment: TranscriptSegment,
    capture: TranscriptCaptureMetadata = {},
  ): void {
    this.database
      .prepare(
        `INSERT INTO transcript_segments(
          id, interview_id, sequence, speaker, text, confirmation,
          start_ms, end_ms, stt_confidence, stt_provider,
          raw_text, corrected_text,
          revision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
      )
      .run(
        segment.id,
        segment.interviewId,
        segment.sequence,
        segment.speaker,
        segment.text,
        segment.confirmation,
        capture.startMs ?? null,
        capture.endMs ?? null,
        capture.sttConfidence ?? null,
        capture.sttProvider?.trim() || null,
        capture.rawText ?? segment.text,
        segment.createdAt,
      );
  }

  listEvidence(interviewId: string): EvidenceRef[] {
    return this.database
      .prepare(
        `SELECT id, interview_id, info_code, kind, source, transcript_segment_id,
                excerpt, observed_at, metadata_json
         FROM evidence_refs WHERE interview_id = ? ORDER BY rowid ASC`,
      )
      .all(interviewId)
      .map((row) => ({
        id: textValue(row.id),
        interviewId: textValue(row.interview_id),
        infoCode: textValue(row.info_code),
        kind: textValue(row.kind) as EvidenceKind,
        source: textValue(row.source),
        transcriptSegmentId: nullableText(row.transcript_segment_id),
        excerpt: nullableText(row.excerpt),
        observedAt: textValue(row.observed_at),
        metadata: parseJson(row.metadata_json, {}),
      }));
  }

  insertEvidence(evidence: EvidenceRef): void {
    this.database
      .prepare(
        `INSERT INTO evidence_refs(
          id, interview_id, info_code, kind, source, transcript_segment_id,
          excerpt, observed_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        evidence.id,
        evidence.interviewId,
        evidence.infoCode,
        evidence.kind,
        evidence.source,
        evidence.transcriptSegmentId,
        evidence.excerpt,
        evidence.observedAt,
        JSON.stringify(evidence.metadata),
      );
  }

  nextEventSequence(interviewId: string): number {
    const row = this.database
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM information_events WHERE interview_id = ?")
      .get(interviewId);
    return numberValue(row?.next_sequence);
  }

  listEventsAfter(interviewId: string, sequence: number): InformationStatusEvent[] {
    return this.database
      .prepare(
        `SELECT id, interview_id, info_code, sequence, event_type, from_status,
                to_status, accepted, reason, created_at
         FROM information_events
         WHERE interview_id = ? AND sequence > ? ORDER BY sequence ASC`,
      )
      .all(interviewId, sequence)
      .map((row) => ({
        id: textValue(row.id),
        interviewId: textValue(row.interview_id),
        infoCode: textValue(row.info_code),
        sequence: numberValue(row.sequence),
        eventType: textValue(row.event_type) as InformationStatusEvent["eventType"],
        fromStatus: textValue(row.from_status) as InformationStatus,
        toStatus: textValue(row.to_status) as InformationStatus,
        accepted: numberValue(row.accepted) === 1,
        reason: textValue(row.reason),
        createdAt: textValue(row.created_at),
      }));
  }

  transitionStatus(
    interviewId: string,
    infoCode: string,
    toStatus: InformationStatus,
    reason: string,
    eventId: string,
    now: string,
    context: TransitionContext = {},
  ): void {
    const item = this.getInformationItem(interviewId, infoCode);
    if (!item) throw new InterviewNotFoundError(interviewId);
    const sequence = this.nextEventSequence(interviewId);
    try {
      assertInformationTransition(item.status, toStatus, context);
    } catch (error) {
      if (error instanceof InvalidInformationTransitionError) {
        this.insertInformationEvent({
          id: eventId,
          interviewId,
          infoCode,
          sequence,
          eventType: "STATUS_CHANGE_REJECTED",
          fromStatus: item.status,
          toStatus,
          accepted: false,
          reason,
          createdAt: now,
        });
      }
      throw error;
    }

    this.database
      .prepare(
        "UPDATE information_items SET status = ?, updated_at = ? WHERE interview_id = ? AND info_code = ?",
      )
      .run(toStatus, now, interviewId, infoCode);
    this.insertInformationEvent({
      id: eventId,
      interviewId,
      infoCode,
      sequence,
      eventType: context.correction ? "CORRECTION" : "STATUS_CHANGED",
      fromStatus: item.status,
      toStatus,
      accepted: true,
      reason,
      createdAt: now,
    });
    this.touchInterview(interviewId, now);
  }

  private insertInformationEvent(event: InformationStatusEvent): void {
    this.database
      .prepare(
        `INSERT INTO information_events(
          id, interview_id, info_code, sequence, event_type, from_status,
          to_status, accepted, reason, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
      )
      .run(
        event.id,
        event.interviewId,
        event.infoCode,
        event.sequence,
        event.eventType,
        event.fromStatus,
        event.toStatus,
        event.accepted ? 1 : 0,
        event.reason,
        event.createdAt,
      );
  }

  updateValue(
    interviewId: string,
    infoCode: string,
    update: ValueUpdate,
    reason: string,
    eventId: string,
    now: string,
  ): void {
    const item = this.getInformationItem(interviewId, infoCode);
    if (!item) throw new InterviewNotFoundError(interviewId);
    this.database
      .prepare(
        `UPDATE information_items SET
          value_state = ?, value_json = ?, quality = ?, extraction_confidence = ?,
          verification = ?, evidence_ids_json = ?, updated_at = ?
         WHERE interview_id = ? AND info_code = ?`,
      )
      .run(
        update.valueState,
        update.value === null ? null : JSON.stringify(update.value),
        update.quality,
        update.extractionConfidence,
        update.verification,
        JSON.stringify(update.evidenceIds),
        now,
        interviewId,
        infoCode,
      );
    this.insertInformationEvent({
      id: eventId,
      interviewId,
      infoCode,
      sequence: this.nextEventSequence(interviewId),
      eventType: "VALUE_CHANGED",
      fromStatus: item.status,
      toStatus: item.status,
      accepted: true,
      reason,
      createdAt: now,
    });
    this.touchInterview(interviewId, now);
  }

  updateFollowupQuestion(
    interviewId: string,
    infoCode: string,
    followupQuestion: string,
  ): void {
    this.database
      .prepare(
        "UPDATE required_items SET followup_question = ? WHERE interview_id = ? AND info_code = ?",
      )
      .run(followupQuestion, interviewId, infoCode);
  }

  setCurrentQuestion(interviewId: string, infoCode: string | null, now: string): void {
    this.database
      .prepare("UPDATE interviews SET current_question_code = ?, updated_at = ? WHERE id = ?")
      .run(infoCode, now, interviewId);
  }

  private touchInterview(interviewId: string, now: string): void {
    this.database.prepare("UPDATE interviews SET updated_at = ? WHERE id = ?").run(now, interviewId);
  }

  completeInterview(
    interviewId: string,
    completionStatus: "COMPLETE" | "INCOMPLETE",
    now: string,
  ): void {
    this.database
      .prepare(
        `UPDATE interviews
         SET lifecycle_status = ?, completed_at = ?, updated_at = ?, current_question_code = NULL
         WHERE id = ? AND lifecycle_status = 'ACTIVE'`,
      )
      .run(completionStatus, now, now, interviewId);
  }

  insertFinalSnapshot<T extends PersistableFinalSnapshot>(snapshot: T): void {
    const snapshotJson = JSON.stringify(snapshot);
    const contentSha256 = createHash("sha256").update(snapshotJson, "utf8").digest("hex");
    this.database
      .prepare(
        `INSERT INTO final_snapshots(
          id, interview_id, version, snapshot_json, created_at, schema_version, content_sha256
         ) VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        snapshot.id,
        snapshot.interviewId,
        snapshot.version ?? snapshot.stateVersion ?? 1,
        snapshotJson,
        snapshot.finalizedAt,
        contentSha256,
      );
  }

  getFinalSnapshot<T extends PersistableFinalSnapshot = FinalInterviewSnapshot>(
    interviewId: string,
  ): T | null {
    const row = this.database
      .prepare("SELECT id, snapshot_json, content_sha256 FROM final_snapshots WHERE interview_id = ?")
      .get(interviewId);
    if (!row) return null;
    const snapshotJson = textValue(row.snapshot_json);
    const expectedHash = textValue(row.content_sha256);
    const actualHash = createHash("sha256").update(snapshotJson, "utf8").digest("hex");
    if (expectedHash !== actualHash) {
      throw new Error(`FINAL snapshot integrity check failed: ${textValue(row.id)}`);
    }
    const parsed = parseJson<T | null>(snapshotJson, null);
    if (!parsed || parsed.snapshotType !== "FINAL") {
      throw new Error(`FINAL snapshot schema check failed: ${textValue(row.id)}`);
    }
    return parsed;
  }

  insertEvaluationPayload(input: {
    id: string;
    interviewId: string;
    finalSnapshotId: string;
    snapshotVersion: number;
    status: "PENDING" | "GENERATING" | "READY" | "FAILED";
    payload: Record<string, unknown>;
    createdAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO evaluations(
          id, interview_id, final_snapshot_id, snapshot_version, status,
          evaluation_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.interviewId,
        input.finalSnapshotId,
        input.snapshotVersion,
        input.status,
        JSON.stringify(input.payload),
        input.createdAt,
      );
  }

  transitionEvaluationPayload(input: {
    id: string;
    fromStatus: "PENDING" | "GENERATING" | "READY" | "FAILED";
    toStatus: "PENDING" | "GENERATING" | "READY" | "FAILED";
    payload: Record<string, unknown>;
  }): void {
    const result = this.database
      .prepare(
        `UPDATE evaluations
         SET status = ?, evaluation_json = ?
         WHERE id = ? AND status = ?`,
      )
      .run(
        input.toStatus,
        JSON.stringify(input.payload),
        input.id,
        input.fromStatus,
      );
    if (Number(result.changes) !== 1) {
      throw new ApplicationError(
        409,
        "EVALUATION_STATUS_CONFLICT",
        "평가 상태 전이가 현재 저장 상태와 일치하지 않습니다.",
        {
          evaluationId: input.id,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
        },
      );
    }
  }

  insertEvaluationArtifacts(input: {
    tenantId: string;
    interviewId: string;
    evaluationId: string;
    pillars: EvaluationArtifactInput[];
    items: EvaluationArtifactInput[];
    goals: EvaluationArtifactInput[];
    createdAt: string;
  }): void {
    const insertPillar = this.database.prepare(
      `INSERT INTO evaluation_pillars(
        id, tenant_id, interview_id, evaluation_id, pillar_code,
        ordinal, result_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const pillar of input.pillars) {
      insertPillar.run(
        pillar.id,
        input.tenantId,
        input.interviewId,
        input.evaluationId,
        pillar.code,
        pillar.ordinal,
        JSON.stringify(pillar.result),
        input.createdAt,
      );
    }

    const insertItem = this.database.prepare(
      `INSERT INTO evaluation_items(
        id, tenant_id, interview_id, evaluation_id, pillar_id,
        item_code, ordinal, result_json, evidence_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of input.items) {
      insertItem.run(
        item.id,
        input.tenantId,
        input.interviewId,
        input.evaluationId,
        item.pillarId ?? null,
        item.code,
        item.ordinal,
        JSON.stringify(item.result),
        JSON.stringify(item.evidenceIds ?? []),
        input.createdAt,
      );
    }

    const insertGoal = this.database.prepare(
      `INSERT INTO evaluation_goals(
        id, tenant_id, interview_id, evaluation_id, goal_code,
        status, ordinal, goal_json, evidence_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const goal of input.goals) {
      insertGoal.run(
        goal.id,
        input.tenantId,
        input.interviewId,
        input.evaluationId,
        goal.code,
        goal.status ?? "UNRESOLVED",
        goal.ordinal,
        JSON.stringify(goal.result),
        JSON.stringify(goal.evidenceIds ?? []),
        input.createdAt,
      );
    }
  }

  getEvaluationRecord(
    idOrInterviewId: string,
  ): { id: string; interviewId: string; finalSnapshotId: string; snapshotVersion: number } {
    const row = this.database
      .prepare(
        `SELECT id, interview_id, final_snapshot_id, snapshot_version
         FROM evaluations WHERE id = ? OR interview_id = ? LIMIT 1`,
      )
      .get(idOrInterviewId, idOrInterviewId);
    if (!row) throw new EvaluationNotFoundError(idOrInterviewId);
    return {
      id: textValue(row.id),
      interviewId: textValue(row.interview_id),
      finalSnapshotId: textValue(row.final_snapshot_id),
      snapshotVersion: numberValue(row.snapshot_version),
    };
  }

  listEvaluationArtifacts<T extends Record<string, unknown>>(
    tenantId: string,
    evaluationId: string,
    kind: "pillars" | "items" | "goals",
  ): T[] {
    const configuration = {
      pillars: {
        table: "evaluation_pillars",
        payload: "result_json",
      },
      items: {
        table: "evaluation_items",
        payload: "result_json",
      },
      goals: {
        table: "evaluation_goals",
        payload: "goal_json",
      },
    } as const;
    const selected = configuration[kind];
    return this.database
      .prepare(
        `SELECT ${selected.payload} AS payload
         FROM ${selected.table}
         WHERE tenant_id = ? AND evaluation_id = ?
         ORDER BY ordinal ASC`,
      )
      .all(tenantId, evaluationId)
      .map((row) => parseJson<T>(row.payload, {} as T));
  }

  insertEvaluation(evaluation: InterviewEvaluation): void {
    this.database
      .prepare(
        `INSERT INTO evaluations(
          id, interview_id, final_snapshot_id, snapshot_version, status,
          evaluation_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        evaluation.id,
        evaluation.interviewId,
        evaluation.finalSnapshotId,
        evaluation.snapshotVersion,
        evaluation.status,
        JSON.stringify(evaluation),
        evaluation.createdAt,
      );
  }

  getEvaluation<T = InterviewEvaluation>(idOrInterviewId: string): T {
    const row = this.database
      .prepare(
        "SELECT evaluation_json FROM evaluations WHERE id = ? OR interview_id = ? LIMIT 1",
      )
      .get(idOrInterviewId, idOrInterviewId);
    if (!row) throw new EvaluationNotFoundError(idOrInterviewId);
    return parseJson<T>(row.evaluation_json, null as never);
  }

  insertAuditEvent(
    id: string,
    interviewId: string,
    eventType: string,
    payload: Record<string, unknown>,
    now: string,
  ): void {
    this.database
      .prepare(
        "INSERT INTO audit_events(id, interview_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, interviewId, eventType, JSON.stringify(payload), now);
  }

  insertBorrowerImprovementSelection(
    input: BorrowerImprovementSelectionInsert,
  ): BorrowerImprovementSelection {
    const candidate = input.choice === "SKIP" ? null : input.choice;
    this.database
      .prepare(
        `INSERT INTO borrower_improvement_candidate_selections(
          id, tenant_id, interview_id, final_snapshot_id, event_type,
          choice_kind, candidate_id, candidate_title, candidate_origin,
          source_info_codes_json, evidence_ids_json, live_version,
          client_command_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        input.interviewId,
        input.finalSnapshotId,
        BORROWER_SELECTED_IMPROVEMENT_CANDIDATE,
        candidate ? "CANDIDATE" : "SKIP",
        candidate?.id ?? null,
        candidate?.title ?? null,
        candidate?.origin ?? null,
        JSON.stringify(candidate?.sourceInfoCodes ?? []),
        JSON.stringify(candidate?.evidenceIds ?? []),
        input.liveVersion,
        input.clientCommandId,
        input.createdAt,
      );
    return {
      id: input.id,
      eventType: BORROWER_SELECTED_IMPROVEMENT_CANDIDATE,
      choice: input.choice,
      liveVersion: input.liveVersion,
      selectedAt: input.createdAt,
    };
  }

  getBorrowerImprovementSelection(
    tenantId: string,
    interviewId: string,
  ): BorrowerImprovementSelection | null {
    const row = this.database
      .prepare(
        `SELECT id, event_type, choice_kind, candidate_id, candidate_title,
                candidate_origin, source_info_codes_json, evidence_ids_json,
                live_version, created_at
         FROM borrower_improvement_candidate_selections
         WHERE tenant_id = ? AND interview_id = ?`,
      )
      .get(tenantId, interviewId);
    if (!row) return null;
    const choice: BorrowerImprovementChoice = row.choice_kind === "SKIP"
      ? "SKIP"
      : {
          id: textValue(row.candidate_id),
          title: textValue(row.candidate_title),
          origin: textValue(row.candidate_origin) as Exclude<
            BorrowerImprovementChoice,
            "SKIP"
          >["origin"],
          sourceInfoCodes: parseJson<string[]>(row.source_info_codes_json, []),
          evidenceIds: parseJson<string[]>(row.evidence_ids_json, []),
        };
    return {
      id: textValue(row.id),
      eventType: BORROWER_SELECTED_IMPROVEMENT_CANDIDATE,
      choice,
      liveVersion: numberValue(row.live_version),
      selectedAt: textValue(row.created_at),
    };
  }
}
