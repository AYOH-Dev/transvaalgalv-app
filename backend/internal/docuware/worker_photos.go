package docuware

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// queuedPhoto is a pending defect photo upload, joined with the line's
// DocuWare doc id (the upload target).
type queuedPhoto struct {
	PhotoID       string
	ReceiptID     string
	ReceiptLineID string
	Filename      string
	ContentType   string
	StorageKey    string
	AttemptCount  int
	DocuWareDocID string
}

const photoMaxAttempts = 6

// NotifyPendingPhoto wakes the worker so a freshly uploaded photo gets
// pushed without waiting for the next tick. Best-effort: a full channel
// means a wake is already pending, which is fine.
func (w *Worker) NotifyPendingPhoto(_ context.Context, _ string) error {
	if w == nil || w.wake == nil {
		return nil
	}
	select {
	case w.wake <- struct{}{}:
	default:
	}
	return nil
}

func (w *Worker) processPendingPhotos(ctx context.Context) {
	if strings.TrimSpace(w.photoStorageDir) == "" {
		return
	}

	limit := w.maxWorkers
	if limit <= 0 {
		limit = 3
	}

	photos, err := w.fetchPendingPhotos(ctx, limit)
	if err != nil {
		w.logger.Printf("fetch pending photos: %v", err)
		return
	}
	if len(photos) == 0 {
		return
	}

	w.logger.Printf("processing %d pending photo uploads", len(photos))

	for _, p := range photos {
		if err := w.markPhotoInProgress(ctx, p.PhotoID); err != nil {
			w.logger.Printf("mark photo in_progress (id=%s): %v", p.PhotoID, err)
			continue
		}

		err := w.uploadPhoto(ctx, p)
		if err == nil {
			if updErr := w.markPhotoSynced(ctx, p.PhotoID); updErr != nil {
				w.logger.Printf("mark photo synced (id=%s): %v", p.PhotoID, updErr)
			}
			w.logger.Printf("photo synced: id=%s line=%s", p.PhotoID, p.ReceiptLineID)
			continue
		}

		retryable := isRetryableUploadError(err)
		if updErr := w.markPhotoFailed(ctx, p, err, retryable); updErr != nil {
			w.logger.Printf("mark photo failed (id=%s): %v", p.PhotoID, updErr)
		}
		if retryable {
			w.logger.Printf("photo upload failed (retryable): id=%s attempt=%d/%d err=%v",
				p.PhotoID, p.AttemptCount+1, photoMaxAttempts, err)
		} else {
			w.logger.Printf("photo upload failed (permanent): id=%s err=%v", p.PhotoID, err)
		}
	}
}

func (w *Worker) fetchPendingPhotos(ctx context.Context, limit int) ([]queuedPhoto, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT
		    d.id::text,
		    d.receipt_id::text,
		    d.receipt_line_id::text,
		    d.filename,
		    d.content_type,
		    d.storage_key,
		    d.attempt_count,
		    COALESCE(NULLIF(l.docuware_doc_id, ''), l.docuware_record_line_id, '')
		FROM receipt_documents d
		JOIN receipt_lines l ON d.receipt_line_id = l.id
		WHERE d.category = 'defect_photo'
		  AND d.docuware_status IN ('pending', 'in_progress')
		  AND (d.next_retry_at IS NULL OR d.next_retry_at <= NOW())
		ORDER BY d.created_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("query pending photos: %w", err)
	}
	defer rows.Close()

	var photos []queuedPhoto
	for rows.Next() {
		var p queuedPhoto
		if err := rows.Scan(
			&p.PhotoID,
			&p.ReceiptID,
			&p.ReceiptLineID,
			&p.Filename,
			&p.ContentType,
			&p.StorageKey,
			&p.AttemptCount,
			&p.DocuWareDocID,
		); err != nil {
			return nil, fmt.Errorf("scan pending photo: %w", err)
		}
		photos = append(photos, p)
	}
	return photos, rows.Err()
}

func (w *Worker) markPhotoInProgress(ctx context.Context, photoID string) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE receipt_documents
		SET docuware_status = 'in_progress'
		WHERE id = $1::uuid AND docuware_status = 'pending'
	`, photoID)
	return err
}

func (w *Worker) markPhotoSynced(ctx context.Context, photoID string) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE receipt_documents
		SET docuware_status = 'synced',
		    docuware_error = '',
		    next_retry_at = NULL
		WHERE id = $1::uuid
	`, photoID)
	return err
}

func (w *Worker) markPhotoFailed(ctx context.Context, p queuedPhoto, cause error, retryable bool) error {
	newAttempt := p.AttemptCount + 1
	errMsg := cause.Error()
	if len(errMsg) > 1000 {
		errMsg = errMsg[:1000]
	}

	if !retryable || newAttempt >= photoMaxAttempts {
		_, err := w.pool.Exec(ctx, `
			UPDATE receipt_documents
			SET docuware_status = 'failed',
			    docuware_error = $2,
			    attempt_count = $3,
			    next_retry_at = NULL
			WHERE id = $1::uuid
		`, p.PhotoID, errMsg, newAttempt)
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
	`, p.PhotoID, errMsg, newAttempt, nextRetry)
	return err
}

func (w *Worker) uploadPhoto(ctx context.Context, p queuedPhoto) error {
	if strings.TrimSpace(p.DocuWareDocID) == "" {
		return errors.New("line has no docuware_doc_id; nothing to attach to")
	}

	abs, err := safeJoin(w.photoStorageDir, p.StorageKey)
	if err != nil {
		return err
	}
	f, err := os.Open(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return errors.New("photo file missing on disk")
		}
		return fmt.Errorf("open photo: %w", err)
	}
	defer f.Close()

	if err := w.client.AppendSection(ctx, w.client.cabinetID, p.DocuWareDocID, p.Filename, p.ContentType, f); err != nil {
		return err
	}
	return nil
}

func safeJoin(base, rel string) (string, error) {
	clean := filepath.Clean(rel)
	if filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
		return "", errors.New("invalid storage key")
	}
	abs := filepath.Join(base, clean)
	relCheck, err := filepath.Rel(base, abs)
	if err != nil || strings.HasPrefix(relCheck, "..") {
		return "", errors.New("storage key escapes base dir")
	}
	return abs, nil
}

// isRetryableUploadError treats network/server-5xx and DocuWare 429s as
// retryable; any other shape (including auth, 4xx-not-429, missing target)
// is treated as permanent so we don't keep retrying broken uploads.
func isRetryableUploadError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	if strings.Contains(msg, "section upload failed with status 5") {
		return true
	}
	if strings.Contains(msg, "status 429") {
		return true
	}
	if strings.Contains(msg, "section upload failed:") { // network error wrap
		return true
	}
	return false
}
