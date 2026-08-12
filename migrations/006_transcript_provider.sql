PRAGMA foreign_keys = ON;

ALTER TABLE transcript_segments
  ADD COLUMN stt_provider TEXT
    CHECK (
      stt_provider IS NULL
      OR length(trim(stt_provider)) BETWEEN 1 AND 128
    );

PRAGMA user_version = 6;
