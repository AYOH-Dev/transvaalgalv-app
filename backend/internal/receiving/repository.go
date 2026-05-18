package receiving

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepository struct {
	pool *pgxpool.Pool
}

type rowScanner interface {
	Scan(dest ...any) error
}

func NewRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// ListReceipts returns receipts in display order. Archived receipts are
// excluded by default; pass includeArchived=true (admin-only at the HTTP
// layer) to include them.
func (r *PostgresRepository) ListReceipts(ctx context.Context, includeArchived bool) ([]Receipt, error) {
	whereClause := "WHERE r.status != 'archived'"
	if includeArchived {
		whereClause = ""
	}
	// Line bodies are intentionally omitted from the list payload (loaded
	// lazily by GetReceipt). The card UI only needs a count, so a single
	// aggregate subquery keeps the list endpoint cheap.
	query := `
		SELECT r.id::text,
		       r.receipt_number,
		       r.supplier_name,
		       r.customer_name,
		       r.supplier_reference,
		       r.purchase_order_number,
		       r.delivery_note_number,
		       r.weighbridge_ticket_number,
		       r.vehicle_registration,
		       r.job_number,
		       r.source_docuware_document_id,
		       r.source_docuware_cabinet_id,
		       r.docuware_record_id,
		       r.docuware_group_reference,
		       r.docuware_doc_url,
		       r.received_at,
		       r.status::text,
		       r.sync_status,
		       r.notes,
		       COALESCE(r.grn_document_id::text, ''),
		       r.grn_docuware_doc_id,
		       r.grn_generated_at,
		       r.docuware_pod_status,
		       r.docuware_pod_status_synced_at,
		       r.imported_at,
		       r.last_synced_at,
		       r.created_at,
		       r.updated_at,
		       (SELECT COUNT(*) FROM receipt_lines rl WHERE rl.receipt_id = r.id) AS line_count
		FROM receipts r ` + whereClause + `
		ORDER BY r.received_at DESC, r.created_at DESC
	`
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list receipts: %w", err)
	}
	defer rows.Close()

	receipts := []Receipt{}
	for rows.Next() {
		receipt, err := scanReceiptWithLineCount(rows)
		if err != nil {
			return nil, fmt.Errorf("scan receipt: %w", err)
		}
		receipts = append(receipts, receipt)
	}

	return receipts, rows.Err()
}

// ArchiveStaleMatched bulk-transitions matched receipts older than the
// supplied threshold into the 'archived' status. Returns the count
// archived. Idempotent — re-running with the same threshold is a no-op
// for receipts already archived. Backed by idx_receipts_matched_for_archive.
func (r *PostgresRepository) ArchiveStaleMatched(ctx context.Context, olderThan time.Duration) (int64, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE receipts
		SET status = 'archived',
		    updated_at = NOW()
		WHERE status = 'matched'
		  AND updated_at < NOW() - $1::interval
	`, olderThan.String())
	if err != nil {
		return 0, fmt.Errorf("archive stale matched: %w", err)
	}
	return tag.RowsAffected(), nil
}

func (r *PostgresRepository) GetReceipt(ctx context.Context, id string) (Receipt, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id::text,
		       receipt_number,
		       supplier_name,
		       customer_name,
		       supplier_reference,
		       purchase_order_number,
		       delivery_note_number,
		       weighbridge_ticket_number,
		       vehicle_registration,
		       job_number,
		       source_docuware_document_id,
		       source_docuware_cabinet_id,
		       docuware_record_id,
		       docuware_group_reference,
		       docuware_doc_url,
		       received_at,
		       status::text,
		       sync_status,
		       notes,
		       COALESCE(grn_document_id::text, ''),
		       grn_docuware_doc_id,
		       grn_generated_at,
		       docuware_pod_status,
		       docuware_pod_status_synced_at,
		       imported_at,
		       last_synced_at,
		       created_at,
		       updated_at
		FROM receipts
		WHERE id = $1::uuid
	`, id)

	receipt, err := scanReceipt(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Receipt{}, ErrNotFound
	}
	if err != nil {
		return Receipt{}, fmt.Errorf("get receipt: %w", err)
	}

	receipt.Lines, err = r.listReceiptLines(ctx, id)
	if err != nil {
		return Receipt{}, err
	}

	receipt.Documents, err = r.listReceiptDocuments(ctx, id)
	if err != nil {
		return Receipt{}, err
	}

	receipt.Exceptions, err = r.listReceiptExceptions(ctx, id)
	if err != nil {
		return Receipt{}, err
	}

	return receipt, nil
}

