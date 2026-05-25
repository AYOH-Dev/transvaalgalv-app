-- 014_receipt_lines_job_number.sql
--
-- Per-line job_number on receipt_lines.
--
-- A single delivery can legitimately carry items from multiple jobs (e.g.
-- Structa POD M23633: lines 1–11 = 103142, line 12 = 103442, lines 13–16 =
-- 103445). Previously job_number was only a receipt-level column, which
-- flattened that detail. The receipt-level value is kept as a "set all"
-- shortcut: when the header job_number is updated it cascades to every
-- line (handled in the repository); bulk action can then override
-- specific lines.
--
-- Backfill order:
--   1. DocuWare imported lines — pull JOB_NUMBER out of the per-line
--      docuware_source_payload JSON (where DocuWare actually puts it).
--   2. Manual POD lines — pull job_number from the per-line payload
--      written by the CreateGRN flow.
--   3. Fallback — copy the receipt's header job_number.

ALTER TABLE receipt_lines
    ADD COLUMN job_number TEXT NOT NULL DEFAULT '';

UPDATE receipt_lines rl
SET job_number = COALESCE(
        NULLIF(rl.docuware_source_payload->>'JOB_NUMBER', ''),
        NULLIF(rl.docuware_source_payload->>'job_number', ''),
        r.job_number,
        ''
    )
FROM receipts r
WHERE r.id = rl.receipt_id;
