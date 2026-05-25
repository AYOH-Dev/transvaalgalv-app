package receiving

// POD-status sync — when lines on a receipt are marked received, the
// upstream POD document in the Documents cabinet should reflect progress:
//
//   - any line received, not all   → "Partially Received"
//   - every line received          → "Received"
//   - no lines received yet        → "" (no push; we don't reset back to blank)
//
// The receipt's own status enum (draft/received/matched/...) is the app-side
// lifecycle and stays unchanged. This is purely about the customer-visible
// POD record in DocuWare.
//
// Day-forward only: existing receipts get '' for docuware_pod_status and
// the next line state change re-computes & pushes the correct value.

import (
	"context"
	"fmt"
)

// POD STATUS values, sent verbatim to DocuWare's STATUS field on the
// Documents cabinet. The field is a 20-char text; both fit within that.
const (
	PODStatusPartiallyReceived = "Partially Received"
	PODStatusReceived          = "Received"
)

// PODStatusEnqueuer is implemented by the docuware Worker and exposes the
// "queue this status push" entry point used by the service.
type PODStatusEnqueuer interface {
	EnqueuePODStatusUpdate(ctx context.Context, receiptID, desiredStatus string) error
}

// computePODStatus returns the desired POD status given the line state of
// a receipt. Returns an empty string when no push is appropriate (no lines
// received yet, or no lines at all).
func computePODStatus(lines []ReceiptLine) string {
	if len(lines) == 0 {
		return ""
	}
	receivedCount := 0
	for _, l := range lines {
		if l.ReceivingStatus == "received" || l.ReceivingStatus == "reviewed" {
			receivedCount++
		}
	}
	switch {
	case receivedCount == 0:
		return ""
	case receivedCount == len(lines):
		return PODStatusReceived
	default:
		return PODStatusPartiallyReceived
	}
}

// MaybeUpdatePODStatus computes the desired POD status and enqueues a
// DocuWare update iff it has changed from the last-pushed value. Safe to
// call after any line state change. Silently no-ops when the receipt has
// no source POD doc id.
func (s *Service) MaybeUpdatePODStatus(ctx context.Context, receiptID string) error {
	if s == nil || s.repository == nil || s.podStatusEnqueuer == nil {
		return nil
	}
	receipt, err := s.repository.GetReceipt(ctx, receiptID)
	if err != nil {
		return fmt.Errorf("get receipt for pod status: %w", err)
	}
	if receipt.SourceDocuWareDocument == "" {
		// No POD doc to update — likely an app-created GRN, not an
		// imported delivery. Nothing to do.
		return nil
	}
	desired := computePODStatus(receipt.Lines)
	if desired == "" {
		return nil
	}
	if desired == receipt.DocuWarePODStatus {
		// Already at this status — no need to push again.
		return nil
	}
	return s.podStatusEnqueuer.EnqueuePODStatusUpdate(ctx, receiptID, desired)
}
