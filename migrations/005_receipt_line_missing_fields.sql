BEGIN;

ALTER TABLE receipt_lines
	ADD COLUMN internal_description      TEXT NOT NULL DEFAULT '',
	ADD COLUMN comments                  TEXT NOT NULL DEFAULT '',
	ADD COLUMN required_galv_thickness   TEXT NOT NULL DEFAULT '';

COMMIT;
