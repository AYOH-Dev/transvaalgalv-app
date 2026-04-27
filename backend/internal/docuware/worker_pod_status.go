package docuware

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

// Dialog id for the Documents (POD) cabinet field-update endpoint.
// Hardcoded per current configuration; if a second tenant lands we'll
// move this to config alongside DOCUWARE_POD_CABINET_ID.
const podStatusDialogID = "0e8d599f-e745-44dd-bc92-207f8522fe39"

// queuedPODStatus is a pending POD-status update, joined with the receipt's
// source POD doc id (the upstream Documents-cabinet record).
type queuedPODStatus struct {
	QueueID        string
	ReceiptID      string
	DesiredStatus  string
	AttemptCount   int
	MaxAttempts    int
	PODDocID       string
}

// EnqueuePODStatusUpdate inserts (or upserts) a pending row in
// docuware_pod_status_queue for the given receipt. If a row already exists
// for the same receipt in pending/in_progress, its desired_status is
// overwritten so the worker pushes the latest value rather than a stale
// queued one. Implements receiving.PODStatusEnqueuer.
func (w *Worker) EnqueuePODStatusUpdate(ctx context.Context, receiptID, desiredStatus string) error {
	if w == nil || w.pool == nil {
		return nil
	}
	if strings.TrimSpace(receiptID) == "" || strings.TrimSpace(desiredStatus) == "" {
		return nil
	}

	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin pod-status enqueue tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// If an active row already exists for this receipt, update its desired
	// status (the partial unique index enforces only one active per receipt).
	tag, err := tx.Exec(ctx, `
		UPDATE docuware_pod_status_queue
		SET desired_status = $2,
		    updated_at = NOW(),
		    next_retry_at = NULL,
		    last_error = ''
		WHERE receipt_id = $1::uuid
		  AND status IN ('pending', 'in_progress')
	`, receiptID, desiredStatus)
	if err != nil {
		return fmt.Errorf("update existing pod-status row: %w", err)
	}

	if tag.RowsAffected() == 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO docuware_pod_status_queue (receipt_id, desired_status, status)
			VALUES ($1::uuid, $2, 'pending')
		`, receiptID, desiredStatus); err != nil {
			return fmt.Errorf("insert pod-status row: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit pod-status enqueue: %w", err)
	}

	// Wake the worker so the push happens immediately on online tablets,
	// not only on the next poll tick.
	select {
	case w.wake <- struct{}{}:
	default:
	}
	return nil
}

func (w *Worker) processPendingPODStatuses(ctx context.Context) {
	if strings.TrimSpace(w.documentsCabinet) == "" {
		return
	}

	limit := w.maxWorkers
	if limit <= 0 {
		limit = 3
	}

	rows, err := w.fetchPendingPODStatuses(ctx, limit)
	if err != nil {
		w.logger.Printf("fetch pending pod statuses: %v", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	w.logger.Printf("processing %d pending pod status updates", len(rows))

	for _, item := range rows {
		if err := w.markPODStatusInProgress(ctx, item.QueueID); err != nil {
			w.logger.Printf("mark pod-status in_progress (id=%s): %v", item.QueueID, err)
			continue
		}

		err := w.pushPODStatus(ctx, item)
		if err == nil {
			if uErr := w.markPODStatusSynced(ctx, item); uErr != nil {
				w.logger.Printf("mark pod-status synced (id=%s): %v", item.QueueID, uErr)
				continue
			}
			w.logger.Printf("pod status synced: receipt=%s status=%q doc=%s",
				item.ReceiptID, item.DesiredStatus, item.PODDocID)
			continue
		}

		retryable := isRetryableUploadError(err)
		if uErr := w.markPODStatusFailed(ctx, item, err, retryable); uErr != nil {
			w.logger.Printf("mark pod-status failed (id=%s): %v", item.QueueID, uErr)
		}
		if retryable {
			w.logger.Printf("pod status push failed (retryable): receipt=%s attempt=%d/%d err=%v",
				item.ReceiptID, item.AttemptCount+1, item.MaxAttempts, err)
		} else {
			w.logger.Printf("pod status push failed (permanent): receipt=%s err=%v", item.ReceiptID, err)
		}
	}
}

func (w *Worker) fetchPendingPODStatuses(ctx context.Context, limit int) ([]queuedPODStatus, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT
		    q.id::text,
		    q.receipt_id::text,
		    q.desired_status,
		    q.attempt_count,
		    q.max_attempts,
		    r.source_docuware_document_id
		FROM docuware_pod_status_queue q
		JOIN receipts r ON q.receipt_id = r.id
		WHERE q.status IN ('pending', 'in_progress')
		  AND (q.next_retry_at IS NULL OR q.next_retry_at <= NOW())
		ORDER BY q.created_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("query pending pod statuses: %w", err)
	}
	defer rows.Close()

	var out []queuedPODStatus
	for rows.Next() {
		var q queuedPODStatus
		if err := rows.Scan(
			&q.QueueID,
			&q.ReceiptID,
			&q.DesiredStatus,
			&q.AttemptCount,
			&q.MaxAttempts,
			&q.PODDocID,
		); err != nil {
			return nil, fmt.Errorf("scan pending pod status: %w", err)
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

func (w *Worker) markPODStatusInProgress(ctx context.Context, queueID string) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE docuware_pod_status_queue
		SET status = 'in_progress', updated_at = NOW()
		WHERE id = $1::uuid AND status = 'pending'
	`, queueID)
	return err
}

