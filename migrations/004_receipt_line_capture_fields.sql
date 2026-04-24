BEGIN;

ALTER TABLE receipt_lines
	ADD COLUMN item_type          TEXT NOT NULL DEFAULT '',
	ADD COLUMN packaging_method   TEXT NOT NULL DEFAULT '',
	ADD COLUMN accessories        TEXT NOT NULL DEFAULT '';

COMMIT;