func (r *PostgresRepository) ImportDocuWareReceipts(ctx context.Context, imports []importedReceipt) ([]Receipt, error) {
	if len(imports) == 0 {
		return []Receipt{}, nil
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin import transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	ids := make([]string, 0, len(imports))
	for _, imported := range imports {
		receiptID, err := r.upsertImportedReceipt(ctx, tx, imported)
		if err != nil {
			return nil, err
		}

		for _, line := range imported.Lines {
			if err := r.upsertImportedReceiptLine(ctx, tx, receiptID, line); err != nil {
				return nil, err
			}
		}

		ids = append(ids, receiptID)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit import transaction: %w", err)
	}

	receipts := make([]Receipt, 0, len(ids))
	for _, id := range ids {
		receipt, err := r.GetReceipt(ctx, id)
		if err != nil {
			return nil, err
		}
		receipts = append(receipts, receipt)
	}

	return receipts, nil
}

// CreateReceipt inserts a fresh receipt + lines for a manually-captured POD.
// Unlike ImportDocuWareReceipts, this performs no upsert — every call must
// produce a new receipt_number (caller's responsibility, see
// buildManualReceiptNumber). DocuWare-only fields are left empty.
func (r *PostgresRepository) CreateReceipt(ctx context.Context, imported importedReceipt) (Receipt, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Receipt{}, fmt.Errorf("begin create receipt transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	payloadJSON, err := json.Marshal(imported.SourcePayload)
	if err != nil {
		return Receipt{}, fmt.Errorf("marshal receipt payload: %w", err)
	}

	var receivedBy any
	if imported.ReceivedByUserID != "" {
		receivedBy = imported.ReceivedByUserID
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO receipts (
			receipt_number,
			supplier_name,
			customer_name,
			supplier_reference,
			purchase_order_number,
			delivery_note_number,
			weighbridge_ticket_number,
			vehicle_registration,
			job_number,
			received_at,
			received_by,
			received_by_name,
			status,
			notes,
			sync_status,
			docuware_source_payload
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid, $12, $13::receipt_status, $14, $15, $16::jsonb)
		RETURNING id::text
	`,
		imported.ReceiptNumber,
		imported.SupplierName,
		imported.CustomerName,
		imported.SupplierReference,
		imported.PurchaseOrderNumber,
		imported.DeliveryNoteNumber,
		imported.WeighbridgeTicketNumber,
		imported.VehicleRegistration,
		imported.JobNumber,
		imported.ReceivedAt,
		receivedBy,
		imported.ReceivedByName,
		string(imported.Status),
		imported.Notes,
		imported.SyncStatus,
		payloadJSON,
	)

	var receiptID string
	if err := row.Scan(&receiptID); err != nil {
		return Receipt{}, fmt.Errorf("insert receipt: %w", err)
	}

	for _, line := range imported.Lines {
		linePayloadJSON, err := json.Marshal(line.SourcePayload)
		if err != nil {
			return Receipt{}, fmt.Errorf("marshal receipt line payload: %w", err)
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO receipt_lines (
				receipt_id,
				line_number,
				item_code,
				description,
				material_size,
				material_markings,
				material_length,
				weight,
				expected_quantity,
				received_quantity,
				receiving_status,
				docuware_source_payload
			)
			VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
		`,
			receiptID,
			line.LineNumber,
			line.ItemCode,
			line.Description,
			line.MaterialSize,
			line.MaterialMarkings,
			line.MaterialLength,
			line.Weight,
			line.ExpectedQuantity,
			line.ReceivedQuantity,
			line.ReceivingStatus,
			linePayloadJSON,
		)
		if err != nil {
			return Receipt{}, fmt.Errorf("insert receipt line: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Receipt{}, fmt.Errorf("commit create receipt: %w", err)
	}

	return r.GetReceipt(ctx, receiptID)
}

func (r *PostgresRepository) upsertImportedReceipt(ctx context.Context, tx pgx.Tx, imported importedReceipt) (string, error) {
	// Upsert by receipt_number. Multiple DocuWare docs that share delivery/order/weighbridge
	// identifiers map to the same receipt_number (see buildReceiptNumber/buildGroupReference)
	// and should merge into one receipt with lines from each doc. First doc wins for header
	// fields — subsequent imports leave the header untouched and just add/update lines.
	// If the header needs to change, it happens via the app UI or an explicit re-import.

	payloadJSON, err := json.Marshal(imported.SourcePayload)
	if err != nil {
		return "", fmt.Errorf("marshal receipt payload: %w", err)
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO receipts (
			receipt_number,
			supplier_name,
			customer_name,
			supplier_reference,
			purchase_order_number,
			delivery_note_number,
			weighbridge_ticket_number,
			vehicle_registration,
			job_number,
			received_at,
			status,
			notes,
			source_docuware_document_id,
			source_docuware_cabinet_id,
			docuware_record_id,
			docuware_group_reference,
			docuware_doc_url,
			imported_at,
			sync_status,
			docuware_source_payload
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::receipt_status, $12, $13, $14, $15, $16, $17, NOW(), $18, $19::jsonb)
		ON CONFLICT (receipt_number) DO UPDATE SET updated_at = NOW()
		RETURNING id::text
	`,
		imported.ReceiptNumber,
		imported.SupplierName,
		imported.CustomerName,
		imported.SupplierReference,
		imported.PurchaseOrderNumber,
		imported.DeliveryNoteNumber,
		imported.WeighbridgeTicketNumber,
		imported.VehicleRegistration,
		imported.JobNumber,
		imported.ReceivedAt,
		string(imported.Status),
		imported.Notes,
		imported.SourceDocuWareDocument,
		imported.SourceDocuWareCabinet,
		imported.DocuWareRecordID,
		imported.DocuWareGroupReference,
		imported.DocuWareDocURL,
		imported.SyncStatus,
		payloadJSON,
	)

	var id string
	if err := row.Scan(&id); err != nil {
		return "", fmt.Errorf("update imported receipt: %w", err)
	}

	return id, nil
}

func resolveImportedReceiptLookup(lookupErr error, existingStatus string) (bool, error) {
	if lookupErr == nil {
		if existingStatus != string(ReceiptStatusDraft) {
			return false, ErrConflict
		}
		return false, nil
	}

	if errors.Is(lookupErr, pgx.ErrNoRows) {
		return true, nil
	}

	return false, fmt.Errorf("lookup imported receipt: %w", lookupErr)
}

func (r *PostgresRepository) upsertImportedReceiptLine(ctx context.Context, tx pgx.Tx, receiptID string, line importedReceiptLine) error {
	payloadJSON, err := json.Marshal(line.SourcePayload)
	if err != nil {
		return fmt.Errorf("marshal receipt line payload: %w", err)
	}

	var existingID string
	err = tx.QueryRow(ctx, `
		SELECT id::text
		FROM receipt_lines
		WHERE docuware_record_line_id = $1
	`, line.DocuWareRecordLine).Scan(&existingID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("lookup imported receipt line: %w", err)
	}

	if errors.Is(err, pgx.ErrNoRows) {
		_, err := tx.Exec(ctx, `
			INSERT INTO receipt_lines (
				receipt_id,
				line_number,
				item_code,
				description,
				material_code,
				material_description,
				material_size,
				material_markings,
				material_thickness,
				material_length,
				weight,
				process,
				stored_in,
				bay,
				expected_quantity,
				received_quantity,
				unit_of_measure,
				receiving_status,
				discrepancy,
				quantity_discrepancy,
				condition_notes,
				docuware_record_line_id,
				docuware_unique_number,
				docuware_primary_key,
				docuware_doc_id,
				docuware_source_payload
			)
			VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26::jsonb)
		`,
			receiptID,
			line.LineNumber,
			line.ItemCode,
			line.Description,
			line.MaterialCode,
			line.MaterialDescription,
			line.MaterialSize,
			line.MaterialMarkings,
			line.MaterialThickness,
			line.MaterialLength,
			line.Weight,
			line.Process,
			line.StoredIn,
			line.Bay,
			line.ExpectedQuantity,
			line.ReceivedQuantity,
			line.UnitOfMeasure,
			line.ReceivingStatus,
			line.Discrepancy,
			line.QuantityDiscrepancy,
			line.ConditionNotes,
			line.DocuWareRecordLine,
			line.DocuWareUniqueNo,
			line.DocuWarePrimaryKey,
			line.DocuWareDocID,
			payloadJSON,
		)
		if err != nil {
			return fmt.Errorf("insert imported receipt line: %w", err)
		}
		return nil
	}

	_, err = tx.Exec(ctx, `
		UPDATE receipt_lines
		SET item_code = $2,
		    description = $3,
		    material_code = $4,
		    material_description = $5,
		    material_size = $6,
		    material_markings = $7,
		    material_thickness = $8,
		    material_length = $9,
		    weight = $10,
		    process = $11,
		    stored_in = $12,
		    bay = $13,
		    expected_quantity = $14,
		    received_quantity = $15,
		    unit_of_measure = $16,
		    receiving_status = $17,
		    discrepancy = $18,
		    quantity_discrepancy = $19,
		    condition_notes = $20,
		    docuware_unique_number = $21,
		    docuware_primary_key = $22,
		    docuware_source_payload = $23::jsonb,
		    docuware_doc_id = COALESCE(NULLIF($24, ''), docuware_doc_id),
		    updated_at = NOW()
		WHERE id = $1::uuid
	`,
		existingID,
		line.ItemCode,
		line.Description,
		line.MaterialCode,
		line.MaterialDescription,
		line.MaterialSize,
		line.MaterialMarkings,
		line.MaterialThickness,
		line.MaterialLength,
		line.Weight,
		line.Process,
		line.StoredIn,
		line.Bay,
		line.ExpectedQuantity,
		line.ReceivedQuantity,
		line.UnitOfMeasure,
		line.ReceivingStatus,
		line.Discrepancy,
		line.QuantityDiscrepancy,
		line.ConditionNotes,
		line.DocuWareUniqueNo,
		line.DocuWarePrimaryKey,
		payloadJSON,
		line.DocuWareDocID,
	)
	if err != nil {
		return fmt.Errorf("update imported receipt line: %w", err)
	}

	return nil
}

func (r *PostgresRepository) listReceiptLines(ctx context.Context, receiptID string) ([]ReceiptLine, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text,
		       line_number,
		       item_code,
		       description,
		       material_code,
		       material_description,
		       material_size,
		       material_markings,
		       material_thickness,
		       material_length,
		       weight,
		       internal_description,
		       item_type,
		       packaging_method,
		       accessories,
		       comments,
		       required_galv_thickness,
		       process,
		       stored_in,
		       bay,
		       expected_quantity,
		       received_quantity,
		       unit_of_measure,
		       receiving_status,
		       discrepancy,
		       quantity_discrepancy,
		       condition_notes,
		       docuware_record_line_id,
		       docuware_unique_number,
		       docuware_primary_key,
		       docuware_doc_id,
		       last_synced_at
		FROM receipt_lines
		WHERE receipt_id = $1::uuid
		ORDER BY line_number ASC, created_at ASC
	`, receiptID)
	if err != nil {
		return nil, fmt.Errorf("list receipt lines: %w", err)
	}
	defer rows.Close()

	lines := []ReceiptLine{}
	for rows.Next() {
		line, err := scanReceiptLine(rows)
		if err != nil {
			return nil, fmt.Errorf("scan receipt line: %w", err)
		}
		lines = append(lines, line)
	}

	return lines, rows.Err()
}

func (r *PostgresRepository) listReceiptDocuments(ctx context.Context, receiptID string) ([]ReceiptDocument, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text,
		       COALESCE(receipt_line_id::text, ''),
		       category,
		       document_type,
		       filename,
		       content_type,
		       storage_key,
		       file_size,
		       source::text,
		       docuware_document_id,
		       docuware_status,
		       docuware_error,
		       COALESCE(uploaded_by::text, ''),
		       created_at
		FROM receipt_documents
		WHERE receipt_id = $1::uuid
		ORDER BY created_at ASC
	`, receiptID)
	if err != nil {
		return nil, fmt.Errorf("list receipt documents: %w", err)
	}
	defer rows.Close()

	documents := []ReceiptDocument{}
	for rows.Next() {
		document, err := scanReceiptDocument(rows)
		if err != nil {
			return nil, fmt.Errorf("scan receipt document: %w", err)
		}
		documents = append(documents, document)
	}

	return documents, rows.Err()
}

func scanReceiptDocument(row rowScanner) (ReceiptDocument, error) {
	var doc ReceiptDocument
	if err := row.Scan(
		&doc.ID,
		&doc.ReceiptLineID,
		&doc.Category,
		&doc.DocumentType,
		&doc.Filename,
		&doc.ContentType,
		&doc.StorageKey,
		&doc.FileSize,
		&doc.Source,
		&doc.DocuWareDocumentID,
		&doc.DocuWareStatus,
		&doc.DocuWareError,
		&doc.UploadedByID,
		&doc.CreatedAt,
	); err != nil {
		return ReceiptDocument{}, err
	}
	return doc, nil
}

const receiptDocumentSelectColumns = `
    id::text,
    COALESCE(receipt_line_id::text, ''),
    category,
    document_type,
    filename,
    content_type,
    storage_key,
    file_size,
    source::text,
    docuware_document_id,
    docuware_status,
    docuware_error,
    COALESCE(uploaded_by::text, ''),
    created_at
`

// GetReceiptLine fetches a single line scoped by receipt id, returning
// ErrNotFound if either id is wrong or they don't match.
func (r *PostgresRepository) GetReceiptLine(ctx context.Context, receiptID, lineID string) (ReceiptLine, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id::text,
		       line_number,
		       item_code,
		       description,
		       material_code,
		       material_description,
		       material_size,
		       material_markings,
		       material_thickness,
		       material_length,
		       weight,
		       internal_description,
		       item_type,
		       packaging_method,
		       accessories,
		       comments,
		       required_galv_thickness,
		       process,
		       stored_in,
		       bay,
		       expected_quantity,
		       received_quantity,
		       unit_of_measure,
		       receiving_status,
		       discrepancy,
		       quantity_discrepancy,
		       condition_notes,
		       docuware_record_line_id,
		       docuware_unique_number,
		       docuware_primary_key,
		       docuware_doc_id,
		       last_synced_at
		FROM receipt_lines
		WHERE id = $1::uuid AND receipt_id = $2::uuid
	`, lineID, receiptID)

	line, err := scanReceiptLine(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ReceiptLine{}, ErrNotFound
		}
		return ReceiptLine{}, fmt.Errorf("get receipt line: %w", err)
	}
	return line, nil
}

