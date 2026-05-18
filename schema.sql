-- D1 schema for the brain4machinery.com contact-form submissions table.
-- Apply with:
--   npx wrangler d1 execute brain4machinery-contact --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  message TEXT NOT NULL,
  ip TEXT,
  country TEXT,
  user_agent TEXT,
  turnstile_passed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new', -- new | spam | replied | crm_pushed
  resend_id TEXT,
  crm_contact_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
