package docuware

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"strings"
	"time"
)

// queuedGRN is a pending GRN PDF push, joined with everything we need to
// build the DocuWare index fields without round-tripping through the
// receiving service.
type queuedGRN struct {
	DocID        string
	ReceiptID    string
	Filename     string
	ContentType  string
	StorageKey   string
	AttemptCount int

	ReceiptNumber           string
	DeliveryNoteNumber      string
	PurchaseOrderNumber     string
	WeighbridgeTicketNumber string
	VehicleRegistration     string
	CustomerName            string
	SupplierName            string
	JobNumber               string
	ReceivedAt              time.Time
	ReceivedByDisplayName   string
}

const grnMaxAttempts = 6

func (w *Worker) processPendingGRNs(ctx context.Context) {
	if strings.TrimSpace(w.photoStorageDir) == "" || strings.TrimSpace(w.documentsCabinet) == "" {
		return
	}

	limit := w.maxWorkers
	if limit <= 0 {
		limit = 3
	}

	grns, err := w.fetchPendingGRNs(ctx, limit)
	if err != nil {
		w.logger.Printf("fetch pending grns: %v", err)
		return
	}
	if len(grns) == 0 {
		return
	}

	w.logger.Printf("processing %d pending grn pushes", len(grns))

	for _, g := range grns {
		if err := w.markGRNInProgress(ctx, g.DocID); err != nil {
			w.logger.Printf("mark grn in_progress (id=%s): %v", g.DocID, err)
			continue
		}

		dwDocID, err := w.uploadGRN(ctx, g)
		if err != nil {
			retryable := isRetryableUploadError(err)
			if uErr := w.markGRNFailed(ctx, g, err, retryable); uErr != nil {
				w.logger.Printf("mark grn failed (id=%s): %v", g.DocID, uErr)
			}
			if retryable {
				w.logger.Printf("grn upload failed (retryable): id=%s attempt=%d/%d err=%v",
					g.DocID, g.AttemptCount+1, grnMaxAttempts, err)
			} else {
				w.logger.Printf("grn upload failed (permanent): id=%s err=%v", g.DocID, err)
			}
			continue
		}

		if uErr := w.markGRNSynced(ctx, g, dwDocID); uErr != nil {
			w.logger.Printf("mark grn synced (id=%s): %v", g.DocID, uErr)
			continue
		}

		// Re-attach all defect photos for this receipt's lines as Sections
		// on the new GRN doc, so photos live in both cabinets per design.
		// Failures are logged but don't unwind the GRN push.
		if err := w.attachDefectPhotosToGRN(ctx, g.ReceiptID, dwDocID); err != nil {
			w.logger.Printf("attach defect photos to grn doc=%s: %v", dwDocID, err)
		}

		w.logger.Printf("grn synced: id=%s receipt=%s docuware_doc=%s", g.DocID, g.ReceiptID, dwDocID)
	}
}

func (w *Worker) fetchPendingGRNs(ctx context.Context, limit int) ([]queuedGRN, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT
		    d.id::text,
		    d.receipt_id::text,
		    d.filename,
		    d.content_type,
		    d.storage_key,
		    d.attempt_count,
		    r.receipt_number,
		    r.delivery_note_number,
		    r.purchase_order_number,
		    r.weighbridge_ticket_number,
		    r.vehicle_registration,
		    r.customer_name,
		    r.supplier_name,
		    r.job_number,
		    r.received_at,
		    r.received_by_name
		FROM receipt_documents d
		JOIN receipts r ON d.receipt_id = r.id
		WHERE d.category = 'grn_pdf'
		  AND d.docuware_status IN ('pending', 'in_progress')
		  AND (d.next_retry_at IS NULL OR d.next_retry_at <= NOW())
		ORDER BY d.created_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("query pending grns: %w", err)
	}
	defer rows.Close()

	var out []queuedGRN
	for rows.Next() {
		var g queuedGRN
		if err := rows.Scan(
			&g.DocID,
			&g.ReceiptID,
			&g.Filename,
			&g.ContentType,
			&g.StorageKey,
			&g.AttemptCount,
			&g.ReceiptNumber,
			&g.DeliveryNoteNumber,
			&g.PurchaseOrderNumber,
			&g.WeighbridgeTicketNumber,
			&g.VehicleRegistration,
			&g.CustomerName,
			&g.SupplierName,
			&g.JobNumber,
			&g.ReceivedAt,
			&g.ReceivedByDisplayName,
		); err != nil {
			return nil, fmt.Errorf("scan pending grn: %w", err)
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (w *Worker) markGRNInProgress(ctx context.Context, docID string) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE receipt_documents
		SET docuware_status = 'in_progress'
		WHERE id = $1::uuid AND docuware_status = 'pending'
	`, docID)
	return err
}

func (w *Worker) markGRNSynced(ctx context.Context, g queuedGRN, dwDocID string) error {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		UPDATE receipt_documents
		SET docuware_status = 'synced',
		    docuware_document_id = $2,
		    docuware_error = '',
		    next_retry_at = NULL
		WHERE id = $1::uuid
	`, g.DocID, dwDocID); err != nil {
		return fmt.Errorf("update doc: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE receipts
		SET grn_docuware_doc_id = $2,
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, g.ReceiptID, dwDocID); err != nil {
		return fmt.Errorf("update receipt: %w", err)
	}

	return tx.Commit(ctx)
}

func (w *Worker) markGRNFailed(ctx context.Context, g queuedGRN, cause error, retryable bool) error {
	newAttempt := g.AttemptCount + 1
	errMsg := cause.Error()
	if len(errMsg) > 1000 {
		errMsg = errMsg[:1000]
	}

	if !retryable || newAttempt >= grnMaxAttempts {
		_, err := w.pool.Exec(ctx, `
			UPDATE receipt_documents
			SET docuware_status = 'failed',
			    docuware_error = $2,
			    attempt_count = $3,
			    next_retry_at = NULL
			WHERE id = $1::uuid
		`, g.DocID, errMsg, newAttempt)
		return err
	}

	backoff := time.Duration(math.Pow(2, float64(newAttempt))) * time.Minute
	nextRetry := time.Now().Add(backoff)
	_, err := w.pool.Exec(ctx, `
		UPDATE receipt_documents
		SET docuware_status = 'pending',
		    docuware_error = $2,
		    attempt_count = $3,
		    next_retry_at = $4
		WHERE id = $1::uuid
	`, g.DocID, errMsg, newAttempt, nextRetry)
	return err
}

func (w *Worker) uploadGRN(ctx context.Context, g queuedGRN) (string, error) {
	abs, err := safeJoin(w.photoStorageDir, g.StorageKey)
	if err != nil {
		return "", err
	}
	f, err := os.Open(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return "", errors.New("grn pdf missing on disk")
		}
		return "", fmt.Errorf("open grn pdf: %w", err)
	}
	defer f.Close()

	fields := buildGRNIndexFields(g)
	contentType := g.ContentType
	if contentType == "" {
		contentType = "application/pdf"
	}

	dwDocID, err := w.client.CreateDocument(ctx, w.documentsCabinet, fields, g.Filename, contentType, f)
	if err != nil {
		return "", err
	}
	return dwDocID, nil
}

