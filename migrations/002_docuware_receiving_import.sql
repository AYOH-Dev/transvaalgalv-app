BEGIN;

ALTER TABLE receipts
	ADD COLUMN source_docuware_document_id TEXT NOT NULL DEFAULT '',
	ADD COLUMN source_docuware_cabinet_id TEXT NOT NULL DEFAULT '',
	ADD COLUMN docuware_record_id TEXT NOT NULL DEFAULT '',
	ADD COLUMN docuware_group_reference TEXT NOT NULL DEFAULT '',
	ADD COLUMN imported_at TIMESTAMPTZ,
	ADD COLUMN last_synced_at TIMESTAMPTZ,
	ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending',
	ADD COLUMN docuware_source_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE receipt_lines
	ADD COLUMN docuware_record_line_id TEXT NOT NULL DEFAULT '',
	ADD COLUMN docuware_unique_number TEXT NOT NULL DEFAULT '',
	ADD COLUMN docuware_primary_key TEXT NOT NULL DEFAULT '',
	ADD COLUMN last_synced_at TIMESTAMPTZ,
	ADD COLUMN docuware_source_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX idx_receipts_docuware_group_reference_unique
	ON receipts(docuware_group_reference)
	WHERE docuware_group_reference <> '';

CREATE UNIQUE INDEX idx_receipt_lines_docuware_record_line_id_unique
	ON receipt_lines(docuware_record_line_id)
	WHERE docuware_record_line_id <> '';

CREATE INDEX idx_receipts_sync_status ON receipts(sync_status);
CREATE INDEX idx_receipts_docuware_record_id ON receipts(docuware_record_id);
CREATE INDEX idx_receipt_lines_docuware_unique_number ON receipt_lines(docuware_unique_number);

COMMIT;