// InsertPhotoDocument creates a receipt_documents row tied to a receipt line.
// The DB-level partial unique index enforces "one defect photo per line".
func (r *PostgresRepository) InsertPhotoDocument(ctx context.Context, input InsertPhotoDocumentInput) (ReceiptDocument, error) {
	var uploadedBy any
	if strings.TrimSpace(input.UploadedByID) != "" {
		uploadedBy = input.UploadedByID
	}

	row := r.pool.QueryRow(ctx, `
		INSERT INTO receipt_documents (
		    receipt_id, receipt_line_id, category, document_type,
		    filename, content_type, storage_key, file_size,
		    source, docuware_status, uploaded_by
		) VALUES (
		    $1::uuid, $2::uuid, $3, $4,
		    $5, $6, $7, $8,
		    'capture', 'pending', $9
		)
		RETURNING `+receiptDocumentSelectColumns,
		input.ReceiptID,
		input.ReceiptLineID,
		string(input.Category),
		string(input.Category),
		input.Filename,
		input.ContentType,
		input.StorageKey,
		input.FileSize,
		uploadedBy,
	)

	doc, err := scanReceiptDocument(row)
	if err != nil {
		// Unique-violation surfaces here (one defect photo per line).
		if isUniqueViolation(err) {
			return ReceiptDocument{}, fmt.Errorf("%w: a defect photo already exists for this line", ErrConflict)
		}
		return ReceiptDocument{}, fmt.Errorf("insert photo document: %w", err)
	}
	return doc, nil
}

