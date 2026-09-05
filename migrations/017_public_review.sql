CREATE TABLE public_review_usage (
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  period TEXT NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 0),
  PRIMARY KEY(scope, kind, period)
);

CREATE TABLE public_review_calls (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  interview_id TEXT NOT NULL,
  provider_call_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  deadline TEXT NOT NULL,
  ended_at TEXT,
  CHECK (provider_call_id IS NULL OR length(provider_call_id) < 256)
);
CREATE INDEX public_review_calls_due ON public_review_calls(ended_at, deadline);
