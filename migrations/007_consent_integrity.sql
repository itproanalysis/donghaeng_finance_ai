PRAGMA foreign_keys = ON;

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

PRAGMA user_version = 7;
