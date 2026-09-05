-- Working notes are separate from immutable interview/evaluation evidence.
CREATE TABLE consultation_drafts (
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  draft_json TEXT NOT NULL CHECK (json_valid(draft_json) AND json_type(draft_json) = 'object'),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, interview_id),
  FOREIGN KEY (tenant_id, interview_id) REFERENCES interviews(tenant_id, id),
  FOREIGN KEY (tenant_id, updated_by) REFERENCES users(tenant_id, id)
);

CREATE INDEX idx_interviews_tenant_updated_id ON interviews(tenant_id, updated_at DESC, id DESC);
PRAGMA user_version = 16;
