BEGIN;

-- Speed up the auto-archive scan: every poll cycle the worker queries
-- "receipts with status='matched' that haven't been touched in N days".
-- A partial index keeps the index tiny — only ever-matched rows.
CREATE INDEX IF NOT EXISTS idx_receipts_matched_for_archive
    ON receipts(updated_at)
    WHERE status = 'matched';

COMMIT;
