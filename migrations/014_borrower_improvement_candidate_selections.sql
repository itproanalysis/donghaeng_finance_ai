PRAGMA foreign_keys = ON;

-- A borrower may pick one non-binding next-step card while finalizing. Keep
-- this preference outside canonical values, goals, features and evaluations so
-- it can never become a credit/approval/data-quality input by accidental join.
CREATE TABLE borrower_improvement_candidate_selections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  final_snapshot_id TEXT NOT NULL REFERENCES final_snapshots(id),
  event_type TEXT NOT NULL
    CHECK (event_type = 'BORROWER_SELECTED_IMPROVEMENT_CANDIDATE'),
  choice_kind TEXT NOT NULL CHECK (choice_kind IN ('CANDIDATE', 'SKIP')),
  candidate_id TEXT,
  candidate_title TEXT,
  candidate_origin TEXT CHECK (
    candidate_origin IS NULL OR candidate_origin IN (
      'CONFIRMED_GOAL', 'CONFIRMED_ANSWER', 'CATALOG_SUGGESTION'
    )
  ),
  source_info_codes_json TEXT NOT NULL DEFAULT '[]'
    CHECK (
      json_valid(source_info_codes_json) AND
      json_type(source_info_codes_json) = 'array'
    ),
  evidence_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (
      json_valid(evidence_ids_json) AND
      json_type(evidence_ids_json) = 'array'
    ),
  live_version INTEGER NOT NULL CHECK (live_version >= 1),
  client_command_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, interview_id) REFERENCES interviews(tenant_id, id),
  UNIQUE (tenant_id, interview_id),
  UNIQUE (tenant_id, interview_id, client_command_id),
  CHECK (
    (
      choice_kind = 'SKIP' AND
      candidate_id IS NULL AND
      candidate_title IS NULL AND
      candidate_origin IS NULL AND
      json_array_length(source_info_codes_json) = 0 AND
      json_array_length(evidence_ids_json) = 0
    ) OR (
      choice_kind = 'CANDIDATE' AND
      candidate_id IS NOT NULL AND length(candidate_id) BETWEEN 1 AND 160 AND
      candidate_title IS NOT NULL AND length(candidate_title) BETWEEN 1 AND 300 AND
      candidate_origin IS NOT NULL
    )
  )
);

CREATE INDEX idx_borrower_improvement_selection_final
  ON borrower_improvement_candidate_selections(tenant_id, final_snapshot_id);

CREATE TRIGGER borrower_improvement_selection_final_guard
BEFORE INSERT ON borrower_improvement_candidate_selections
WHEN NOT EXISTS (
  SELECT 1
  FROM final_snapshots f
  WHERE f.id = NEW.final_snapshot_id
    AND f.interview_id = NEW.interview_id
)
BEGIN
  SELECT RAISE(ABORT, 'improvement selection FINAL mismatch');
END;

CREATE TRIGGER borrower_improvement_selections_are_immutable_update
BEFORE UPDATE ON borrower_improvement_candidate_selections
BEGIN
  SELECT RAISE(ABORT, 'borrower improvement selection is immutable');
END;

CREATE TRIGGER borrower_improvement_selections_are_immutable_delete
BEFORE DELETE ON borrower_improvement_candidate_selections
BEGIN
  SELECT RAISE(ABORT, 'borrower improvement selection is immutable');
END;

PRAGMA user_version = 14;
