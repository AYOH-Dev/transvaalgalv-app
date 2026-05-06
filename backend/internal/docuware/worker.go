package docuware

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// QueuedSync represents a pending sync item from the queue table.
type QueuedSync struct {
	ID            string
	ReceiptID     string
	ReceiptLineID string
	AttemptCount  int
	MaxAttempts   int
	LastError     string
	NextRetryAt   *time.Time
	CreatedAt     time.Time

	// Line data for sync
	LineID                string
	DocuWareRecordLineID  string
	DocuWareDocID         string
	ItemType              string
	Process               string
	PackagingMethod       string
	InternalDescription   string
	RequiredGalvThickness string
	ReceivedQuantity      float64
	QuantityDiscrepancy   string
	Discrepancy           string
	ReceivingStatus       string
	StoredIn              string
	Bay                   string
	Accessories           string
	Comments              string
	ConditionNotes        string
	MaterialCode          string
	MaterialDescription   string
	MaterialSize          string
	MaterialMarkings      string
	MaterialThickness     string
	MaterialLength        string
	Weight                string

	// Receipt header data for sync
	CustomerName            string
	SupplierName            string
	DeliveryNoteNumber      string
	PurchaseOrderNumber     string
	WeighbridgeTicketNumber string
	VehicleRegistration     string
	JobNumber               string
	ReceivedByDisplayName   string
}

type Worker struct {
	pool         *pgxpool.Pool
	client       *Client
	logger       log.Logger
	pollInterval time.Duration
	maxWorkers   int

	photoStorageDir  string
	documentsCabinet string
	wake             chan struct{}
}

func NewWorker(pool *pgxpool.Pool, client *Client, logger log.Logger, pollInterval time.Duration, maxWorkers int) *Worker {
	return &Worker{
		pool:         pool,
		client:       client,
		logger:       logger,
		pollInterval: pollInterval,
		maxWorkers:   maxWorkers,
		wake:         make(chan struct{}, 1),
	}
}

// SetPhotoStorageDir tells the worker where to find captured photo files.
// Empty disables photo pushes.
func (w *Worker) SetPhotoStorageDir(dir string) { w.photoStorageDir = dir }

// SetDocumentsCabinet configures the cabinet id used when creating new
// GRN documents (the upstream Documents cabinet, not the operational
// Receiving Data cabinet). Empty disables GRN pushes.
func (w *Worker) SetDocumentsCabinet(cabinetID string) { w.documentsCabinet = cabinetID }

