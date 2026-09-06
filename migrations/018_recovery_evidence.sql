PRAGMA foreign_keys = ON;

-- Post-analysis intervention records deliberately cannot alter FINAL,
-- canonical values, interview data quality, or credit decisions.
CREATE TABLE recovery_evidence (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  final_snapshot_id TEXT NOT NULL REFERENCES final_snapshots(id),
  mission_id INTEGER NOT NULL CHECK (mission_id IN (1, 2, 3)),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  note TEXT NOT NULL CHECK (length(note) BETWEEN 10 AND 2000),
  observed_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  client_command_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  FOREIGN KEY (tenant_id, interview_id) REFERENCES interviews(tenant_id, id),
  UNIQUE (tenant_id, interview_id, client_command_id)
);
CREATE INDEX idx_recovery_evidence_interview ON recovery_evidence(tenant_id, interview_id, created_at, id);
CREATE TRIGGER recovery_evidence_final_guard BEFORE INSERT ON recovery_evidence
WHEN NOT EXISTS (SELECT 1 FROM final_snapshots WHERE id = NEW.final_snapshot_id AND interview_id = NEW.interview_id)
BEGIN SELECT RAISE(ABORT, 'recovery evidence FINAL mismatch'); END;
CREATE TRIGGER recovery_evidence_immutable_update BEFORE UPDATE ON recovery_evidence
BEGIN SELECT RAISE(ABORT, 'recovery evidence is append-only'); END;
CREATE TRIGGER recovery_evidence_immutable_delete BEFORE DELETE ON recovery_evidence
BEGIN SELECT RAISE(ABORT, 'recovery evidence is append-only'); END;

CREATE TABLE data_review_decisions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, interview_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('NEEDS_INFORMATION', 'REVIEWED')),
  note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL, created_by TEXT NOT NULL,
  client_command_id TEXT NOT NULL, request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  FOREIGN KEY (tenant_id, interview_id) REFERENCES interviews(tenant_id, id),
  UNIQUE (tenant_id, interview_id, revision), UNIQUE (tenant_id, interview_id, client_command_id)
);
CREATE TRIGGER data_review_decisions_immutable_update BEFORE UPDATE ON data_review_decisions
BEGIN SELECT RAISE(ABORT, 'review decision is append-only'); END;
CREATE TRIGGER data_review_decisions_immutable_delete BEFORE DELETE ON data_review_decisions
BEGIN SELECT RAISE(ABORT, 'review decision is append-only'); END;
PRAGMA user_version = 18;