// GetPhotoDocument returns the document and its storage_key. Caller resolves
// the storage_key to a filesystem path via PhotoService (which keeps the
// storage root encapsulated and prevents traversal).
func (r *PostgresRepository) GetPhotoDocument(ctx context.Context, photoID string) (ReceiptDocument, string, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT `+receiptDocumentSelectColumns+`
		FROM receipt_documents
		WHERE id = $1::uuid
	`, photoID)

	doc, err := scanReceiptDocument(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ReceiptDocument{}, "", ErrNotFound
		}
		return ReceiptDocument{}, "", fmt.Errorf("get photo document: %w", err)
	}
	return doc, doc.StorageKey, nil
}

// DeletePhotoDocument removes a still-pending photo row, returning the
// storage_key so the caller can unlink the file. Synced photos cannot be
// deleted via this path.
func (r *PostgresRepository) DeletePhotoDocument(ctx context.Context, photoID string) (string, error) {
	var storageKey string
	err := r.pool.QueryRow(ctx, `
		DELETE FROM receipt_documents
		WHERE id = $1::uuid
		  AND docuware_status = 'pending'
		RETURNING storage_key
	`, photoID).Scan(&storageKey)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrConflict
		}
		return "", fmt.Errorf("delete photo document: %w", err)
	}
	return storageKey, nil
}

// InsertGRNDocument creates a receipt_documents row representing the
// generated GRN PDF, scoped to the receipt (no receipt_line_id) and
// categorised so the worker's GRN push step picks it up.
func (r *PostgresRepository) InsertGRNDocument(ctx context.Context, input InsertGRNDocumentInput) (ReceiptDocument, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO receipt_documents (
		    receipt_id, category, document_type,
		    filename, content_type, storage_key, file_size,
		    source, docuware_status
		) VALUES (
		    $1::uuid, $2, $3,
		    $4, $5, $6, $7,
		    'capture', 'pending'
		)
		RETURNING `+receiptDocumentSelectColumns,
		input.ReceiptID,
		string(PhotoCategoryGRN),
		"GRN",
		input.Filename,
		input.ContentType,
		input.StorageKey,
		input.FileSize,
	)
	doc, err := scanReceiptDocument(row)
	if err != nil {
		return ReceiptDocument{}, fmt.Errorf("insert grn document: %w", err)
	}
	return doc, nil
}