// buildGRNIndexFields lives here (not in receiving) so the worker stays
// independent of the renderer package. Field names mirror the legacy
// newPODSubmit payload — see docs/ENHANCEMENTS.md and
// docs/docuware-documents-cabinet.md.
func buildGRNIndexFields(g queuedGRN) []IndexField {
	return []IndexField{
		{FieldName: "DOCUMENT_TYPE", Item: "GRN"},
		{FieldName: "DOCUMENTTYPE", Item: "GRN"},
		{FieldName: "DOCUMENTNO", Item: grnNumber(g)},
		{FieldName: "DELIVERY_NOTE_NUMBER", Item: g.DeliveryNoteNumber},
		{FieldName: "ORDER_NUMBER", Item: g.PurchaseOrderNumber},
		{FieldName: "WEIGHBRIDGE_TICKET_NUMBER", Item: g.WeighbridgeTicketNumber},
		{FieldName: "VEHICLE_REGISTRATION_", Item: g.VehicleRegistration},
		{FieldName: "COMPANY", Item: g.CustomerName},
		{FieldName: "FABRICATOR", Item: g.SupplierName},
		{FieldName: "JOB_NUMBER", Item: g.JobNumber},
		{FieldName: "DATE", Item: g.ReceivedAt.Format("2006-01-02")},
		{FieldName: "RECEIVED_BY", Item: g.ReceivedByDisplayName},
	}
}

func grnNumber(g queuedGRN) string {
	if strings.TrimSpace(g.ReceiptNumber) != "" {
		return "GRN-" + g.ReceiptNumber
	}
	return "GRN-" + g.ReceivedAt.Format("20060102") + "-" + shortID(g.ReceiptID)
}

func shortID(id string) string {
	if len(id) >= 8 {
		return id[:8]
	}
	return id
}

// attachDefectPhotosToGRN looks up every successfully-synced defect photo
// for the given receipt's lines and re-attaches it as a Section on the
// GRN doc. Photos that haven't synced to the Receiving Data cabinet yet
// will get re-attached on a later run because we re-query on every push.
//
// Best-effort: per-photo failures are logged but don't block the others.
func (w *Worker) attachDefectPhotosToGRN(ctx context.Context, receiptID, grnDocID string) error {
	rows, err := w.pool.Query(ctx, `
		SELECT d.id::text, d.filename, d.content_type, d.storage_key
		FROM receipt_documents d
		WHERE d.receipt_id = $1::uuid
		  AND d.category = 'defect_photo'
	`, receiptID)
	if err != nil {
		return fmt.Errorf("query defect photos: %w", err)
	}
	defer rows.Close()

	var photos []struct {
		ID, Filename, ContentType, StorageKey string
	}
	for rows.Next() {
		var p struct{ ID, Filename, ContentType, StorageKey string }
		if err := rows.Scan(&p.ID, &p.Filename, &p.ContentType, &p.StorageKey); err != nil {
			return fmt.Errorf("scan photo: %w", err)
		}
		photos = append(photos, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, p := range photos {
		abs, err := safeJoin(w.photoStorageDir, p.StorageKey)
		if err != nil {
			w.logger.Printf("grn-photo-attach: invalid storage key for photo %s: %v", p.ID, err)
			continue
		}
		f, err := os.Open(abs)
		if err != nil {
			w.logger.Printf("grn-photo-attach: open %s: %v", p.ID, err)
			continue
		}
		ct := p.ContentType
		if ct == "" {
			ct = "application/octet-stream"
		}
		if err := w.client.AppendSection(ctx, w.documentsCabinet, grnDocID, p.Filename, ct, f); err != nil {
			w.logger.Printf("grn-photo-attach: AppendSection photo=%s grn=%s: %v", p.ID, grnDocID, err)
		}
		f.Close()
	}
	return nil
}
