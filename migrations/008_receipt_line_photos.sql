BEGIN;

-- Phase 1 of "mandatory defect photos" (Tier 1 #4 in docs/ENHANCEMENTS.md).
-- Allows attaching a photo to a specific receipt_line and tagging the document
-- by category. Captures land on the backend filesystem first, then the
-- DocuWare worker pushes them as a Section on the line's Receiving Data doc.
--
-- The 'capture' source distinguishes app-captured uploads from upstream
-- DocuWare-supplied documents and from generic 'upload' documents.

ALTER TYPE document_source ADD VALUE IF NOT EXISTS 'capture';

ALTER TABLE receipt_documents
    ADD COLUMN IF NOT EXISTS receipt_line_id UUID REFERENCES receipt_lines(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS category        TEXT   NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS file_size       BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS docuware_error  TEXT   NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS attempt_count   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_retry_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS uploaded_by     UUID REFERENCES app_users(id);

-- Enforce: at most one defect photo per receipt line.
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_documents_one_defect_photo_per_line
    ON receipt_documents(receipt_line_id)
    WHERE category = 'defect_photo' AND receipt_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receipt_documents_line_id
    ON receipt_documents(receipt_line_id)
    WHERE receipt_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receipt_documents_pending_pushes
    ON receipt_documents(docuware_status, next_retry_at)
    WHERE docuware_status IN ('pending', 'in_progress') AND category <> '';

COMMIT;
