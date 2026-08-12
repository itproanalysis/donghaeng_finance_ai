PRAGMA foreign_keys = ON;

CREATE TABLE cb_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  borrower_id TEXT NOT NULL REFERENCES borrowers(id),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
    CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, borrower_id, source, observed_at)
);

CREATE INDEX idx_cb_snapshots_borrower_observed
  ON cb_snapshots(tenant_id, borrower_id, observed_at DESC);

CREATE TABLE live_features (
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  feature_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'COMPUTED', 'MISSING', 'UNKNOWN', 'REFUSED', 'NOT_APPLICABLE',
    'CONFLICTING', 'NOT_CALCULABLE'
  )),
  snapshot_type TEXT NOT NULL DEFAULT 'PREVIEW' CHECK (snapshot_type = 'PREVIEW'),
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version >= 1),
  registry_version TEXT NOT NULL,
  raw_value_json TEXT,
  normalized_value_json TEXT,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(evidence_ids_json) AND json_type(evidence_ids_json) = 'array'),
  calculation_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(calculation_json) AND json_type(calculation_json) = 'object'),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, interview_id, feature_code),
  FOREIGN KEY (tenant_id, interview_id) REFERENCES interviews(tenant_id, id),
  CHECK (raw_value_json IS NULL OR json_valid(raw_value_json)),
  CHECK (normalized_value_json IS NULL OR json_valid(normalized_value_json))
);

CREATE INDEX idx_live_features_interview_status
  ON live_features(tenant_id, interview_id, status);

CREATE TABLE evaluation_pillars (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
  pillar_code TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  result_json TEXT NOT NULL
    CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, interview_id) REFERENCES interviews(tenant_id, id),
  UNIQUE (tenant_id, evaluation_id, pillar_code)
);

CREATE TABLE evaluation_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
  pillar_id TEXT REFERENCES evaluation_pillars(id),
  item_code TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  result_json TEXT NOT NULL
    CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
  evidence_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(evidence_ids_json) AND json_type(evidence_ids_json) = 'array'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, interview_id) REFERENCES interviews(tenant_id, id),
  UNIQUE (tenant_id, evaluation_id, item_code)
);

CREATE TABLE evaluation_goals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
  goal_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'UNRESOLVED', 'SUGGESTED', 'BORROWER_STATED', 'BORROWER_CONFIRMED'
  )),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  goal_json TEXT NOT NULL
    CHECK (json_valid(goal_json) AND json_type(goal_json) = 'object'),
  evidence_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(evidence_ids_json) AND json_type(evidence_ids_json) = 'array'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, interview_id) REFERENCES interviews(tenant_id, id),
  UNIQUE (tenant_id, evaluation_id, goal_code)
);

CREATE INDEX idx_evaluation_pillars_evaluation
  ON evaluation_pillars(tenant_id, evaluation_id, ordinal);
CREATE INDEX idx_evaluation_items_evaluation
  ON evaluation_items(tenant_id, evaluation_id, ordinal);
CREATE INDEX idx_evaluation_goals_evaluation
  ON evaluation_goals(tenant_id, evaluation_id, ordinal);

PRAGMA user_version = 3;