// SetReceiptGRNDocument records the back-pointer from the receipt to the
// generated GRN row, so subsequent calls to MaybeGenerate are idempotent
// even before the PDF is loaded with the receipt.
func (r *PostgresRepository) SetReceiptGRNDocument(ctx context.Context, receiptID, documentID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE receipts
		SET grn_document_id = $2::uuid,
		    grn_generated_at = NOW(),
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, receiptID, documentID)
	if err != nil {
		return fmt.Errorf("set receipt grn document: %w", err)
	}
	return nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	// pgx wraps the underlying *pgconn.PgError; sniff the message rather than
	// adding a new dependency. Callers map this to ErrConflict.
	msg := err.Error()
	return strings.Contains(msg, "duplicate key value") || strings.Contains(msg, "23505")
}

func (r *PostgresRepository) listReceiptExceptions(ctx context.Context, receiptID string) ([]ReceiptException, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text,
		       exception_type::text,
		       summary,
		       details,
		       is_resolved,
		       resolved_at,
		       created_at
		FROM receipt_exceptions
		WHERE receipt_id = $1::uuid
		ORDER BY created_at ASC
	`, receiptID)
	if err != nil {
		return nil, fmt.Errorf("list receipt exceptions: %w", err)
	}
	defer rows.Close()

	exceptions := []ReceiptException{}
	for rows.Next() {
		var exception ReceiptException
		var resolvedAt sql.NullTime
		if err := rows.Scan(
			&exception.ID,
			&exception.ExceptionType,
			&exception.Summary,
			&exception.Details,
			&exception.IsResolved,
			&resolvedAt,
			&exception.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan receipt exception: %w", err)
		}
		if resolvedAt.Valid {
			exception.ResolvedAt = resolvedAt.Time
		}
		exceptions = append(exceptions, exception)
	}

	return exceptions, rows.Err()
}

func (r *PostgresRepository) UpdateReceipt(ctx context.Context, id string, input UpdateReceiptInput) (Receipt, error) {
	setClauses := []string{"updated_at = NOW()"}
	args := []any{id}
	argIdx := 2

	if input.Status != nil {
		setClauses = append(setClauses, fmt.Sprintf("status = $%d::receipt_status", argIdx))
		args = append(args, string(*input.Status))
		argIdx++
	}

	if input.Notes != nil {
		setClauses = append(setClauses, fmt.Sprintf("notes = $%d", argIdx))
		args = append(args, *input.Notes)
		argIdx++
	}

	if input.CustomerName != nil {
		setClauses = append(setClauses, fmt.Sprintf("customer_name = $%d", argIdx))
		args = append(args, *input.CustomerName)
		argIdx++
	}

	if input.SupplierName != nil {
		setClauses = append(setClauses, fmt.Sprintf("supplier_name = $%d", argIdx))
		args = append(args, *input.SupplierName)
		argIdx++
	}

	if input.PurchaseOrderNumber != nil {
		setClauses = append(setClauses, fmt.Sprintf("purchase_order_number = $%d", argIdx))
		args = append(args, *input.PurchaseOrderNumber)
		argIdx++
	}

	if input.DeliveryNoteNumber != nil {
		setClauses = append(setClauses, fmt.Sprintf("delivery_note_number = $%d", argIdx))
		args = append(args, *input.DeliveryNoteNumber)
		argIdx++
	}

	if input.WeighbridgeTicketNumber != nil {
		setClauses = append(setClauses, fmt.Sprintf("weighbridge_ticket_number = $%d", argIdx))
		args = append(args, *input.WeighbridgeTicketNumber)
		argIdx++
	}

	if input.VehicleRegistration != nil {
		setClauses = append(setClauses, fmt.Sprintf("vehicle_registration = $%d", argIdx))
		args = append(args, *input.VehicleRegistration)
		argIdx++
	}

	if input.JobNumber != nil {
		setClauses = append(setClauses, fmt.Sprintf("job_number = $%d", argIdx))
		args = append(args, *input.JobNumber)
		argIdx++
	}

	if len(setClauses) == 1 {
		return r.GetReceipt(ctx, id)
	}

	query := fmt.Sprintf("UPDATE receipts SET %s WHERE id = $1::uuid", strings.Join(setClauses, ", "))
	_, err := r.pool.Exec(ctx, query, args...)
	if err != nil {
		return Receipt{}, fmt.Errorf("update receipt: %w", err)
	}

	return r.GetReceipt(ctx, id)
}

func (r *PostgresRepository) UpdateReceiptLine(ctx context.Context, receiptID, lineID string, input UpdateReceiptLineInput) (ReceiptLine, error) {
	setClauses := []string{"updated_at = NOW()"}
	args := []any{lineID, receiptID}
	argIdx := 3

	if input.ReceivedQuantity != nil {
		setClauses = append(setClauses, fmt.Sprintf("received_quantity = $%d", argIdx))
		args = append(args, *input.ReceivedQuantity)
		argIdx++
	}

	if input.QuantityDiscrepancy != nil {
		setClauses = append(setClauses, fmt.Sprintf("quantity_discrepancy = $%d", argIdx))
		args = append(args, *input.QuantityDiscrepancy)
		argIdx++
	}

	if input.InternalDescription != nil {
		setClauses = append(setClauses, fmt.Sprintf("internal_description = $%d", argIdx))
		args = append(args, *input.InternalDescription)
		argIdx++
	}

	if input.ItemCode != nil {
		setClauses = append(setClauses, fmt.Sprintf("item_code = $%d", argIdx))
		args = append(args, *input.ItemCode)
		argIdx++
	}

	if input.Description != nil {
		setClauses = append(setClauses, fmt.Sprintf("description = $%d", argIdx))
		args = append(args, *input.Description)
		argIdx++
	}

	if input.MaterialSize != nil {
		setClauses = append(setClauses, fmt.Sprintf("material_size = $%d", argIdx))
		args = append(args, *input.MaterialSize)
		argIdx++
	}

	if input.MaterialThickness != nil {
		setClauses = append(setClauses, fmt.Sprintf("material_thickness = $%d", argIdx))
		args = append(args, *input.MaterialThickness)
		argIdx++
	}

	if input.Process != nil {
		setClauses = append(setClauses, fmt.Sprintf("process = $%d", argIdx))
		args = append(args, *input.Process)
		argIdx++
	}

	if input.ItemType != nil {
		setClauses = append(setClauses, fmt.Sprintf("item_type = $%d", argIdx))
		args = append(args, *input.ItemType)
		argIdx++
	}

	if input.PackagingMethod != nil {
		setClauses = append(setClauses, fmt.Sprintf("packaging_method = $%d", argIdx))
		args = append(args, *input.PackagingMethod)
		argIdx++
	}

	if input.Accessories != nil {
		setClauses = append(setClauses, fmt.Sprintf("accessories = $%d", argIdx))
		args = append(args, *input.Accessories)
		argIdx++
	}

	if input.Comments != nil {
		setClauses = append(setClauses, fmt.Sprintf("comments = $%d", argIdx))
		args = append(args, *input.Comments)
		argIdx++
	}

	if input.RequiredGalvThickness != nil {
		setClauses = append(setClauses, fmt.Sprintf("required_galv_thickness = $%d", argIdx))
		args = append(args, *input.RequiredGalvThickness)
		argIdx++
	}

	if input.StoredIn != nil {
		setClauses = append(setClauses, fmt.Sprintf("stored_in = $%d", argIdx))
		args = append(args, *input.StoredIn)
		argIdx++
	}

	if input.Bay != nil {
		setClauses = append(setClauses, fmt.Sprintf("bay = $%d", argIdx))
		args = append(args, *input.Bay)
		argIdx++
	}

	if input.ReceivingStatus != nil {
		setClauses = append(setClauses, fmt.Sprintf("receiving_status = $%d", argIdx))
		args = append(args, *input.ReceivingStatus)
		argIdx++
	}

	if input.Discrepancy != nil {
		setClauses = append(setClauses, fmt.Sprintf("discrepancy = $%d", argIdx))
		args = append(args, *input.Discrepancy)
		argIdx++
	}

	if input.ConditionNotes != nil {
		setClauses = append(setClauses, fmt.Sprintf("condition_notes = $%d", argIdx))
		args = append(args, *input.ConditionNotes)
		argIdx++
	}

	// Stamp the confirmer when (and only when) the line transitions to
	// receiving_status='received'. Use COALESCE on the existing column so
	// the first confirmer wins — a later edit by someone else doesn't
	// retroactively rewrite who signed for the line.
	if input.ReceivingStatus != nil && *input.ReceivingStatus == "received" && input.ReceivedByUserID != "" {
		setClauses = append(setClauses,
			fmt.Sprintf("received_by = COALESCE(received_by, $%d::uuid)", argIdx))
		args = append(args, input.ReceivedByUserID)
		argIdx++

		setClauses = append(setClauses,
			fmt.Sprintf("received_by_name = CASE WHEN COALESCE(received_by_name, '') = '' THEN $%d ELSE received_by_name END", argIdx))
		args = append(args, input.ReceivedByName)
		argIdx++
	}

	query := fmt.Sprintf(
		"UPDATE receipt_lines SET %s WHERE id = $1::uuid AND receipt_id = $2::uuid",
		strings.Join(setClauses, ", "),
	)
	tag, err := r.pool.Exec(ctx, query, args...)
	if err != nil {
		return ReceiptLine{}, fmt.Errorf("update receipt line: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return ReceiptLine{}, ErrNotFound
	}

	row := r.pool.QueryRow(ctx, `
		SELECT id::text,
		       line_number,
		       item_code,
		       description,
		       material_code,
		       material_description,
		       material_size,
		       material_markings,
		       material_thickness,
		       material_length,
		       weight,
		       internal_description,
		       item_type,
		       packaging_method,
		       accessories,
		       comments,
		       required_galv_thickness,
		       process,
		       stored_in,
		       bay,
		       expected_quantity,
		       received_quantity,
		       unit_of_measure,
		       receiving_status,
		       discrepancy,
		       quantity_discrepancy,
		       condition_notes,
		       docuware_record_line_id,
		       docuware_unique_number,
		       docuware_primary_key,
		       docuware_doc_id,
		       last_synced_at
		FROM receipt_lines
		WHERE id = $1::uuid
	`, lineID)

	return scanReceiptLine(row)
}

func scanReceipt(row rowScanner) (Receipt, error) {
	var receipt Receipt
	var status string
	var importedAt, lastSyncedAt, grnGeneratedAt, podStatusSyncedAt sql.NullTime

	err := row.Scan(
		&receipt.ID,
		&receipt.ReceiptNumber,
		&receipt.SupplierName,
		&receipt.CustomerName,
		&receipt.SupplierReference,
		&receipt.PurchaseOrderNumber,
		&receipt.DeliveryNoteNumber,
		&receipt.WeighbridgeTicketNumber,
		&receipt.VehicleRegistration,
		&receipt.JobNumber,
		&receipt.SourceDocuWareDocument,
		&receipt.SourceDocuWareCabinet,
		&receipt.DocuWareRecordID,
		&receipt.DocuWareGroupReference,
		&receipt.DocuWareDocURL,
		&receipt.ReceivedAt,
		&status,
		&receipt.SyncStatus,
		&receipt.Notes,
		&receipt.GRNDocumentID,
		&receipt.GRNDocuWareDocID,
		&grnGeneratedAt,
		&receipt.DocuWarePODStatus,
		&podStatusSyncedAt,
		&importedAt,
		&lastSyncedAt,
		&receipt.CreatedAt,
		&receipt.UpdatedAt,
	)
	if err != nil {
		return Receipt{}, err
	}

	receipt.Status = ReceiptStatus(status)
	receipt.Lines = []ReceiptLine{}
	receipt.Documents = []ReceiptDocument{}
	receipt.Exceptions = []ReceiptException{}
	if importedAt.Valid {
		value := importedAt.Time
		receipt.ImportedAt = &value
	}
	if lastSyncedAt.Valid {
		value := lastSyncedAt.Time
		receipt.LastSyncedAt = &value
	}
	if grnGeneratedAt.Valid {
		value := grnGeneratedAt.Time
		receipt.GRNGeneratedAt = &value
	}
	if podStatusSyncedAt.Valid {
		value := podStatusSyncedAt.Time
		receipt.DocuWarePODStatusSyncedAt = &value
	}

	return receipt, nil
}

// scanReceiptWithLineCount mirrors scanReceipt but trails one extra column
// (line_count) — used by ListReceipts so cards can show an accurate count
// without paying for the full line bodies.
func scanReceiptWithLineCount(row rowScanner) (Receipt, error) {
	var receipt Receipt
	var status string
	var importedAt, lastSyncedAt, grnGeneratedAt, podStatusSyncedAt sql.NullTime

	err := row.Scan(
		&receipt.ID,
		&receipt.ReceiptNumber,
		&receipt.SupplierName,
		&receipt.CustomerName,
		&receipt.SupplierReference,
		&receipt.PurchaseOrderNumber,
		&receipt.DeliveryNoteNumber,
		&receipt.WeighbridgeTicketNumber,
		&receipt.VehicleRegistration,
		&receipt.JobNumber,
		&receipt.SourceDocuWareDocument,
		&receipt.SourceDocuWareCabinet,
		&receipt.DocuWareRecordID,
		&receipt.DocuWareGroupReference,
		&receipt.DocuWareDocURL,
		&receipt.ReceivedAt,
		&status,
		&receipt.SyncStatus,
		&receipt.Notes,
		&receipt.GRNDocumentID,
		&receipt.GRNDocuWareDocID,
		&grnGeneratedAt,
		&receipt.DocuWarePODStatus,
		&podStatusSyncedAt,
		&importedAt,
		&lastSyncedAt,
		&receipt.CreatedAt,
		&receipt.UpdatedAt,
		&receipt.LineCount,
	)
	if err != nil {
		return Receipt{}, err
	}

	receipt.Status = ReceiptStatus(status)
	receipt.Lines = []ReceiptLine{}
	receipt.Documents = []ReceiptDocument{}
	receipt.Exceptions = []ReceiptException{}
	if importedAt.Valid {
		receipt.ImportedAt = &importedAt.Time
	}
	if lastSyncedAt.Valid {
		receipt.LastSyncedAt = &lastSyncedAt.Time
	}
	if grnGeneratedAt.Valid {
		receipt.GRNGeneratedAt = &grnGeneratedAt.Time
	}
	if podStatusSyncedAt.Valid {
		receipt.DocuWarePODStatusSyncedAt = &podStatusSyncedAt.Time
	}

	return receipt, nil
}

func scanReceiptLine(row rowScanner) (ReceiptLine, error) {
	var line ReceiptLine
	var lastSyncedAt sql.NullTime

	err := row.Scan(
		&line.ID,
		&line.LineNumber,
		&line.ItemCode,
		&line.Description,
		&line.MaterialCode,
		&line.MaterialDescription,
		&line.MaterialSize,
		&line.MaterialMarkings,
		&line.MaterialThickness,
		&line.MaterialLength,
		&line.Weight,
		&line.InternalDescription,
		&line.ItemType,
		&line.PackagingMethod,
		&line.Accessories,
		&line.Comments,
		&line.RequiredGalvThickness,
		&line.Process,
		&line.StoredIn,
		&line.Bay,
		&line.ExpectedQuantity,
		&line.ReceivedQuantity,
		&line.UnitOfMeasure,
		&line.ReceivingStatus,
		&line.Discrepancy,
		&line.QuantityDiscrepancy,
		&line.ConditionNotes,
		&line.DocuWareRecordLine,
		&line.DocuWareUniqueNo,
		&line.DocuWarePrimaryKey,
		&line.DocuWareDocID,
		&lastSyncedAt,
	)
	if err != nil {
		return ReceiptLine{}, err
	}

	if lastSyncedAt.Valid {
		value := lastSyncedAt.Time
		line.LastSyncedAt = &value
	}

	return line, nil
}
