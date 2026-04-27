-- 013_receipt_lines_received_by.sql
--
-- Per-line accountability: who confirmed receipt of this line.
--
-- The receipt-level received_by columns (added in 012) capture who created
-- the GRN shell. The line-level columns added here capture who actually
-- signed off on each line — these can differ across lines on the same
-- receipt (shift handovers, multi-receiver loads) and may differ from
-- the receipt creator (POD imported from DocuWare with no creator at all,
-- or a supervisor who made the shell while a yardman did the receiving).
--
-- received_by_name is snapshotted at confirm time so a later display_name
-- change cannot retroactively rewrite who signed for which line.

ALTER TABLE receipt_lines
    ADD COLUMN received_by UUID REFERENCES app_users(id),
    ADD COLUMN received_by_name TEXT NOT NULL DEFAULT '';
