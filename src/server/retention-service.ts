import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface RetentionRunResult {
  runId: string;
  dryRun: boolean;
  cutoff: string;
  candidates: {
    authSessions: number;
    outboxEvents: number;
  };
  deleted: {
    authSessions: number;
    outboxEvents: number;
  };
  protectedArtifacts: ["TRANSCRIPT", "EVIDENCE", "AUDIT_EVENT", "FINAL_SNAPSHOT"];
}

function count(database: DatabaseSync, sql: string, cutoff: string): number {
  const row = database.prepare(sql).get(cutoff);
  return Number(row?.count ?? 0);
}

export class RetentionService {
  constructor(
    readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {}

  enforce(dryRun = true): RetentionRunResult {
    const cutoff = this.now().toISOString();
    const runId = this.idFactory();
    const sessionCandidates = count(
      this.database,
      `SELECT COUNT(*) AS count FROM auth_sessions
       WHERE expires_at <= ? OR revoked_at IS NOT NULL`,
      cutoff,
    );
    const outboxCandidates = count(
      this.database,
      "SELECT COUNT(*) AS count FROM outbox_events WHERE expires_at <= ?",
      cutoff,
    );
    const result: RetentionRunResult = {
      runId,
      dryRun,
      cutoff,
      candidates: { authSessions: sessionCandidates, outboxEvents: outboxCandidates },
      deleted: { authSessions: 0, outboxEvents: 0 },
      protectedArtifacts: ["TRANSCRIPT", "EVIDENCE", "AUDIT_EVENT", "FINAL_SNAPSHOT"],
    };

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      if (!dryRun) {
        result.deleted.authSessions = Number(
          this.database
            .prepare(
              `DELETE FROM auth_sessions
               WHERE expires_at <= ? OR revoked_at IS NOT NULL`,
            )
            .run(cutoff).changes,
        );
        result.deleted.outboxEvents = Number(
          this.database
            .prepare("DELETE FROM outbox_events WHERE expires_at <= ?")
            .run(cutoff).changes,
        );
      }
      this.database
        .prepare(
          `INSERT INTO retention_runs(id, started_at, completed_at, dry_run, result_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(runId, cutoff, this.now().toISOString(), dryRun ? 1 : 0, JSON.stringify(result));
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }
}
