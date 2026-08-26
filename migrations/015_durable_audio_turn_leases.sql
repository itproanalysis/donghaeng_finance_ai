PRAGMA foreign_keys = ON;

-- Active voice turns must be visible to every application instance before a
-- FINAL snapshot can be committed. Leases are bounded so a crashed WebSocket
-- worker cannot block an interview forever.
CREATE TABLE audio_turn_leases (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  interview_id TEXT NOT NULL,
  audio_session_id TEXT NOT NULL CHECK (
    length(audio_session_id) BETWEEN 1 AND 128
  ),
  owner_token TEXT NOT NULL CHECK (length(owner_token) BETWEEN 1 AND 160),
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'FINAL_TRANSCRIPT_PENDING')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, interview_id, audio_session_id),
  FOREIGN KEY (tenant_id, interview_id)
    REFERENCES interviews(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_audio_turn_leases_completion_gate
  ON audio_turn_leases(tenant_id, interview_id, expires_at, state);

CREATE TRIGGER audio_turn_leases_identity_immutable
BEFORE UPDATE OF tenant_id, interview_id, audio_session_id ON audio_turn_leases
BEGIN
  SELECT RAISE(ABORT, 'audio turn lease identity is immutable');
END;

PRAGMA user_version = 15;
