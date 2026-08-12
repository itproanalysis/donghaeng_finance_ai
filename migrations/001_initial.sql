PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS borrowers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_profiles (
  id TEXT PRIMARY KEY,
  borrower_id TEXT NOT NULL REFERENCES borrowers(id),
  business_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  borrower_id TEXT NOT NULL REFERENCES borrowers(id),
  business_profile_id TEXT NOT NULL REFERENCES business_profiles(id),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('ACTIVE', 'COMPLETE', 'INCOMPLETE')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  current_question_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS required_items (
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  info_code TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('CURRENT_STATE', 'IMPROVEMENT_INTENT', 'FUTURE_OUTLOOK', 'HOUSEHOLD_STATE')),
  priority TEXT NOT NULL CHECK (priority IN ('P0', 'P1', 'P2')),
  expected_type TEXT NOT NULL CHECK (expected_type IN ('AMOUNT', 'RATIO', 'INTEGER', 'TEXT', 'BOOLEAN', 'DATE', 'DURATION', 'RANGE')),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  min_quality TEXT NOT NULL CHECK (min_quality IN ('LOW', 'MEDIUM', 'HIGH')),
  evidence_preference_json TEXT NOT NULL,
  dependencies_json TEXT NOT NULL,
  question TEXT NOT NULL,
  followup_question TEXT,
  PRIMARY KEY (interview_id, info_code)
);

CREATE TABLE IF NOT EXISTS information_items (
  interview_id TEXT NOT NULL,
  info_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('NEEDED', 'ASKING', 'COLLECTED', 'CONFIRMED', 'NEEDS_FOLLOWUP', 'CONFLICT', 'UNAVAILABLE', 'REFUSED', 'NOT_APPLICABLE')),
  value_state TEXT NOT NULL CHECK (value_state IN ('PRESENT', 'MISSING', 'UNKNOWN', 'REFUSED', 'NOT_APPLICABLE')),
  value_json TEXT,
  quality TEXT CHECK (quality IS NULL OR quality IN ('LOW', 'MEDIUM', 'HIGH')),
  extraction_confidence REAL CHECK (extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1)),
  verification TEXT CHECK (verification IS NULL OR verification IN ('SELF_REPORTED', 'DOCUMENT_SUPPORTED', 'TRANSACTION_SUPPORTED', 'SYSTEM_DERIVED', 'CONFLICTING', 'UNKNOWN')),
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  prefill_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (interview_id, info_code),
  FOREIGN KEY (interview_id, info_code) REFERENCES required_items(interview_id, info_code)
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  sequence INTEGER NOT NULL,
  speaker TEXT NOT NULL CHECK (speaker IN ('ASSISTANT', 'BORROWER')),
  text TEXT NOT NULL,
  confirmation TEXT NOT NULL CHECK (confirmation = 'FINAL'),
  created_at TEXT NOT NULL,
  UNIQUE (interview_id, sequence)
);

CREATE TABLE IF NOT EXISTS evidence_refs (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  info_code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('SELF_REPORTED', 'DOCUMENT_SUPPORTED', 'TRANSACTION_SUPPORTED', 'SYSTEM_DERIVED', 'CONFLICTING', 'UNKNOWN')),
  source TEXT NOT NULL,
  transcript_segment_id TEXT REFERENCES transcript_segments(id),
  excerpt TEXT,
  observed_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (interview_id, info_code) REFERENCES required_items(interview_id, info_code)
);

CREATE TABLE IF NOT EXISTS information_events (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  info_code TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('STATUS_CHANGED', 'STATUS_CHANGE_REJECTED', 'VALUE_CHANGED', 'CORRECTION')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (interview_id, sequence),
  FOREIGN KEY (interview_id, info_code) REFERENCES required_items(interview_id, info_code)
);

CREATE TABLE IF NOT EXISTS final_snapshots (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL UNIQUE REFERENCES interviews(id),
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL UNIQUE REFERENCES interviews(id),
  final_snapshot_id TEXT NOT NULL UNIQUE REFERENCES final_snapshots(id),
  snapshot_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'GENERATING', 'READY', 'FAILED')),
  evaluation_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transcript_interview_sequence
  ON transcript_segments(interview_id, sequence);
CREATE INDEX IF NOT EXISTS idx_evidence_interview_info
  ON evidence_refs(interview_id, info_code);
CREATE INDEX IF NOT EXISTS idx_information_events_interview_sequence
  ON information_events(interview_id, sequence);
CREATE INDEX IF NOT EXISTS idx_required_items_interview_priority
  ON required_items(interview_id, priority, ordinal);

CREATE TRIGGER IF NOT EXISTS final_snapshots_are_immutable_update
BEFORE UPDATE ON final_snapshots
BEGIN
  SELECT RAISE(ABORT, 'FINAL snapshot is immutable');
END;

CREATE TRIGGER IF NOT EXISTS final_snapshots_are_immutable_delete
BEFORE DELETE ON final_snapshots
BEGIN
  SELECT RAISE(ABORT, 'FINAL snapshot is immutable');
END;

PRAGMA user_version = 1;
