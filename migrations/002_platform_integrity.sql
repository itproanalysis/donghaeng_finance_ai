PRAGMA foreign_keys = ON;

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  roles_json TEXT NOT NULL DEFAULT '["INTERVIEWER"]'
    CHECK (json_valid(roles_json) AND json_type(roles_json) = 'array'),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, email_normalized),
  UNIQUE (tenant_id, id)
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);

CREATE INDEX idx_auth_sessions_active_token
  ON auth_sessions(token_hash, expires_at, revoked_at);

CREATE TABLE consent_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  interview_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('MICROPHONE_INTERVIEW', 'RAW_AUDIO_STORAGE')),
  consent_version TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  expires_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (interview_id) REFERENCES interviews(id)
);

ALTER TABLE borrowers
  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'local-workspace-tenant';
ALTER TABLE business_profiles
  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'local-workspace-tenant';
ALTER TABLE interviews
  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'local-workspace-tenant';
ALTER TABLE interviews
  ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT 'local-workspace-user';
ALTER TABLE interviews
  ADD COLUMN event_seq INTEGER NOT NULL DEFAULT 0 CHECK (event_seq >= 0);
ALTER TABLE interviews
  ADD COLUMN retention_expires_at TEXT;

CREATE UNIQUE INDEX idx_borrowers_tenant_id
  ON borrowers(tenant_id, id);
CREATE UNIQUE INDEX idx_business_profiles_tenant_id
  ON business_profiles(tenant_id, id);
CREATE UNIQUE INDEX idx_interviews_tenant_id
  ON interviews(tenant_id, id);
CREATE INDEX idx_interviews_tenant_lifecycle_updated
  ON interviews(tenant_id, lifecycle_status, updated_at DESC);

CREATE TRIGGER borrowers_tenant_insert_guard
BEFORE INSERT ON borrowers
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'unknown borrower tenant');
END;

CREATE TRIGGER borrowers_tenant_update_guard
BEFORE UPDATE OF tenant_id ON borrowers
BEGIN
  SELECT RAISE(ABORT, 'borrower tenant is immutable');
END;

CREATE TRIGGER business_profiles_tenant_insert_guard
BEFORE INSERT ON business_profiles
WHEN NOT EXISTS (
  SELECT 1 FROM borrowers b
  WHERE b.id = NEW.borrower_id AND b.tenant_id = NEW.tenant_id
)
BEGIN
  SELECT RAISE(ABORT, 'business profile tenant mismatch');
END;

CREATE TRIGGER business_profiles_tenant_update_guard
BEFORE UPDATE OF tenant_id, borrower_id ON business_profiles
BEGIN
  SELECT RAISE(ABORT, 'business profile ownership is immutable');
END;

CREATE TRIGGER interviews_tenant_insert_guard
BEFORE INSERT ON interviews
WHEN NOT EXISTS (
  SELECT 1
  FROM borrowers b
  JOIN business_profiles p ON p.id = NEW.business_profile_id
  JOIN users u ON u.id = NEW.owner_user_id
  WHERE b.id = NEW.borrower_id
    AND b.tenant_id = NEW.tenant_id
    AND p.borrower_id = b.id
    AND p.tenant_id = NEW.tenant_id
    AND u.tenant_id = NEW.tenant_id
    AND u.active = 1
)
BEGIN
  SELECT RAISE(ABORT, 'interview tenant ownership mismatch');
END;

CREATE TRIGGER interviews_tenant_update_guard
BEFORE UPDATE OF tenant_id, borrower_id, business_profile_id, owner_user_id ON interviews
BEGIN
  SELECT RAISE(ABORT, 'interview ownership is immutable');
END;

CREATE TABLE command_receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  command_type TEXT NOT NULL CHECK (command_type IN ('MESSAGE', 'COMPLETE')),
  client_command_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  expected_version INTEGER NOT NULL CHECK (expected_version >= 1),
  resulting_version INTEGER NOT NULL CHECK (resulting_version >= expected_version),
  response_json TEXT NOT NULL
    CHECK (json_valid(response_json) AND json_type(response_json) = 'object'),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, interview_id, command_type, client_command_id)
);

