BEGIN;

-- Add sync tracking columns to receipt_lines (some already exist from previous migrations)
-- This migration ensures the full sync state is in place.

ALTER TABLE receipt_lines
ADD COLUMN IF NOT EXISTS docuware_sync_error TEXT NOT NULL DEFAULT '';

-- Create a sync queue table for queuing line updates with retry logic.
-- Trigger: when a receipt_line's receiving_status changes to 'received' or status moves to 'matched'.
CREATE TABLE IF NOT EXISTS docuware_sync_queue (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
	receipt_line_id UUID NOT NULL REFERENCES receipt_lines(id) ON DELETE CASCADE,
	status TEXT NOT NULL DEFAULT 'pending',
	attempt_count INTEGER NOT NULL DEFAULT 0,
	max_attempts INTEGER NOT NULL DEFAULT 5,
	last_error TEXT NOT NULL DEFAULT '',
	next_retry_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index for pending/in-progress syncs needing retry
CREATE INDEX idx_docuware_sync_queue_status_next_retry
	ON docuware_sync_queue(status, next_retry_at)
	WHERE status IN ('pending', 'in_progress');

-- Lookup by line to prevent duplicate queue entries
CREATE UNIQUE INDEX idx_docuware_sync_queue_line_pending
	ON docuware_sync_queue(receipt_line_id, status)
	WHERE status IN ('pending', 'in_progress');

CREATE INDEX idx_docuware_sync_queue_receipt_line_id
	ON docuware_sync_queue(receipt_line_id);

CREATE INDEX idx_docuware_sync_queue_receipt_id
	ON docuware_sync_queue(receipt_id);

COMMIT;
