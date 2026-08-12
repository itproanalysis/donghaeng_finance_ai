PRAGMA foreign_keys = ON;

CREATE TABLE canonical_information_records (
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  info_code TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version >= 1),
  record_json TEXT NOT NULL
    CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, interview_id, info_code),
  FOREIGN KEY (tenant_id, interview_id) REFERENCES interviews(tenant_id, id),
  FOREIGN KEY (interview_id, info_code) REFERENCES required_items(interview_id, info_code)
);

CREATE TABLE canonical_value_revisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  info_code TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  revision_json TEXT NOT NULL
    CHECK (json_valid(revision_json) AND json_type(revision_json) = 'object'),
  observed_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, interview_id) REFERENCES interviews(tenant_id, id),
  FOREIGN KEY (interview_id, info_code) REFERENCES required_items(interview_id, info_code),
  UNIQUE (tenant_id, interview_id, info_code, revision_number)
);

CREATE INDEX idx_canonical_revisions_interview_info
  ON canonical_value_revisions(tenant_id, interview_id, info_code, revision_number);

CREATE TRIGGER canonical_value_revisions_are_immutable_update
BEFORE UPDATE ON canonical_value_revisions
BEGIN
  SELECT RAISE(ABORT, 'canonical value revision is immutable');
END;

CREATE TRIGGER canonical_value_revisions_are_immutable_delete
BEFORE DELETE ON canonical_value_revisions
BEGIN
  SELECT RAISE(ABORT, 'canonical value revision is immutable');
END;

PRAGMA user_version = 4;
