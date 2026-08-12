PRAGMA foreign_keys = ON;

CREATE TABLE canonical_value_conflicts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  info_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
  conflict_json TEXT NOT NULL
    CHECK (json_valid(conflict_json) AND json_type(conflict_json) = 'object'),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (tenant_id, interview_id) REFERENCES interviews(tenant_id, id),
  FOREIGN KEY (interview_id, info_code)
    REFERENCES required_items(interview_id, info_code)
);

CREATE UNIQUE INDEX idx_one_open_canonical_conflict
  ON canonical_value_conflicts(tenant_id, interview_id, info_code)
  WHERE status = 'OPEN';

CREATE INDEX idx_canonical_conflict_history
  ON canonical_value_conflicts(tenant_id, interview_id, info_code, created_at);

CREATE TRIGGER canonical_conflicts_insert_guard
BEFORE INSERT ON canonical_value_conflicts
WHEN NOT (
  NEW.status = 'OPEN'
  AND json_extract(NEW.conflict_json, '$.id') = NEW.id
  AND json_extract(NEW.conflict_json, '$.infoCode') = NEW.info_code
  AND json_extract(NEW.conflict_json, '$.status') = 'OPEN'
  AND json_array_length(NEW.conflict_json, '$.candidateRevisionIds') = 2
  AND NEW.resolved_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'invalid canonical conflict payload');
END;

CREATE TRIGGER canonical_conflicts_resolution_guard
BEFORE UPDATE ON canonical_value_conflicts
WHEN NOT (
  OLD.status = 'OPEN'
  AND NEW.status = 'RESOLVED'
  AND OLD.id = NEW.id
  AND OLD.tenant_id = NEW.tenant_id
  AND OLD.interview_id = NEW.interview_id
  AND OLD.info_code = NEW.info_code
  AND OLD.created_at = NEW.created_at
  AND NEW.resolved_at IS NOT NULL
  AND json_extract(NEW.conflict_json, '$.id') = NEW.id
  AND json_extract(NEW.conflict_json, '$.infoCode') = NEW.info_code
  AND json_extract(NEW.conflict_json, '$.status') = 'RESOLVED'
  AND json_type(NEW.conflict_json, '$.resolution') = 'object'
)
BEGIN
  SELECT RAISE(ABORT, 'canonical conflict may only transition OPEN to RESOLVED');
END;

CREATE TRIGGER canonical_conflicts_are_immutable_delete
BEFORE DELETE ON canonical_value_conflicts
BEGIN
  SELECT RAISE(ABORT, 'canonical conflict history is immutable');
END;

PRAGMA user_version = 8;
