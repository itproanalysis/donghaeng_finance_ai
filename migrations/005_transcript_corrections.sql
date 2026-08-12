PRAGMA foreign_keys = ON;

ALTER TABLE transcript_segments
  ADD COLUMN start_ms INTEGER
    CHECK (start_ms IS NULL OR start_ms >= 0);
ALTER TABLE transcript_segments
  ADD COLUMN end_ms INTEGER
    CHECK (end_ms IS NULL OR end_ms >= 0);
ALTER TABLE transcript_segments
  ADD COLUMN stt_confidence REAL
    CHECK (
      stt_confidence IS NULL
      OR (stt_confidence >= 0 AND stt_confidence <= 1)
    );
ALTER TABLE transcript_segments
  ADD COLUMN raw_text TEXT;
ALTER TABLE transcript_segments
  ADD COLUMN corrected_text TEXT;
ALTER TABLE transcript_segments
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
    CHECK (revision >= 0);

-- Existing FINAL-only transcript rows predate raw_text. Their current text is
-- the original text because corrections did not exist before this migration.
UPDATE transcript_segments
SET raw_text = text
WHERE raw_text IS NULL;

CREATE UNIQUE INDEX idx_transcript_segments_interview_id
  ON transcript_segments(interview_id, id);

CREATE TRIGGER transcript_segments_populate_raw_text
AFTER INSERT ON transcript_segments
WHEN NEW.raw_text IS NULL
BEGIN
  UPDATE transcript_segments
  SET raw_text = NEW.text
  WHERE id = NEW.id;
END;

CREATE TRIGGER transcript_segments_original_text_is_immutable
BEFORE UPDATE OF raw_text ON transcript_segments
WHEN OLD.raw_text IS NOT NULL AND NEW.raw_text IS NOT OLD.raw_text
BEGIN
  SELECT RAISE(ABORT, 'transcript raw text is immutable');
END;

CREATE TRIGGER transcript_segments_final_confirmation_is_immutable
BEFORE UPDATE OF confirmation ON transcript_segments
WHEN NEW.confirmation <> 'FINAL' OR OLD.confirmation <> NEW.confirmation
BEGIN
  SELECT RAISE(ABORT, 'only FINAL transcript segments may be stored');
END;

CREATE TRIGGER transcript_segments_timing_insert_guard
BEFORE INSERT ON transcript_segments
WHEN NEW.start_ms IS NOT NULL
  AND NEW.end_ms IS NOT NULL
  AND NEW.end_ms < NEW.start_ms
BEGIN
  SELECT RAISE(ABORT, 'transcript end_ms must not precede start_ms');
END;

CREATE TRIGGER transcript_segments_timing_update_guard
BEFORE UPDATE OF start_ms, end_ms ON transcript_segments
WHEN NEW.start_ms IS NOT NULL
  AND NEW.end_ms IS NOT NULL
  AND NEW.end_ms < NEW.start_ms
BEGIN
  SELECT RAISE(ABORT, 'transcript end_ms must not precede start_ms');
END;

CREATE TABLE transcript_corrections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  client_correction_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  expected_version INTEGER NOT NULL CHECK (expected_version >= 1),
  resulting_version INTEGER NOT NULL CHECK (resulting_version = expected_version + 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  raw_text TEXT NOT NULL,
  previous_effective_text TEXT NOT NULL,
  corrected_text TEXT NOT NULL
    CHECK (length(trim(corrected_text)) BETWEEN 1 AND 5000),
  reason TEXT NOT NULL
    CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  response_json TEXT NOT NULL
    CHECK (json_valid(response_json) AND json_type(response_json) = 'object'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, interview_id) REFERENCES interviews(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (interview_id, segment_id)
    REFERENCES transcript_segments(interview_id, id),
  UNIQUE (tenant_id, interview_id, client_correction_id),
  UNIQUE (tenant_id, interview_id, segment_id, revision)
);

CREATE INDEX idx_transcript_corrections_segment_revision
  ON transcript_corrections(tenant_id, interview_id, segment_id, revision);

CREATE TRIGGER transcript_corrections_insert_guard
BEFORE INSERT ON transcript_corrections
WHEN NOT EXISTS (
  SELECT 1
  FROM transcript_segments s
  WHERE s.interview_id = NEW.interview_id
    AND s.id = NEW.segment_id
    AND s.confirmation = 'FINAL'
    AND s.revision = NEW.revision
    AND s.raw_text = NEW.raw_text
    AND s.text = NEW.corrected_text
    AND s.corrected_text = NEW.corrected_text
)
BEGIN
  SELECT RAISE(ABORT, 'correction does not match the FINAL transcript revision');
END;

CREATE TRIGGER transcript_corrections_are_immutable_update
BEFORE UPDATE ON transcript_corrections
BEGIN
  SELECT RAISE(ABORT, 'transcript correction history is immutable');
END;

CREATE TRIGGER transcript_corrections_are_immutable_delete
BEFORE DELETE ON transcript_corrections
BEGIN
  SELECT RAISE(ABORT, 'transcript correction history is immutable');
END;

-- SQLite cannot alter an existing CHECK constraint. Rebuild the transactional
-- outbox so transcript corrections use the same durable replay stream.
CREATE TABLE outbox_events_v5 (
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

INSERT INTO outbox_events_v5(
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
ALTER TABLE outbox_events_v5 RENAME TO outbox_events;

CREATE INDEX idx_outbox_replay
  ON outbox_events(tenant_id, interview_id, sequence);
CREATE INDEX idx_outbox_retention
  ON outbox_events(expires_at);

CREATE TRIGGER outbox_events_are_immutable_update
BEFORE UPDATE ON outbox_events
BEGIN
  SELECT RAISE(ABORT, 'outbox event is immutable');
END;

PRAGMA user_version = 5;