// NotifyPendingGRN wakes the worker so a freshly generated GRN gets
// pushed without waiting for the next tick.
func (w *Worker) NotifyPendingGRN(_ string) {
	if w == nil || w.wake == nil {
		return
	}
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

// Start begins the sync worker loop. It runs indefinitely, polling for pending syncs.
// This is meant to be run in a goroutine.
func (w *Worker) Start(ctx context.Context) {
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	w.logger.Printf("docuware sync worker started with poll interval %v, max workers %d", w.pollInterval, w.maxWorkers)

	for {
		select {
		case <-ctx.Done():
			w.logger.Printf("docuware sync worker shutting down")
			return
		case <-ticker.C:
			w.processPendingQueue(ctx)
			w.processPendingGRNs(ctx)
			w.processPendingPhotos(ctx)
			w.processPendingPODStatuses(ctx)
		case <-w.wake:
			w.processPendingGRNs(ctx)
			w.processPendingPhotos(ctx)
			w.processPendingPODStatuses(ctx)
		}
	}
}

func (w *Worker) processPendingQueue(ctx context.Context) {
	// Fetch up to maxWorkers pending/retryable items
	items, err := w.fetchPendingItems(ctx, w.maxWorkers)
	if err != nil {
		w.logger.Printf("fetch pending items: %v", err)
		return
	}

	if len(items) == 0 {
		return
	}

	w.logger.Printf("processing %d pending sync items", len(items))

	for _, item := range items {
		// Mark as in_progress
		if err := w.markInProgress(ctx, item.ID); err != nil {
			w.logger.Printf("mark in_progress (id=%s): %v", item.ID, err)
			continue
		}

		// Attempt sync
		result := w.syncItem(ctx, item)

		// Update queue and line based on result
		if err := w.updateAfterSync(ctx, item, result); err != nil {
			w.logger.Printf("update after sync (id=%s): %v", item.ID, err)
		}
	}
}

func (w *Worker) fetchPendingItems(ctx context.Context, limit int) ([]QueuedSync, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT
			q.id::text,
			q.receipt_id::text,
			q.receipt_line_id::text,
			q.attempt_count,
			q.max_attempts,
			q.last_error,
			q.next_retry_at,
			q.created_at,
			l.id::text,
			l.docuware_record_line_id,
			COALESCE(NULLIF(l.docuware_doc_id, ''), r.docuware_record_id),
			l.item_type,
			l.process,
			l.packaging_method,
			l.internal_description,
			l.required_galv_thickness,
			l.received_quantity,
			l.quantity_discrepancy,
			l.discrepancy,
			l.receiving_status,
			l.stored_in,
			l.bay,
			l.accessories,
			l.comments,
			l.condition_notes,
			l.material_code,
			l.material_description,
			l.material_size,
			l.material_markings,
			l.material_thickness,
			l.material_length,
			l.weight,
			l.received_by_name,
			r.customer_name,
			r.supplier_name,
			r.delivery_note_number,
			r.purchase_order_number,
			r.weighbridge_ticket_number,
			r.vehicle_registration,
			r.job_number
		FROM docuware_sync_queue q
		JOIN receipt_lines l ON q.receipt_line_id = l.id
		JOIN receipts r ON q.receipt_id = r.id
		WHERE q.status IN ('pending', 'in_progress')
		  AND (q.next_retry_at IS NULL OR q.next_retry_at <= NOW())
		ORDER BY q.created_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("query pending items: %w", err)
	}
	defer rows.Close()

	var items []QueuedSync
	for rows.Next() {
		var item QueuedSync
		var nextRetry sql.NullTime
		if err := rows.Scan(
			&item.ID,
			&item.ReceiptID,
			&item.ReceiptLineID,
			&item.AttemptCount,
			&item.MaxAttempts,
			&item.LastError,
			&nextRetry,
			&item.CreatedAt,
			&item.LineID,
			&item.DocuWareRecordLineID,
			&item.DocuWareDocID,
			&item.ItemType,
			&item.Process,
			&item.PackagingMethod,
			&item.InternalDescription,
			&item.RequiredGalvThickness,
			&item.ReceivedQuantity,
			&item.QuantityDiscrepancy,
			&item.Discrepancy,
			&item.ReceivingStatus,
			&item.StoredIn,
			&item.Bay,
			&item.Accessories,
			&item.Comments,
			&item.ConditionNotes,
			&item.MaterialCode,
			&item.MaterialDescription,
			&item.MaterialSize,
			&item.MaterialMarkings,
			&item.MaterialThickness,
			&item.MaterialLength,
			&item.Weight,
			&item.ReceivedByDisplayName,
			&item.CustomerName,
			&item.SupplierName,
			&item.DeliveryNoteNumber,
			&item.PurchaseOrderNumber,
			&item.WeighbridgeTicketNumber,
			&item.VehicleRegistration,
			&item.JobNumber,
		); err != nil {
			return nil, fmt.Errorf("scan pending item: %w", err)
		}
		if nextRetry.Valid {
			item.NextRetryAt = &nextRetry.Time
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (w *Worker) markInProgress(ctx context.Context, queueID string) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE docuware_sync_queue
		SET status = 'in_progress', updated_at = NOW()
		WHERE id = $1::uuid AND status = 'pending'
	`, queueID)
	return err
}

func (w *Worker) syncItem(ctx context.Context, item QueuedSync) SyncResult {
	result := SyncResult{
		LineID:       item.LineID,
		LastSyncedAt: time.Now().UTC(),
		Retryable:    false,
	}

	if item.DocuWareDocID == "" {
		result.Success = false
		result.Error = &SyncError{
			Timestamp: result.LastSyncedAt,
			Message:   "docuware_doc_id (DWDOCID) is empty",
		}
		return result
	}

	// Build field updates
	line := SyncableReceiptLine{
		ID:                    item.LineID,
		DocuWareRecordLineID:  item.DocuWareRecordLineID,
		ItemType:              item.ItemType,
		Process:               item.Process,
		PackagingMethod:       item.PackagingMethod,
		InternalDescription:   item.InternalDescription,
		RequiredGalvThickness: item.RequiredGalvThickness,
		ReceivedQuantity:      item.ReceivedQuantity,
		QuantityDiscrepancy:   item.QuantityDiscrepancy,
		Discrepancy:           item.Discrepancy,
		ReceivingStatus:       item.ReceivingStatus,
		StoredIn:              item.StoredIn,
		Bay:                   item.Bay,
		Accessories:           item.Accessories,
		Comments:              item.Comments,
		ConditionNotes:        item.ConditionNotes,
		MaterialCode:          item.MaterialCode,
		MaterialDescription:   item.MaterialDescription,
		MaterialSize:          item.MaterialSize,
		MaterialMarkings:      item.MaterialMarkings,
		MaterialThickness:     item.MaterialThickness,
		MaterialLength:        item.MaterialLength,
		Weight:                item.Weight,
		ReceivedByName:        item.ReceivedByDisplayName,
	}

	receipt := SyncableReceipt{
		CustomerName:            item.CustomerName,
		SupplierName:            item.SupplierName,
		DeliveryNoteNumber:      item.DeliveryNoteNumber,
		PurchaseOrderNumber:     item.PurchaseOrderNumber,
		WeighbridgeTicketNumber: item.WeighbridgeTicketNumber,
		VehicleRegistration:     item.VehicleRegistration,
		JobNumber:               item.JobNumber,
	}

	fields := BuildFieldUpdates(line, receipt)
	result.FieldCount = len(fields)

	// Attempt the update using the document ID (DWDOCID), not the line ID
	err := w.client.UpdateLineFields(ctx, item.DocuWareDocID, fields)
	if err == nil {
		result.Success = true
		return result
	}

	result.Success = false
	result.Error = &SyncError{
		Timestamp: result.LastSyncedAt,
		Message:   err.Error(),
	}

	// Determine if retryable (rough heuristic from error message)
	result.Retryable = IsRetryable(extractHTTPStatus(err.Error()), err.Error())

	return result
}

// extractHTTPStatus attempts to extract HTTP status code from an error message.
func extractHTTPStatus(errMsg string) int {
	if strings.Contains(errMsg, "status") {
		// Try to parse "status XXX" pattern
		parts := strings.Fields(errMsg)
		for i, p := range parts {
			if p == "status" && i+1 < len(parts) {
				var code int
				if _, err := fmt.Sscanf(parts[i+1], "%d", &code); err == nil {
					return code
				}
			}
		}
	}
	return 0
}

func (w *Worker) updateAfterSync(ctx context.Context, item QueuedSync, result SyncResult) error {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Update receipt_lines with sync state
	_, err = tx.Exec(ctx, `
		UPDATE receipt_lines
		SET last_synced_at = $2,
		    docuware_sync_error = $3,
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, item.ReceiptLineID, result.LastSyncedAt, errorMessage(result.Error))
	if err != nil {
		return fmt.Errorf("update receipt line: %w", err)
	}

	if result.Success {
		// Sync succeeded; mark as complete
		_, err = tx.Exec(ctx, `
			UPDATE docuware_sync_queue
			SET status = 'completed', updated_at = NOW()
			WHERE id = $1::uuid
		`, item.ID)
		if err != nil {
			return fmt.Errorf("mark completed: %w", err)
		}
	} else {
		// Sync failed
		newAttempt := item.AttemptCount + 1
		var nextRetry *time.Time

		if newAttempt >= item.MaxAttempts || !result.Retryable {
			// Max attempts reached or non-retryable error; mark as failed
			_, err = tx.Exec(ctx, `
				UPDATE docuware_sync_queue
				SET status = 'failed',
				    attempt_count = $2,
				    last_error = $3,
				    updated_at = NOW()
				WHERE id = $1::uuid
			`, item.ID, newAttempt, errorMessage(result.Error))
		} else {
			// Retryable; schedule next attempt with exponential backoff
			backoff := time.Duration(math.Pow(2, float64(newAttempt))) * time.Minute
			retryTime := time.Now().Add(backoff)
			nextRetry = &retryTime

			_, err = tx.Exec(ctx, `
				UPDATE docuware_sync_queue
				SET status = 'pending',
				    attempt_count = $2,
				    last_error = $3,
				    next_retry_at = $4,
				    updated_at = NOW()
				WHERE id = $1::uuid
			`, item.ID, newAttempt, errorMessage(result.Error), nextRetry)
		}

		if err != nil {
			return fmt.Errorf("update queue after failure: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	if result.Success {
		w.logger.Printf("sync completed: line_id=%s, fields=%d", item.LineID, result.FieldCount)
	} else if result.Retryable {
		w.logger.Printf("sync failed (retryable): line_id=%s, attempt=%d/%d, error=%s",
			item.LineID, item.AttemptCount+1, item.MaxAttempts, result.Error.Message)
	} else {
		w.logger.Printf("sync failed (permanent): line_id=%s, error=%s", item.LineID, result.Error.Message)
	}

	return nil
}

func errorMessage(err *SyncError) string {
	if err == nil {
		return ""
	}
	return err.Message
}

// EnqueueLineSync adds a receipt line to the sync queue if not already pending/in-progress.
func (w *Worker) EnqueueLineSync(ctx context.Context, receiptID, lineID string) error {
	var exists bool
	err := w.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM docuware_sync_queue
			WHERE receipt_line_id = $1::uuid
			  AND status IN ('pending', 'in_progress')
		)
	`, lineID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("check enqueue: %w", err)
	}

	if exists {
		return nil
	}

	_, err = w.pool.Exec(ctx, `
		INSERT INTO docuware_sync_queue (receipt_id, receipt_line_id)
		VALUES ($1::uuid, $2::uuid)
	`, receiptID, lineID)
	if err != nil {
		return fmt.Errorf("enqueue line sync: %w", err)
	}
	return nil
}

// SyncLineNow syncs a receipt line to DocuWare immediately (blocking).
func (w *Worker) SyncLineNow(ctx context.Context, receiptID, lineID string) error {
	items, err := w.pool.Query(ctx, `
		SELECT
			l.id::text,
			l.receipt_id::text,
			l.id::text,
			0,
			5,
			'',
			NULL,
			NOW(),
			l.id::text,
			l.docuware_record_line_id,
			COALESCE(NULLIF(l.docuware_doc_id, ''), r.docuware_record_id),
			l.item_type,
			l.process,
			l.packaging_method,
			l.internal_description,
			l.required_galv_thickness,
			l.received_quantity,
			l.quantity_discrepancy,
			l.discrepancy,
			l.receiving_status,
			l.stored_in,
			l.bay,
			l.accessories,
			l.comments,
			l.condition_notes,
			l.material_code,
			l.material_description,
			l.material_size,
			l.material_markings,
			l.material_thickness,
			l.material_length,
			l.weight,
			l.received_by_name,
			r.customer_name,
			r.supplier_name,
			r.delivery_note_number,
			r.purchase_order_number,
			r.weighbridge_ticket_number,
			r.vehicle_registration,
			r.job_number,
			COALESCE(NULLIF(l.docuware_doc_id, ''), r.docuware_record_id)
		FROM receipt_lines l
		JOIN receipts r ON l.receipt_id = r.id
		WHERE l.id = $1::uuid AND r.id = $2::uuid
	`, lineID, receiptID)
	if err != nil {
		return fmt.Errorf("query line: %w", err)
	}
	defer items.Close()

	if !items.Next() {
		return fmt.Errorf("line not found")
	}

	var item QueuedSync
	var nextRetry sql.NullTime
	if err := items.Scan(
		&item.ID,
		&item.ReceiptID,
		&item.ReceiptLineID,
		&item.AttemptCount,
		&item.MaxAttempts,
		&item.LastError,
		&nextRetry,
		&item.CreatedAt,
		&item.LineID,
		&item.DocuWareRecordLineID,
		&item.DocuWareDocID,
		&item.ItemType,
		&item.Process,
		&item.PackagingMethod,
		&item.InternalDescription,
		&item.RequiredGalvThickness,
		&item.ReceivedQuantity,
		&item.QuantityDiscrepancy,
		&item.Discrepancy,
		&item.ReceivingStatus,
		&item.StoredIn,
		&item.Bay,
		&item.Accessories,
		&item.Comments,
		&item.ConditionNotes,
		&item.MaterialCode,
		&item.MaterialDescription,
		&item.MaterialSize,
		&item.MaterialMarkings,
		&item.MaterialThickness,
		&item.MaterialLength,
		&item.Weight,
		&item.ReceivedByDisplayName,
		&item.CustomerName,
		&item.SupplierName,
		&item.DeliveryNoteNumber,
		&item.PurchaseOrderNumber,
		&item.WeighbridgeTicketNumber,
		&item.VehicleRegistration,
		&item.JobNumber,
		&item.DocuWareDocID,
	); err != nil {
		return fmt.Errorf("scan line: %w", err)
	}

	// Sync immediately
	result := w.syncItem(ctx, item)

	if !result.Success {
		return fmt.Errorf("sync failed: %s", result.Error.Message)
	}

	if _, err := w.pool.Exec(ctx, `
		UPDATE receipt_lines
		SET last_synced_at = $2,
		    docuware_sync_error = '',
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, item.ReceiptLineID, result.LastSyncedAt); err != nil {
		w.logger.Printf("warn: sync succeeded but failed to persist last_synced_at for line %s: %v", item.LineID, err)
	}

	w.logger.Printf("sync completed immediately: line_id=%s, fields=%d", item.LineID, result.FieldCount)
	return nil
}
