PRAGMA foreign_keys = ON;

-- Preserve the exact, allow-listed transcript capture metadata needed to
-- reconstruct a retry after a browser or server restart. Transcript text stays
-- in transcript_segments; credentials, prompts, provider bodies, and raw
-- errors are never stored here.
ALTER TABLE message_command_stages
  ADD COLUMN transcript_metadata_json TEXT
    CHECK (
      transcript_metadata_json IS NULL OR
      (json_valid(transcript_metadata_json) AND json_type(transcript_metadata_json) = 'object')
    );

-- Cross-process provider deduplication. The token is an opaque server-only
-- claim and the bounded expiry permits crash recovery after the longest
-- configured Anthropic timeout.
ALTER TABLE message_command_stages
  ADD COLUMN processing_lease_token TEXT
    CHECK (
      processing_lease_token IS NULL OR
      length(processing_lease_token) BETWEEN 16 AND 128
    );

ALTER TABLE message_command_stages
  ADD COLUMN processing_lease_expires_at TEXT;

-- A stale legacy PENDING row must not permanently occupy the one-pending slot.
UPDATE message_command_stages
SET status = 'FAILED',
    failure_code = 'MESSAGE_STAGE_STALE',
    completed_at = COALESCE(completed_at, created_at)
WHERE status = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM interviews i
    WHERE i.tenant_id = message_command_stages.tenant_id
      AND i.id = message_command_stages.interview_id
      AND (
        i.lifecycle_status <> 'ACTIVE'
        OR i.version <> message_command_stages.expected_version
        OR NOT (i.current_question_code IS message_command_stages.current_question_code)
      )
  );

-- Older builds could stage more than one same-version command. Keep the first
-- durable transcript resumable and terminalize later contenders before adding
-- the cross-process invariant.
WITH ranked_pending AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, interview_id
           ORDER BY created_at ASC, id ASC
         ) AS pending_rank
  FROM message_command_stages
  WHERE status = 'PENDING'
)
UPDATE message_command_stages
SET status = 'FAILED',
    failure_code = 'MESSAGE_STAGE_SUPERSEDED',
    completed_at = COALESCE(completed_at, created_at)
WHERE id IN (
  SELECT id FROM ranked_pending WHERE pending_rank > 1
);

CREATE UNIQUE INDEX ux_message_command_stages_one_pending
  ON message_command_stages(tenant_id, interview_id)
  WHERE status = 'PENDING';

PRAGMA user_version = 13;
