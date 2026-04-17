BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE receipt_status AS ENUM (
	'draft',
	'received',
	'quality_hold',
	'matched',
	'archived'
);

CREATE TYPE document_source AS ENUM (
	'upload',
	'docuware'
);

CREATE TYPE receipt_exception_type AS ENUM (
	'quantity_mismatch',
	'quality_issue',
	'document_gap',
	'reference_mismatch',
	'other'
);

CREATE TYPE app_user_role AS ENUM (
	'admin',
	'operations_lead',
	'receiver',
	'reviewer',
	'viewer'
);

CREATE TABLE app_users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	email TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	display_name TEXT NOT NULL,
	role app_user_role NOT NULL DEFAULT 'viewer',
	is_active BOOLEAN NOT NULL DEFAULT true,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE receipts (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	receipt_number TEXT NOT NULL UNIQUE,
	supplier_name TEXT NOT NULL,
	supplier_reference TEXT NOT NULL DEFAULT '',
	purchase_order_number TEXT NOT NULL DEFAULT '',
	delivery_note_number TEXT NOT NULL DEFAULT '',
	received_at TIMESTAMPTZ NOT NULL,
	received_by UUID REFERENCES app_users(id),
	status receipt_status NOT NULL DEFAULT 'draft',
	notes TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE receipt_lines (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
	line_number INTEGER NOT NULL,
	item_code TEXT NOT NULL,
	description TEXT NOT NULL,
	expected_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0,
	received_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0,
	unit_of_measure TEXT NOT NULL DEFAULT '',
	condition_notes TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE (receipt_id, line_number)
);

CREATE TABLE receipt_documents (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
	document_type TEXT NOT NULL,
	filename TEXT NOT NULL,
	content_type TEXT NOT NULL,
	storage_key TEXT NOT NULL,
	source document_source NOT NULL DEFAULT 'upload',
	docuware_document_id TEXT NOT NULL DEFAULT '',
	docuware_status TEXT NOT NULL DEFAULT 'pending',
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE receipt_exceptions (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
	receipt_line_id UUID REFERENCES receipt_lines(id) ON DELETE SET NULL,
	exception_type receipt_exception_type NOT NULL,
	summary TEXT NOT NULL,
	details TEXT NOT NULL DEFAULT '',
	is_resolved BOOLEAN NOT NULL DEFAULT false,
	resolved_at TIMESTAMPTZ,
	resolved_by UUID REFERENCES app_users(id),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE docuware_upload_jobs (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	receipt_document_id UUID NOT NULL REFERENCES receipt_documents(id) ON DELETE CASCADE,
	attempt_count INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL DEFAULT 'pending',
	last_error TEXT NOT NULL DEFAULT '',
	next_attempt_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_receipts_status ON receipts(status);
CREATE INDEX idx_receipts_received_at ON receipts(received_at DESC);
CREATE INDEX idx_receipt_lines_receipt_id ON receipt_lines(receipt_id);
CREATE INDEX idx_receipt_documents_receipt_id ON receipt_documents(receipt_id);
CREATE INDEX idx_receipt_documents_docuware_status ON receipt_documents(docuware_status);
CREATE INDEX idx_receipt_exceptions_receipt_id ON receipt_exceptions(receipt_id);
CREATE INDEX idx_docuware_upload_jobs_status_next_attempt ON docuware_upload_jobs(status, next_attempt_at);

COMMIT;
