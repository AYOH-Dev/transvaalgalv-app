BEGIN;

-- Track the last POD-status value we successfully pushed to the Documents
-- cabinet, so the worker can skip no-op pushes and the service can detect
-- a change worth enqueuing.
--
-- Day-forward only: existing receipts get '' and will not be back-filled.
-- Their next line state change re-computes and pushes the correct value.

ALTER TABLE receipts
    ADD COLUMN IF NOT EXISTS docuware_pod_status         TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS docuware_pod_status_synced_at TIMESTAMPTZ;

-- Queue table for POD-status updates targeted at the Documents cabinet.
-- Separate from docuware_sync_queue (line updates, different cabinet).
CREATE TABLE IF NOT EXISTS docuware_pod_status_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id      UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    desired_status  TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    attempt_count   INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 6,
    last_error      TEXT NOT NULL DEFAULT '',
    next_retry_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Worker picks pending/in-progress; partial index keeps it small.
CREATE INDEX IF NOT EXISTS idx_pod_status_queue_pending
    ON docuware_pod_status_queue(status, next_retry_at)
    WHERE status IN ('pending', 'in_progress');

-- One pending update per receipt at a time. If a newer change lands while
-- one is queued, we update the existing row's desired_status rather than
-- inserting a duplicate (handled in the enqueue function).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pod_status_queue_one_pending
    ON docuware_pod_status_queue(receipt_id)
    WHERE status IN ('pending', 'in_progress');

COMMIT;