CREATE INDEX idx_command_receipts_interview_created
  ON command_receipts(tenant_id, interview_id, created_at DESC);

CREATE TABLE outbox_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version >= 1),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'info.status_changed',
    'info.value_changed',
    'coverage.changed',
    'feature.preview_updated',
    'summary.preview_updated',
    'question.generated',
    'conflict.detected',
    'ready_to_complete',
    'interview.completed'
  )),
  turn_id TEXT NOT NULL,
  batch_index INTEGER NOT NULL CHECK (batch_index >= 0),
  batch_size INTEGER NOT NULL CHECK (batch_size >= 1 AND batch_index < batch_size),
  event_json TEXT NOT NULL
    CHECK (json_valid(event_json) AND json_type(event_json) = 'object'),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (tenant_id, interview_id, sequence)
);

CREATE INDEX idx_outbox_replay
  ON outbox_events(tenant_id, interview_id, sequence);
CREATE INDEX idx_outbox_retention
  ON outbox_events(expires_at);

CREATE TRIGGER outbox_events_are_immutable_update
BEFORE UPDATE ON outbox_events
BEGIN
  SELECT RAISE(ABORT, 'outbox event is immutable');
END;

ALTER TABLE final_snapshots
  ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1);
ALTER TABLE final_snapshots
  ADD COLUMN content_sha256 TEXT NOT NULL DEFAULT ''
    CHECK (content_sha256 = '' OR length(content_sha256) = 64);

DROP TRIGGER IF EXISTS final_snapshots_are_immutable_update;
DROP TRIGGER IF EXISTS final_snapshots_are_immutable_delete;

CREATE TRIGGER final_snapshot_insert_guard
BEFORE INSERT ON final_snapshots
WHEN NOT (
  json_valid(NEW.snapshot_json)
  AND json_type(NEW.snapshot_json) = 'object'
  AND json_extract(NEW.snapshot_json, '$.snapshotType') = 'FINAL'
  AND length(NEW.content_sha256) = 64
)
BEGIN
  SELECT RAISE(ABORT, 'invalid immutable FINAL snapshot payload');
END;

ALTER TABLE transcript_segments ADD COLUMN retention_expires_at TEXT;
ALTER TABLE evidence_refs ADD COLUMN retention_expires_at TEXT;
ALTER TABLE audit_events ADD COLUMN retention_expires_at TEXT;

CREATE TABLE retention_policies (
  artifact_type TEXT PRIMARY KEY CHECK (artifact_type IN (
    'AUTH_SESSION', 'OUTBOX_EVENT', 'TRANSCRIPT', 'EVIDENCE', 'AUDIT_EVENT', 'FINAL_SNAPSHOT'
  )),
  retention_days INTEGER CHECK (retention_days IS NULL OR retention_days >= 0),
  purge_enabled INTEGER NOT NULL CHECK (purge_enabled IN (0, 1)),
  rationale TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE retention_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  dry_run INTEGER NOT NULL CHECK (dry_run IN (0, 1)),
  result_json TEXT NOT NULL
    CHECK (json_valid(result_json) AND json_type(result_json) = 'object')
);

