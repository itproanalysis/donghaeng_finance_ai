import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DATABASE_PATH = join("data", "donghaeng-ai.db");
const MIGRATION_FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function migrationDirectory(): string {
  return resolve(/* turbopackIgnore: true */ process.cwd(), "migrations");
}

function configureConnection(database: DatabaseSync, fileBacked: boolean): void {
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA recursive_triggers = ON;");
  database.exec("PRAGMA busy_timeout = 5000;");
  if (fileBacked) {
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA synchronous = FULL;");
  }
}

function ensureMigrationHistory(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL CHECK (length(checksum) = 64),
      applied_at TEXT NOT NULL
    );
  `);
}

function appliedMigrations(database: DatabaseSync): Map<string, string> {
  const rows = database
    .prepare("SELECT version, checksum FROM app_schema_migrations ORDER BY version")
    .all();
  return new Map(
    rows.map((row) => [String(row.version), String(row.checksum)]),
  );
}

function applyMigration(
  database: DatabaseSync,
  version: string,
  checksum: string,
  migration: string,
): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    database.exec(migration);
    database
      .prepare(
        `INSERT INTO app_schema_migrations(version, checksum, applied_at)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      )
      .run(version, checksum);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function backfillSnapshotHashesAndInstallGuards(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(final_snapshots)").all();
  if (!columns.some((column) => column.name === "content_sha256")) return;

  database.exec("DROP TRIGGER IF EXISTS final_snapshots_are_immutable_update;");
  database.exec("DROP TRIGGER IF EXISTS final_snapshots_are_immutable_delete;");

  const rows = database
    .prepare("SELECT id, snapshot_json, content_sha256 FROM final_snapshots")
    .all();
  const update = database.prepare(
    "UPDATE final_snapshots SET content_sha256 = ? WHERE id = ?",
  );
  for (const row of rows) {
    const snapshotJson = String(row.snapshot_json);
    const actualHash = sha256(snapshotJson);
    const storedHash = String(row.content_sha256 ?? "");
    if (storedHash && storedHash !== actualHash) {
      throw new Error(`FINAL snapshot hash mismatch during migration: ${String(row.id)}`);
    }
    if (!storedHash) update.run(actualHash, String(row.id));
  }

  database.exec(`
    CREATE TRIGGER final_snapshots_are_immutable_update
    BEFORE UPDATE ON final_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'FINAL snapshot is immutable');
    END;

    CREATE TRIGGER final_snapshots_are_immutable_delete
    BEFORE DELETE ON final_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'FINAL snapshot is immutable');
    END;
  `);
}

export function migrateDatabase(database: DatabaseSync): void {
  ensureMigrationHistory(database);
  const applied = appliedMigrations(database);
  const directory = migrationDirectory();
  const migrationFiles = readdirSync(directory)
    .filter((file) => MIGRATION_FILE_PATTERN.test(file))
    .sort((left, right) => left.localeCompare(right));

  for (const file of migrationFiles) {
    const version = file.slice(0, -".sql".length);
    const migration = readFileSync(join(directory, file), "utf8");
    const checksum = sha256(migration);
    const recordedChecksum = applied.get(version);
    if (recordedChecksum) {
      if (recordedChecksum !== checksum) {
        throw new Error(`Migration checksum mismatch: ${version}`);
      }
      continue;
    }
    applyMigration(database, version, checksum, migration);
  }

  backfillSnapshotHashesAndInstallGuards(database);
}

export function openDatabase(databasePath = process.env.DONGHAENG_DB_PATH): DatabaseSync {
  const configuredPath = databasePath?.trim() || DEFAULT_DATABASE_PATH;
  const resolvedPath =
    configuredPath === ":memory:"
      ? configuredPath
      : isAbsolute(configuredPath)
        ? configuredPath
        : resolve(/* turbopackIgnore: true */ process.cwd(), configuredPath);

  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new DatabaseSync(resolvedPath);
  configureConnection(database, resolvedPath !== ":memory:");
  migrateDatabase(database);
  return database;
}

const globalDatabase = globalThis as typeof globalThis & {
  __donghaengDatabase?: DatabaseSync;
};

export function getDatabase(): DatabaseSync {
  if (!globalDatabase.__donghaengDatabase) {
    globalDatabase.__donghaengDatabase = openDatabase();
  }
  return globalDatabase.__donghaengDatabase;
}

export function createInMemoryDatabase(): DatabaseSync {
  return openDatabase(":memory:");
}
