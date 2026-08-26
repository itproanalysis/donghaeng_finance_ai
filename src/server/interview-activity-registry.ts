import type { DatabaseSync } from "node:sqlite";

export const DEFAULT_AUDIO_TURN_LEASE_MS = 90_000;
export const AUDIO_TURN_LEASE_RENEW_INTERVAL_MS = 15_000;

export type AudioTurnLeaseState = "ACTIVE" | "FINAL_TRANSCRIPT_PENDING";

export interface InterviewActivitySnapshot {
  activeTurn: boolean;
  finalTranscriptPending: boolean;
  activeAudioSessionIds: string[];
  pendingAudioSessionIds: string[];
}

export interface AudioTurnLeaseIdentity {
  tenantId: string;
  interviewId: string;
  audioSessionId: string;
  ownerToken: string;
}

export class AudioTurnLeaseConflictError extends Error {
  readonly name = "AudioTurnLeaseConflictError";
  readonly code = "AUDIO_TURN_LEASE_CONFLICT";

  constructor(readonly audioSessionId: string) {
    super("동일한 음성 세션이 다른 서버에서 이미 처리 중입니다.");
  }
}

function iso(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) throw new TypeError("유효한 lease 시간이 필요합니다.");
  return date.toISOString();
}

/**
 * Database-backed activity gate shared by WebSocket and HTTP instances.
 * Owner-token compare-and-set prevents a stale socket cleanup from deleting a
 * lease that a replacement worker acquired after expiry.
 */
export class InterviewActivityRegistry {
  constructor(
    private readonly database: DatabaseSync,
    private readonly leaseMilliseconds = DEFAULT_AUDIO_TURN_LEASE_MS,
  ) {
    if (!Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds < 1_000) {
      throw new TypeError("audio turn lease TTL must be at least one second");
    }
  }

  beginTurn(identity: AudioTurnLeaseIdentity, now: Date | string = new Date()): void {
    this.upsert(identity, "ACTIVE", now);
  }

  markFinalTranscriptPending(
    identity: AudioTurnLeaseIdentity,
    now: Date | string = new Date(),
  ): void {
    this.upsert(identity, "FINAL_TRANSCRIPT_PENDING", now);
  }

  renewTurn(
    identity: AudioTurnLeaseIdentity,
    now: Date | string = new Date(),
  ): boolean {
    const updatedAt = iso(now);
    const expiresAt = new Date(
      new Date(updatedAt).getTime() + this.leaseMilliseconds,
    ).toISOString();
    const result = this.database
      .prepare(
        `UPDATE audio_turn_leases
         SET expires_at = ?, updated_at = ?
         WHERE tenant_id = ? AND interview_id = ? AND audio_session_id = ?
           AND owner_token = ? AND expires_at > ?
           AND EXISTS (
             SELECT 1 FROM interviews i
             WHERE i.tenant_id = audio_turn_leases.tenant_id
               AND i.id = audio_turn_leases.interview_id
               AND i.lifecycle_status = 'ACTIVE'
           )`,
      )
      .run(
        expiresAt,
        updatedAt,
        identity.tenantId,
        identity.interviewId,
        identity.audioSessionId,
        identity.ownerToken,
        updatedAt,
      );
    return Number(result.changes) === 1;
  }

  finishTurn(identity: AudioTurnLeaseIdentity): void {
    this.database
      .prepare(
        `DELETE FROM audio_turn_leases
         WHERE tenant_id = ? AND interview_id = ? AND audio_session_id = ?
           AND owner_token = ?`,
      )
      .run(
        identity.tenantId,
        identity.interviewId,
        identity.audioSessionId,
        identity.ownerToken,
      );
  }

  snapshot(
    tenantId: string,
    interviewId: string,
    now: Date | string = new Date(),
  ): InterviewActivitySnapshot {
    const observedAt = iso(now);
    this.database
      .prepare(
        `DELETE FROM audio_turn_leases
         WHERE tenant_id = ? AND interview_id = ? AND expires_at <= ?`,
      )
      .run(tenantId, interviewId, observedAt);
    const rows = this.database
      .prepare(
        `SELECT audio_session_id, state
         FROM audio_turn_leases
         WHERE tenant_id = ? AND interview_id = ? AND expires_at > ?
         ORDER BY audio_session_id`,
      )
      .all(tenantId, interviewId, observedAt);
    const activeAudioSessionIds = rows.map((row) => String(row.audio_session_id));
    const pendingAudioSessionIds = rows
      .filter((row) => row.state === "FINAL_TRANSCRIPT_PENDING")
      .map((row) => String(row.audio_session_id));
    return {
      activeTurn: activeAudioSessionIds.length > 0,
      finalTranscriptPending: pendingAudioSessionIds.length > 0,
      activeAudioSessionIds,
      pendingAudioSessionIds,
    };
  }

  resetForTests(): void {
    this.database.exec("DELETE FROM audio_turn_leases;");
  }

  private upsert(
    identity: AudioTurnLeaseIdentity,
    state: AudioTurnLeaseState,
    now: Date | string,
  ): void {
    const updatedAt = iso(now);
    const expiresAt = new Date(
      new Date(updatedAt).getTime() + this.leaseMilliseconds,
    ).toISOString();
    const result = this.database
      .prepare(
        `INSERT INTO audio_turn_leases(
           tenant_id, interview_id, audio_session_id, owner_token, state,
           expires_at, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         FROM interviews i
         WHERE i.tenant_id = ? AND i.id = ? AND i.lifecycle_status = 'ACTIVE'
         ON CONFLICT(tenant_id, interview_id, audio_session_id) DO UPDATE SET
           owner_token = excluded.owner_token,
           state = excluded.state,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at
         WHERE audio_turn_leases.owner_token = excluded.owner_token
            OR audio_turn_leases.expires_at <= excluded.updated_at`,
      )
      .run(
        identity.tenantId,
        identity.interviewId,
        identity.audioSessionId,
        identity.ownerToken,
        state,
        expiresAt,
        updatedAt,
        updatedAt,
        identity.tenantId,
        identity.interviewId,
      );
    if (Number(result.changes) !== 1) {
      throw new AudioTurnLeaseConflictError(identity.audioSessionId);
    }
  }
}
