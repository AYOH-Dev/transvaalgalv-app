package receiving

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

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

func (r *PostgresRepository) ListReceipts(ctx context.Context) ([]Receipt, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text,
		       receipt_number,
		       supplier_name,
		       supplier_reference,
		       purchase_order_number,
		       delivery_note_number,
		       source_docuware_document_id,
		       source_docuware_cabinet_id,
		       docuware_record_id,
		       docuware_group_reference,
		       received_at,
		       status::text,
		       sync_status,
		       notes,
		       imported_at,
		       last_synced_at,
		       created_at,
		       updated_at
		FROM receipts
		ORDER BY received_at DESC, created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list receipts: %w", err)
	}
	defer rows.Close()

	receipts := []Receipt{}
	for rows.Next() {
		receipt, err := scanReceipt(rows)
		if err != nil {
			return nil, fmt.Errorf("scan receipt: %w", err)
		}
		receipts = append(receipts, receipt)
	}

	return receipts, rows.Err()
}

func (r *PostgresRepository) GetReceipt(ctx context.Context, id string) (Receipt, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id::text,
		       receipt_number,
		       supplier_name,
		       supplier_reference,
		       purchase_order_number,
		       delivery_note_number,
		       source_docuware_document_id,
		       source_docuware_cabinet_id,
		       docuware_record_id,
		       docuware_group_reference,
		       received_at,
		       status::text,
		       sync_status,
		       notes,
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

func (r *PostgresRepository) upsertImportedReceipt(ctx context.Context, tx pgx.Tx, imported importedReceipt) (string, error) {
	var existingID string
	var existingStatus string
	lookupErr := tx.QueryRow(ctx, `
		SELECT id::text, status::text
		FROM receipts
		WHERE docuware_group_reference = $1
	`, imported.DocuWareGroupReference).Scan(&existingID, &existingStatus)

	insertNew, err := resolveImportedReceiptLookup(lookupErr, existingStatus)
	if err != nil {
		return "", err
	}

	payloadJSON, err := json.Marshal(imported.SourcePayload)
	if err != nil {
		return "", fmt.Errorf("marshal receipt payload: %w", err)
	}

	if insertNew {
		row := tx.QueryRow(ctx, `
			INSERT INTO receipts (
				receipt_number,
				supplier_name,
				supplier_reference,
				purchase_order_number,
				delivery_note_number,
				received_at,
				status,
				notes,
				source_docuware_document_id,
				source_docuware_cabinet_id,
				docuware_record_id,
				docuware_group_reference,
				imported_at,
				sync_status,
				docuware_source_payload
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7::receipt_status, $8, $9, $10, $11, $12, NOW(), $13, $14::jsonb)
			RETURNING id::text
		`,
			imported.ReceiptNumber,
			imported.SupplierName,
			imported.SupplierReference,
			imported.PurchaseOrderNumber,
			imported.DeliveryNoteNumber,
			imported.ReceivedAt,
			string(imported.Status),
			imported.Notes,
			imported.SourceDocuWareDocument,
			imported.SourceDocuWareCabinet,
			imported.DocuWareRecordID,
			imported.DocuWareGroupReference,
			imported.SyncStatus,
			payloadJSON,
		)

		var id string
		if err := row.Scan(&id); err != nil {
			return "", fmt.Errorf("insert imported receipt: %w", err)
		}
		return id, nil
	}

	if existingStatus != string(ReceiptStatusDraft) {
		return "", ErrConflict
	}

	row := tx.QueryRow(ctx, `
		UPDATE receipts
		SET supplier_name = $2,
		    supplier_reference = $3,
		    purchase_order_number = $4,
		    delivery_note_number = $5,
		    received_at = $6,
		    notes = $7,
		    source_docuware_document_id = $8,
		    source_docuware_cabinet_id = $9,
		    docuware_record_id = $10,
		    imported_at = NOW(),
		    sync_status = $11,
		    docuware_source_payload = $12::jsonb,
		    updated_at = NOW()
		WHERE id = $1::uuid
		RETURNING id::text
	`,
		existingID,
		imported.SupplierName,
		imported.SupplierReference,
		imported.PurchaseOrderNumber,
		imported.DeliveryNoteNumber,
		imported.ReceivedAt,
		imported.Notes,
		imported.SourceDocuWareDocument,
		imported.SourceDocuWareCabinet,
		imported.DocuWareRecordID,
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
				expected_quantity,
				received_quantity,
				unit_of_measure,
				condition_notes,
				docuware_record_line_id,
				docuware_unique_number,
				docuware_primary_key,
				docuware_source_payload
			)
			VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
		`,
			receiptID,
			line.LineNumber,
			line.ItemCode,
			line.Description,
			line.ExpectedQuantity,
			line.ReceivedQuantity,
			line.UnitOfMeasure,
			line.ConditionNotes,
			line.DocuWareRecordLine,
			line.DocuWareUniqueNo,
			line.DocuWarePrimaryKey,
			payloadJSON,
		)
		if err != nil {
			return fmt.Errorf("insert imported receipt line: %w", err)
		}
		return nil
	}

	_, err = tx.Exec(ctx, `
		UPDATE receipt_lines
		SET receipt_id = $2::uuid,
		    line_number = $3,
		    item_code = $4,
		    description = $5,
		    expected_quantity = $6,
		    received_quantity = $7,
		    unit_of_measure = $8,
		    condition_notes = $9,
		    docuware_unique_number = $10,
		    docuware_primary_key = $11,
		    docuware_source_payload = $12::jsonb,
		    updated_at = NOW()
		WHERE id = $1::uuid
	`,
		existingID,
		receiptID,
		line.LineNumber,
		line.ItemCode,
		line.Description,
		line.ExpectedQuantity,
		line.ReceivedQuantity,
		line.UnitOfMeasure,
		line.ConditionNotes,
		line.DocuWareUniqueNo,
		line.DocuWarePrimaryKey,
		payloadJSON,
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
		       expected_quantity,
		       received_quantity,
		       unit_of_measure,
		       condition_notes,
		       docuware_record_line_id,
		       docuware_unique_number,
		       docuware_primary_key,
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
		       document_type,
		       filename,
		       content_type,
		       storage_key,
		       source::text,
		       docuware_document_id,
		       docuware_status,
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
		var document ReceiptDocument
		if err := rows.Scan(
			&document.ID,
			&document.DocumentType,
			&document.Filename,
			&document.ContentType,
			&document.StorageKey,
			&document.Source,
			&document.DocuWareDocumentID,
			&document.DocuWareStatus,
			&document.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan receipt document: %w", err)
		}
		documents = append(documents, document)
	}

	return documents, rows.Err()
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

func scanReceipt(row rowScanner) (Receipt, error) {
	var receipt Receipt
	var status string
	var importedAt sql.NullTime
	var lastSyncedAt sql.NullTime

	err := row.Scan(
		&receipt.ID,
		&receipt.ReceiptNumber,
		&receipt.SupplierName,
		&receipt.SupplierReference,
		&receipt.PurchaseOrderNumber,
		&receipt.DeliveryNoteNumber,
		&receipt.SourceDocuWareDocument,
		&receipt.SourceDocuWareCabinet,
		&receipt.DocuWareRecordID,
		&receipt.DocuWareGroupReference,
		&receipt.ReceivedAt,
		&status,
		&receipt.SyncStatus,
		&receipt.Notes,
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
		&line.ExpectedQuantity,
		&line.ReceivedQuantity,
		&line.UnitOfMeasure,
		&line.ConditionNotes,
		&line.DocuWareRecordLine,
		&line.DocuWareUniqueNo,
		&line.DocuWarePrimaryKey,
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