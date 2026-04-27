BEGIN;

-- Phase 2: GRN PDF generation + push to DocuWare Documents cabinet.
-- One GRN doc per receipt, generated when the receipt transitions to
-- 'matched'. Idempotent: if grn_document_id is already set, skip.

ALTER TABLE receipts
    ADD COLUMN IF NOT EXISTS grn_document_id     UUID REFERENCES receipt_documents(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS grn_generated_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS grn_docuware_doc_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_receipts_grn_pending
    ON receipts(status, grn_document_id)
    WHERE grn_document_id IS NULL;

COMMIT;
