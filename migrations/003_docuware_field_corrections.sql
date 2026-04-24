BEGIN;

-- Receipt header: operational fields from the real DocuWare payload
ALTER TABLE receipts
	ADD COLUMN customer_name           TEXT NOT NULL DEFAULT '',
	ADD COLUMN weighbridge_ticket_number TEXT NOT NULL DEFAULT '',
	ADD COLUMN vehicle_registration    TEXT NOT NULL DEFAULT '',
	ADD COLUMN job_number              TEXT NOT NULL DEFAULT '',
	ADD COLUMN docuware_doc_url        TEXT NOT NULL DEFAULT '';

-- Receipt lines: material and operational fields from the real DocuWare payload
ALTER TABLE receipt_lines
	ADD COLUMN material_code           TEXT NOT NULL DEFAULT '',
	ADD COLUMN material_description    TEXT NOT NULL DEFAULT '',
	ADD COLUMN material_size           TEXT NOT NULL DEFAULT '',
	ADD COLUMN material_markings       TEXT NOT NULL DEFAULT '',
	ADD COLUMN material_thickness      TEXT NOT NULL DEFAULT '',
	ADD COLUMN material_length         TEXT NOT NULL DEFAULT '',
	ADD COLUMN weight                  TEXT NOT NULL DEFAULT '',
	ADD COLUMN process                 TEXT NOT NULL DEFAULT '',
	ADD COLUMN stored_in               TEXT NOT NULL DEFAULT '',
	ADD COLUMN bay                     TEXT NOT NULL DEFAULT '',
	ADD COLUMN receiving_status        TEXT NOT NULL DEFAULT '',
	ADD COLUMN discrepancy             TEXT NOT NULL DEFAULT '',
	ADD COLUMN quantity_discrepancy    TEXT NOT NULL DEFAULT '';

-- Index the new header fields used in lookups
CREATE INDEX idx_receipts_weighbridge_ticket ON receipts(weighbridge_ticket_number) WHERE weighbridge_ticket_number <> '';
CREATE INDEX idx_receipts_customer_name ON receipts(customer_name) WHERE customer_name <> '';

COMMIT;
