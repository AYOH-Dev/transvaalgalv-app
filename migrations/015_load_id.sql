-- Add load_id: a stable, immutable identifier for the physical load (truck delivery).
-- Set once at receipt creation from the initial weighbridge ticket number.
-- Multiple receipts (delivery notes) from the same truck share the same load_id,
-- enabling the Yard UI to group them into one combined view for receivers.
-- The weighbridge_ticket_number on a receipt CAN be updated later (per-product
-- ticket assignment), but load_id never changes so grouping remains stable.

ALTER TABLE receipts ADD COLUMN load_id TEXT;

CREATE INDEX idx_receipts_load_id ON receipts (load_id) WHERE load_id IS NOT NULL;

-- Backfill existing receipts: group by their weighbridge ticket number.
UPDATE receipts
SET load_id = weighbridge_ticket_number
WHERE weighbridge_ticket_number IS NOT NULL AND weighbridge_ticket_number != '';
