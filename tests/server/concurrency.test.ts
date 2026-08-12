import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "../../src/server/auth";
import { openDatabase } from "../../src/server/database";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const principal: Principal = {
  tenantId: LOCAL_WORKSPACE_TENANT_ID,
  userId: LOCAL_WORKSPACE_USER_ID,
  email: LOCAL_WORKSPACE_EMAIL,
  displayName: "로컬 데모 담당자",
  roles: ["ADMIN", "INTERVIEWER"],
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory && resolve(directory).startsWith(resolve(tmpdir()))) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

const workerSource = String.raw`
  const { createHash, randomUUID } = require("node:crypto");
  const { DatabaseSync } = require("node:sqlite");
  const { parentPort, workerData } = require("node:worker_threads");

  const database = new DatabaseSync(workerData.databasePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  parentPort.postMessage({ type: "ready" });
  Atomics.wait(new Int32Array(workerData.barrier), 0, 0);

  try {
    database.exec("BEGIN IMMEDIATE;");
    const updated = database.prepare(
      "UPDATE interviews SET version = version + 1, event_seq = event_seq + 1, updated_at = ? " +
      "WHERE tenant_id = ? AND id = ? AND lifecycle_status = 'ACTIVE' AND version = ? " +
      "RETURNING version, event_seq"
    ).get(workerData.now, workerData.tenantId, workerData.interviewId, workerData.expectedVersion);

    if (updated) {
      const response = JSON.stringify({ winner: workerData.label, version: updated.version });
      database.prepare(
        "INSERT INTO command_receipts(" +
        "id, tenant_id, interview_id, command_type, client_command_id, request_hash, " +
        "expected_version, resulting_version, response_json, created_at" +
        ") VALUES (?, ?, ?, 'MESSAGE', ?, ?, ?, ?, ?, ?)"
      ).run(
        randomUUID(), workerData.tenantId, workerData.interviewId,
        "concurrent-" + workerData.label,
        createHash("sha256").update(workerData.label).digest("hex"),
        workerData.expectedVersion, updated.version, response, workerData.now
      );
      const eventId = randomUUID();
      const event = JSON.stringify({
        schemaVersion: 1,
        eventId,
        seq: updated.event_seq,
        type: "coverage.changed",
        interviewId: workerData.interviewId,
        aggregateVersion: updated.version,
        snapshotType: "PREVIEW",
        occurredAt: workerData.now,
        turnId: "concurrent-" + workerData.label,
        batchIndex: 0,
        batchSize: 1,
        isBatchFinal: true,
        snapshotUrl: "/api/interviews/" + workerData.interviewId,
        data: { winner: workerData.label }
      });
      database.prepare(
        "INSERT INTO outbox_events(" +
        "event_id, tenant_id, interview_id, sequence, aggregate_version, event_type, " +
        "turn_id, batch_index, batch_size, event_json, created_at, expires_at" +
        ") VALUES (?, ?, ?, ?, ?, 'coverage.changed', ?, 0, 1, ?, ?, ?)"
      ).run(
        eventId, workerData.tenantId, workerData.interviewId, updated.event_seq,
        updated.version, "concurrent-" + workerData.label, event,
        workerData.now, "2026-08-17T00:00:00.000Z"
      );
      database.exec("COMMIT;");
      parentPort.postMessage({ type: "result", won: true, label: workerData.label });
    } else {
      database.exec("COMMIT;");
      parentPort.postMessage({ type: "result", won: false, label: workerData.label });
    }
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK;");
    parentPort.postMessage({ type: "error", message: String(error && error.stack || error) });
  } finally {
    database.close();
  }
`;

function runWriter(input: {
  databasePath: string;
  barrier: SharedArrayBuffer;
  interviewId: string;
  label: string;
}): { worker: Worker; ready: Promise<void>; result: Promise<{ won: boolean; label: string }> } {
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: {
      ...input,
      tenantId: LOCAL_WORKSPACE_TENANT_ID,
      expectedVersion: 1,
      now: "2026-08-10T00:00:00.000Z",
    },
  });
  let markReady: (() => void) | undefined;
  let settleResult:
    | ((value: { won: boolean; label: string }) => void)
    | undefined;
  let rejectResult: ((reason: Error) => void) | undefined;
  const ready = new Promise<void>((resolveReady) => {
    markReady = resolveReady;
  });
  const result = new Promise<{ won: boolean; label: string }>((resolveResult, reject) => {
    settleResult = resolveResult;
    rejectResult = reject;
  });
  worker.on("message", (message: { type: string; won?: boolean; label?: string; message?: string }) => {
    if (message.type === "ready") markReady?.();
    if (message.type === "result") {
      settleResult?.({ won: Boolean(message.won), label: String(message.label) });
    }
    if (message.type === "error") rejectResult?.(new Error(message.message));
  });
  worker.on("error", (error) => rejectResult?.(error));
  worker.on("exit", (code) => {
    if (code !== 0) rejectResult?.(new Error(`writer worker exited with ${code}`));
  });
  return { worker, ready, result };
}

describe("SQLite command concurrency boundary", () => {
  it(
    "allows exactly one independent writer to win the same aggregate CAS",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "donghaeng-concurrency-"));
      temporaryDirectories.push(directory);
      const databasePath = join(directory, "concurrency.db");
      const setupDatabase = openDatabase(databasePath);
      const service = new InterviewService(new InterviewRepository(setupDatabase), {
        now: () => new Date("2026-08-10T00:00:00.000Z"),
      });
      const created = service.createInterview(principal);
      const initialEventSeq = created.session.lastEventSeq;
      setupDatabase.close();

      const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
      const left = runWriter({ databasePath, barrier, interviewId: created.session.id, label: "left" });
      const right = runWriter({ databasePath, barrier, interviewId: created.session.id, label: "right" });
      await Promise.all([left.ready, right.ready]);
      Atomics.store(new Int32Array(barrier), 0, 1);
      Atomics.notify(new Int32Array(barrier), 0, 2);
      const results = await Promise.all([left.result, right.result]);
      await Promise.all([left.worker.terminate(), right.worker.terminate()]);

      expect(results.filter((result) => result.won)).toHaveLength(1);
      expect(results.filter((result) => !result.won)).toHaveLength(1);

      const verifier = openDatabase(databasePath);
      try {
        expect(
          verifier
            .prepare("SELECT version, event_seq FROM interviews WHERE id = ?")
            .get(created.session.id),
        ).toEqual({ version: 2, event_seq: initialEventSeq + 1 });
        expect(
          verifier
            .prepare("SELECT COUNT(*) AS count FROM command_receipts WHERE interview_id = ?")
            .get(created.session.id)?.count,
        ).toBe(1);
        expect(
          verifier
            .prepare(
              `SELECT COUNT(*) AS count FROM outbox_events
               WHERE interview_id = ? AND aggregate_version = 2`,
            )
            .get(created.session.id)?.count,
        ).toBe(1);
      } finally {
        verifier.close();
      }
    },
    15_000,
  );
});
