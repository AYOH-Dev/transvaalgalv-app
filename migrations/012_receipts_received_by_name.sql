-- 012_receipts_received_by_name.sql
--
-- Snapshot the receiver's display_name onto the receipt at creation time so
-- the historical record is immutable to subsequent profile edits. The DocuWare
-- RECEIVED_BY push reads this snapshot directly instead of joining app_users
-- at sync time, which would otherwise let a name change retroactively rewrite
-- every past receipt's accountability field.

ALTER TABLE receipts
    ADD COLUMN received_by_name TEXT NOT NULL DEFAULT '';
