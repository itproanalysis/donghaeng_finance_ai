PRAGMA foreign_keys = ON;

-- Anthropic receives the FINAL transcript and current information state only
-- after an explicit, versioned CLOUD_AI_PROCESSING decision. Preserve the
-- append-only decision history while extending the closed purpose enum.
DROP TRIGGER IF EXISTS consent_records_tenant_insert_guard;
DROP TRIGGER IF EXISTS consent_records_are_immutable_update;
DROP TRIGGER IF EXISTS consent_records_are_immutable_delete;
DROP INDEX IF EXISTS idx_consent_latest;

ALTER TABLE consent_records RENAME TO consent_records_before_cloud_ai;

CREATE TABLE consent_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  interview_id TEXT,
  purpose TEXT NOT NULL CHECK (
    purpose IN ('MICROPHONE_INTERVIEW', 'RAW_AUDIO_STORAGE', 'CLOUD_AI_PROCESSING')
  ),
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

INSERT INTO consent_records(
  id, tenant_id, user_id, interview_id, purpose, consent_version,
  granted, granted_at, revoked_at, expires_at, metadata_json
)
SELECT
  id, tenant_id, user_id, interview_id, purpose, consent_version,
  granted, granted_at, revoked_at, expires_at, metadata_json
FROM consent_records_before_cloud_ai;

DROP TABLE consent_records_before_cloud_ai;

CREATE INDEX idx_consent_latest
  ON consent_records(tenant_id, user_id, interview_id, purpose, granted_at DESC);

CREATE TRIGGER consent_records_tenant_insert_guard
BEFORE INSERT ON consent_records
WHEN NEW.interview_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM interviews i
  JOIN users u ON u.tenant_id = i.tenant_id AND u.id = NEW.user_id
  WHERE i.id = NEW.interview_id
    AND i.tenant_id = NEW.tenant_id
    AND u.active = 1
)
BEGIN
  SELECT RAISE(ABORT, 'consent tenant or user mismatch');
END;

CREATE TRIGGER consent_records_are_immutable_update
BEFORE UPDATE ON consent_records
BEGIN
  SELECT RAISE(ABORT, 'consent decision history is immutable');
END;

CREATE TRIGGER consent_records_are_immutable_delete
BEFORE DELETE ON consent_records
BEGIN
  SELECT RAISE(ABORT, 'consent decision history is immutable');
END;

PRAGMA user_version = 12;