INSERT INTO tenants(id, slug, name, created_at)
VALUES (
  'local-workspace-tenant',
  'local-workspace',
  '동행금융 로컬 작업공간',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

-- The local workspace owner is initialized only for a developer's own machine.
-- Bootstrap replaces the sentinel before issuing a session; the sentinel is
-- never accepted by the login verifier or used in production.
INSERT INTO users(
  id, tenant_id, email, email_normalized, display_name,
  password_salt, password_hash, roles_json, active, created_at
)
VALUES (
  'local-workspace-user',
  'local-workspace-tenant',
  'local@donghaeng.workspace',
  'local@donghaeng.workspace',
  '로컬 작업공간 담당자',
  'UNINITIALIZED',
  'UNINITIALIZED',
  '["ADMIN","INTERVIEWER"]',
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO retention_policies(artifact_type, retention_days, purge_enabled, rationale, updated_at)
VALUES
  ('AUTH_SESSION', 1, 1, '만료 또는 철회된 로컬 세션 정리', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('OUTBOX_EVENT', 7, 1, 'SSE 재접속 replay window', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('TRANSCRIPT', 365, 0, 'FINAL snapshot과 개인정보 정책 확정 전 자동 삭제 금지', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('EVIDENCE', 365, 0, 'FINAL 근거 무결성을 위해 로컬 작업공간에서는 보존', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('AUDIT_EVENT', 365, 0, '감사 보존기간 승인 전 자동 삭제 금지', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('FINAL_SNAPSHOT', NULL, 0, '불변 인터뷰 snapshot', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TRIGGER required_items_json_insert_guard
BEFORE INSERT ON required_items
WHEN NOT (
  json_valid(NEW.evidence_preference_json)
  AND json_type(NEW.evidence_preference_json) = 'array'
  AND json_valid(NEW.dependencies_json)
  AND json_type(NEW.dependencies_json) = 'array'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid required_items JSON');
END;

CREATE TRIGGER required_items_json_update_guard
BEFORE UPDATE OF evidence_preference_json, dependencies_json ON required_items
WHEN NOT (
  json_valid(NEW.evidence_preference_json)
  AND json_type(NEW.evidence_preference_json) = 'array'
  AND json_valid(NEW.dependencies_json)
  AND json_type(NEW.dependencies_json) = 'array'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid required_items JSON');
END;

CREATE TRIGGER information_items_json_insert_guard
BEFORE INSERT ON information_items
WHEN NOT (
  (NEW.value_json IS NULL OR json_valid(NEW.value_json))
  AND json_valid(NEW.evidence_ids_json)
  AND json_type(NEW.evidence_ids_json) = 'array'
  AND (NEW.prefill_json IS NULL OR (json_valid(NEW.prefill_json) AND json_type(NEW.prefill_json) = 'object'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid information_items JSON');
END;

CREATE TRIGGER information_items_json_update_guard
BEFORE UPDATE OF value_json, evidence_ids_json, prefill_json ON information_items
WHEN NOT (
  (NEW.value_json IS NULL OR json_valid(NEW.value_json))
  AND json_valid(NEW.evidence_ids_json)
  AND json_type(NEW.evidence_ids_json) = 'array'
  AND (NEW.prefill_json IS NULL OR (json_valid(NEW.prefill_json) AND json_type(NEW.prefill_json) = 'object'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid information_items JSON');
END;

CREATE TRIGGER evidence_refs_json_insert_guard
BEFORE INSERT ON evidence_refs
WHEN NOT (json_valid(NEW.metadata_json) AND json_type(NEW.metadata_json) = 'object')
BEGIN
  SELECT RAISE(ABORT, 'invalid evidence_refs JSON');
END;

CREATE TRIGGER information_events_json_insert_guard
BEFORE INSERT ON information_events
WHEN NOT (json_valid(NEW.payload_json) AND json_type(NEW.payload_json) = 'object')
BEGIN
  SELECT RAISE(ABORT, 'invalid information_events JSON');
END;

CREATE TRIGGER evaluations_json_insert_guard
BEFORE INSERT ON evaluations
WHEN NOT (json_valid(NEW.evaluation_json) AND json_type(NEW.evaluation_json) = 'object')
BEGIN
  SELECT RAISE(ABORT, 'invalid evaluations JSON');
END;

CREATE TRIGGER audit_events_json_insert_guard
BEFORE INSERT ON audit_events
WHEN NOT (json_valid(NEW.payload_json) AND json_type(NEW.payload_json) = 'object')
BEGIN
  SELECT RAISE(ABORT, 'invalid audit_events JSON');
END;

PRAGMA user_version = 2;
