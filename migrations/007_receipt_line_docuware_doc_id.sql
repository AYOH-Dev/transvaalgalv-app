-- Add per-line DocuWare document id (DWDOCID).
--
-- Each line in a POD corresponds to its own document in DocuWare. Previously
-- sync-back used the receipt's docuware_record_id for every line, so all 19
-- line updates for one POD were written to the same DocuWare doc, leaving
-- the other 18 docs untouched. This column stores each line's own DWDOCID,
-- so sync-back can target the correct document per line.

ALTER TABLE receipt_lines
    ADD COLUMN IF NOT EXISTS docuware_doc_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_receipt_lines_docuware_doc_id
    ON receipt_lines(docuware_doc_id)
    WHERE docuware_doc_id <> '';

-- Backfill from source payload for lines imported before this column existed.
UPDATE receipt_lines
SET docuware_doc_id = docuware_source_payload->>'DWDOCID'
WHERE docuware_doc_id = ''
  AND docuware_source_payload ? 'DWDOCID'
  AND docuware_source_payload->>'DWDOCID' <> '';
