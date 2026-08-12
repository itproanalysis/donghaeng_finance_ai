PRAGMA foreign_keys = ON;

-- A borrower FINAL transcript must be durable before an external turn planner is
-- called.  This table is deliberately free of transcript text and credentials:
-- the immutable transcript row is the source of truth and only safe provider
-- telemetry may be recorded here after processing finishes.
CREATE TABLE message_command_stages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  client_message_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  expected_version INTEGER NOT NULL CHECK (expected_version >= 1),
  current_question_code TEXT,
  transcript_segment_id TEXT NOT NULL UNIQUE REFERENCES transcript_segments(id),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPLIED', 'FAILED')),
  provider_metadata_json TEXT
    CHECK (
      provider_metadata_json IS NULL OR
      (json_valid(provider_metadata_json) AND json_type(provider_metadata_json) = 'object')
    ),
  failure_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (tenant_id, interview_id, client_message_id)
);

CREATE INDEX idx_message_command_stages_pending
  ON message_command_stages(status, created_at);
CREATE INDEX idx_message_command_stages_interview
  ON message_command_stages(tenant_id, interview_id, created_at DESC);

PRAGMA user_version = 11;
