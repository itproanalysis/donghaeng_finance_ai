PRAGMA foreign_keys = ON;

-- SQLite CHECK constraints are immutable, so rebuild the outbox to add the
-- durable transcript.finalized event emitted before derived turn events.
CREATE TABLE outbox_events_v9 (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version >= 1),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'transcript.finalized',
    'info.status_changed',
    'info.value_changed',
    'coverage.changed',
    'feature.preview_updated',
    'summary.preview_updated',
    'question.generated',
    'conflict.detected',
    'ready_to_complete',
    'interview.completed',
    'transcript.corrected'
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

INSERT INTO outbox_events_v9(
  event_id, tenant_id, interview_id, sequence, aggregate_version,
  event_type, turn_id, batch_index, batch_size, event_json,
  created_at, expires_at
)
SELECT
  event_id, tenant_id, interview_id, sequence, aggregate_version,
  event_type, turn_id, batch_index, batch_size, event_json,
  created_at, expires_at
FROM outbox_events;

DROP TRIGGER outbox_events_are_immutable_update;
DROP TABLE outbox_events;
ALTER TABLE outbox_events_v9 RENAME TO outbox_events;

CREATE INDEX idx_outbox_replay
  ON outbox_events(tenant_id, interview_id, sequence);
CREATE INDEX idx_outbox_retention
  ON outbox_events(expires_at);

CREATE TRIGGER outbox_events_are_immutable_update
BEFORE UPDATE ON outbox_events
BEGIN
  SELECT RAISE(ABORT, 'outbox event is immutable');
END;

PRAGMA user_version = 9;