func (w *Worker) markPODStatusSynced(ctx context.Context, q queuedPODStatus) error {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin pod-status synced tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		UPDATE docuware_pod_status_queue
		SET status = 'completed',
		    last_error = '',
		    next_retry_at = NULL,
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, q.QueueID); err != nil {
		return fmt.Errorf("update queue row: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE receipts
		SET docuware_pod_status = $2,
		    docuware_pod_status_synced_at = NOW(),
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, q.ReceiptID, q.DesiredStatus); err != nil {
		return fmt.Errorf("update receipt: %w", err)
	}

	return tx.Commit(ctx)
}

func (w *Worker) markPODStatusFailed(ctx context.Context, q queuedPODStatus, cause error, retryable bool) error {
	newAttempt := q.AttemptCount + 1
	errMsg := cause.Error()
	if len(errMsg) > 1000 {
		errMsg = errMsg[:1000]
	}

	if !retryable || newAttempt >= q.MaxAttempts {
		_, err := w.pool.Exec(ctx, `
			UPDATE docuware_pod_status_queue
			SET status = 'failed',
			    last_error = $2,
			    attempt_count = $3,
			    next_retry_at = NULL,
			    updated_at = NOW()
			WHERE id = $1::uuid
		`, q.QueueID, errMsg, newAttempt)
		return err
	}

	backoff := time.Duration(math.Pow(2, float64(newAttempt))) * time.Minute
	nextRetry := time.Now().Add(backoff)
	_, err := w.pool.Exec(ctx, `
		UPDATE docuware_pod_status_queue
		SET status = 'pending',
		    last_error = $2,
		    attempt_count = $3,
		    next_retry_at = $4,
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, q.QueueID, errMsg, newAttempt, nextRetry)
	return err
}

func (w *Worker) pushPODStatus(ctx context.Context, q queuedPODStatus) error {
	if strings.TrimSpace(q.PODDocID) == "" {
		return errors.New("receipt has no source POD doc id; nothing to update")
	}
	fields := []FieldUpdate{
		{
			FieldName: "STATUS",
			Item:      q.DesiredStatus,
		},
	}
	return w.client.UpdateDocumentFields(ctx, w.documentsCabinet, q.PODDocID, fields, podStatusDialogID)
}
