package receiving

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Repository interface {
	ListReceipts(ctx context.Context, includeArchived bool) ([]Receipt, error)
	GetReceipt(ctx context.Context, id string) (Receipt, error)
	ImportDocuWareReceipts(ctx context.Context, receipts []importedReceipt) ([]Receipt, error)
	CreateReceipt(ctx context.Context, receipt importedReceipt) (Receipt, error)
	UpdateReceipt(ctx context.Context, id string, input UpdateReceiptInput) (Receipt, error)
	UpdateReceiptLine(ctx context.Context, receiptID, lineID string, input UpdateReceiptLineInput) (ReceiptLine, error)
	MarkLinesReceivedAfterGRN(ctx context.Context, receiptID string) error
	ArchiveStaleMatched(ctx context.Context, olderThan time.Duration) (int64, error)
}

type Service struct {
	repository        Repository
	syncEnqueuer      SyncEnqueuer
	grnService        *GRNService
	grnPushNotify     func(receiptID string)
	podStatusEnqueuer PODStatusEnqueuer
}

type SyncEnqueuer interface {
	EnqueueLineSync(ctx context.Context, receiptID, lineID string) error
	SyncLineNow(ctx context.Context, receiptID, lineID string) error
}

type importedReceipt struct {
	ReceiptNumber           string
	SupplierName            string
	CustomerName            string
	SupplierReference       string
	PurchaseOrderNumber     string
	DeliveryNoteNumber      string
	WeighbridgeTicketNumber string
	VehicleRegistration     string
	JobNumber               string
	SourceDocuWareDocument  string
	SourceDocuWareCabinet   string
	DocuWareRecordID        string
	DocuWareGroupReference  string
	DocuWareDocURL          string
	ReceivedAt              time.Time
	ReceivedByUserID        string
	ReceivedByName          string
	Status                  ReceiptStatus
	SyncStatus              string
	Notes                   string
	SourcePayload           map[string]any
	Lines                   []importedReceiptLine
}

type importedReceiptLine struct {
	LineNumber          int
	ItemCode            string
	Description         string
	MaterialCode        string
	MaterialDescription string
	MaterialSize        string
	MaterialMarkings    string
	MaterialThickness   string
	MaterialLength      string
	Weight              string
	Process             string
	StoredIn            string
	Bay                 string
	ExpectedQuantity    float64
	ReceivedQuantity    float64
	UnitOfMeasure       string
	ReceivingStatus     string
	Discrepancy         string
	QuantityDiscrepancy string
	ConditionNotes      string
	JobNumber           string
	DocuWareRecordLine  string
	DocuWareUniqueNo    string
	DocuWarePrimaryKey  string
	DocuWareDocID       string
	SourcePayload       map[string]any
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository, syncEnqueuer: nil}
}

func (s *Service) SetSyncEnqueuer(enqueuer SyncEnqueuer) {
	s.syncEnqueuer = enqueuer
}

// SetGRNService wires the GRN PDF generator. When configured, the service
// auto-generates a GRN PDF and queues the DocuWare push on receipt status
// transitions to 'matched'. Optional — if nil, GRN generation is skipped.
func (s *Service) SetGRNService(g *GRNService, pushNotify func(receiptID string)) {
	s.grnService = g
	s.grnPushNotify = pushNotify
}

// SetPODStatusEnqueuer wires the POD-status sync. When configured, line
// state changes recompute the POD's "Partially Received"/"Received"
// status and enqueue a DocuWare update if it has changed.
func (s *Service) SetPODStatusEnqueuer(e PODStatusEnqueuer) {
	s.podStatusEnqueuer = e
}

func (s *Service) EnqueueLineSync(ctx context.Context, receiptID, lineID string) error {
	if s.syncEnqueuer == nil {
		return fmt.Errorf("%w: sync enqueuer not configured", ErrUnavailable)
	}
	return s.syncEnqueuer.EnqueueLineSync(ctx, receiptID, lineID)
}

func (s *Service) ListReceipts(ctx context.Context, includeArchived bool) ([]Receipt, error) {
	if s.repository == nil {
		return []Receipt{}, nil
	}

	return s.repository.ListReceipts(ctx, includeArchived)
}

func (s *Service) GetReceipt(ctx context.Context, id string) (Receipt, error) {
	if s.repository == nil {
		return Receipt{}, ErrUnavailable
	}

	if strings.TrimSpace(id) == "" {
		return Receipt{}, fmt.Errorf("%w: receipt id is required", ErrInvalidInput)
	}

	return s.repository.GetReceipt(ctx, id)
}

func (s *Service) ImportDocuWareRows(ctx context.Context, input DocuWareImportInput) (DocuWareImportResult, error) {
	if s.repository == nil {
		return DocuWareImportResult{}, ErrUnavailable
	}

	if len(input.Rows) == 0 {
		return DocuWareImportResult{}, fmt.Errorf("%w: at least one row is required", ErrInvalidInput)
	}

	grouped := map[string]*importedReceipt{}
	groupOrder := []string{}
	groupLineCount := map[string]int{}
	seenUniqueNumbers := map[string]bool{} // Deduplicate by UNIQUE_NUMBER (the true business key)

	for _, row := range input.Rows {
		payload := clonePayload(row.Payload)
		if len(payload) == 0 {
			return DocuWareImportResult{}, fmt.Errorf("%w: payload is required for every row", ErrInvalidInput)
		}

		recordID := firstNonEmpty(strings.TrimSpace(row.RecordID), payloadString(payload, "DWDOCID"))
		if recordID == "" {
			return DocuWareImportResult{}, fmt.Errorf("%w: record_id or payload.DWDOCID is required", ErrInvalidInput)
		}

		groupReference := buildGroupReference(payload)
		if groupReference == "" {
			return DocuWareImportResult{}, fmt.Errorf("%w: could not derive a receipt grouping key", ErrInvalidInput)
		}

		// Skip duplicate lines by UNIQUE_NUMBER (the most unique field to the solution)
		uniqueNumber := payloadString(payload, "UNIQUE_NUMBER")
		if uniqueNumber != "" && seenUniqueNumbers[uniqueNumber] {
			continue
		}
		if uniqueNumber != "" {
			seenUniqueNumbers[uniqueNumber] = true
		}

		receipt, ok := grouped[groupReference]
		if !ok {
			receipt = buildImportedReceipt(input, groupReference, payload)
			grouped[groupReference] = receipt
			groupOrder = append(groupOrder, groupReference)
		}

		groupLineCount[groupReference]++
		receipt.Lines = append(receipt.Lines, buildImportedLine(payload, recordID, groupLineCount[groupReference]))
	}

	imports := make([]importedReceipt, 0, len(groupOrder))
	for _, key := range groupOrder {
		receipt := grouped[key]
		sort.Slice(receipt.Lines, func(i, j int) bool {
			if receipt.Lines[i].LineNumber == receipt.Lines[j].LineNumber {
				return receipt.Lines[i].DocuWareRecordLine < receipt.Lines[j].DocuWareRecordLine
			}
			return receipt.Lines[i].LineNumber < receipt.Lines[j].LineNumber
		})
		imports = append(imports, *receipt)
	}

	receipts, err := s.repository.ImportDocuWareReceipts(ctx, imports)
	if err != nil {
		return DocuWareImportResult{}, err
	}

	// Enqueue sync-back for every imported line. The queue worker picks these up
	// off the request path, which matters when DocuWare pushes many docs concurrently:
	// inline syncing caused O(N²) calls (each doc re-syncing the whole receipt) and
	// context-cancellation storms. EnqueueLineSync is idempotent on (receipt,line).
	if s.syncEnqueuer != nil {
		for _, receipt := range receipts {
			for _, line := range receipt.Lines {
				if err := s.syncEnqueuer.EnqueueLineSync(ctx, receipt.ID, line.ID); err != nil {
					log.Printf("enqueue sync failed for line %s: %v", line.ID, err)
				}
			}
		}
	}

	return DocuWareImportResult{
		ImportedReceiptCount: len(receipts),
		ImportedRowCount:     len(input.Rows),
		Receipts:             receipts,
	}, nil
}

// CreateGRN captures a Goods Received Note for an arrival without a pre-imported
// POD (after-hours capture, walk-in deliveries, or any case where the customer
// didn't supply paperwork up front). Saves a fresh receipt with status=draft
// and sync_status=pending_grn_upload — a follow-up worker pushes the generated
// GRN document to the DocuWare Documents cabinet (not yet implemented).
//
// GRN-originated receipts use a GRN- prefixed receipt_number to avoid colliding
// with the receipt_number scheme used by DocuWare POD imports (see
// buildReceiptNumber).
func (s *Service) CreateGRN(ctx context.Context, input CreateGRNInput) (Receipt, error) {
	if s.repository == nil {
		return Receipt{}, ErrUnavailable
	}

	deliveryNote := strings.TrimSpace(input.DeliveryNoteNumber)
	orderNumber := strings.TrimSpace(input.OrderNumber)
	vehicleReg := strings.TrimSpace(input.VehicleRegistration)
	weighbridge := strings.TrimSpace(input.WeighbridgeTicketNumber)
	company := strings.TrimSpace(input.Company)
	storedBy := strings.TrimSpace(input.StoredBy)

	if deliveryNote == "" {
		return Receipt{}, fmt.Errorf("%w: delivery_note_number is required", ErrInvalidInput)
	}
	if orderNumber == "" {
		return Receipt{}, fmt.Errorf("%w: order_number is required", ErrInvalidInput)
	}
	if vehicleReg == "" {
		return Receipt{}, fmt.Errorf("%w: vehicle_registration is required", ErrInvalidInput)
	}
	if weighbridge == "" {
		return Receipt{}, fmt.Errorf("%w: weighbridge_ticket_number is required", ErrInvalidInput)
	}
	if company == "" {
		return Receipt{}, fmt.Errorf("%w: company is required", ErrInvalidInput)
	}
	if storedBy == "" {
		return Receipt{}, fmt.Errorf("%w: stored_by is required", ErrInvalidInput)
	}
	if len(input.Lines) == 0 {
		return Receipt{}, fmt.Errorf("%w: at least one line is required", ErrInvalidInput)
	}

	deliveryDate := parseFormDate(input.DeliveryDate)
	if deliveryDate.IsZero() {
		deliveryDate = time.Now().UTC()
	}

	notes := buildGRNNotes(input)

	lines := make([]importedReceiptLine, 0, len(input.Lines))
	for index, raw := range input.Lines {
		quantity, _ := floatValue(raw.ItemQuantity)
		if quantity < 0 {
			return Receipt{}, fmt.Errorf("%w: line %d quantity must be non-negative", ErrInvalidInput, index+1)
		}

		lineDeliveryNote := firstNonEmpty(strings.TrimSpace(raw.DeliveryNote), deliveryNote)
		itemCode := strings.TrimSpace(raw.ItemCode)
		description := firstNonEmpty(strings.TrimSpace(raw.ItemDescription), itemCode)

		lines = append(lines, importedReceiptLine{
			LineNumber:       index + 1,
			ItemCode:         itemCode,
			Description:      description,
			MaterialSize:     strings.TrimSpace(raw.ItemSize),
			MaterialMarkings: strings.TrimSpace(raw.MaterialMarkings),
			MaterialLength:   strings.TrimSpace(raw.MaterialLength),
			Weight:           strings.TrimSpace(raw.Weight),
			JobNumber:        strings.TrimSpace(raw.JobNumber),
			ExpectedQuantity: quantity,
			ReceivingStatus:  "draft",
			SourcePayload: map[string]any{
				"source":            "manual_pod",
				"delivery_note":     lineDeliveryNote,
				"item_code":         itemCode,
				"item_description":  description,
				"item_size":         strings.TrimSpace(raw.ItemSize),
				"item_quantity":     strings.TrimSpace(raw.ItemQuantity),
				"weight":            strings.TrimSpace(raw.Weight),
				"material_markings": strings.TrimSpace(raw.MaterialMarkings),
				"material_length":   strings.TrimSpace(raw.MaterialLength),
				"job_number":        strings.TrimSpace(raw.JobNumber),
				"other":             strings.TrimSpace(raw.Other),
			},
		})
	}

	receipt := importedReceipt{
		ReceiptNumber:           buildGRNReceiptNumber(deliveryNote, weighbridge),
		SupplierName:            firstNonEmpty(strings.TrimSpace(input.Fabricator), company),
		CustomerName:            company,
		SupplierReference:       deliveryNote,
		PurchaseOrderNumber:     orderNumber,
		DeliveryNoteNumber:      deliveryNote,
		WeighbridgeTicketNumber: weighbridge,
		VehicleRegistration:     vehicleReg,
		ReceivedAt:              deliveryDate,
		ReceivedByUserID:        strings.TrimSpace(input.ReceivedByUserID),
		ReceivedByName:          strings.TrimSpace(input.ReceivedByName),
		Status:                  ReceiptStatusDraft,
		SyncStatus:              "pending_grn_upload",
		Notes:                   notes,
		SourcePayload: map[string]any{
			"source":                    "manual_pod",
			"delivery_note_number":      deliveryNote,
			"order_number":              orderNumber,
			"weighbridge_ticket_number": weighbridge,
			"vehicle_registration":      vehicleReg,
			"company":                   company,
			"fabricator":                strings.TrimSpace(input.Fabricator),
			"product_name":              strings.TrimSpace(input.ProductName),
			"processing_status":         strings.TrimSpace(input.ProcessingStatus),
			"stored_by":                 storedBy,
			"completion_date":           strings.TrimSpace(input.CompletionDate),
			"job_comments":              strings.TrimSpace(input.JobComments),
		},
		Lines: lines,
	}

	created, err := s.repository.CreateReceipt(ctx, receipt)
	if err != nil {
		return Receipt{}, err
	}

	// Enqueue DocuWare sync for each line so records are created in the
	// Receiving Data cabinet. The worker creates new DocuWare documents for
	// lines that have no docuware_doc_id (all GRN-originated lines).
	if s.syncEnqueuer != nil {
		for _, l := range created.Lines {
			if err := s.syncEnqueuer.EnqueueLineSync(ctx, created.ID, l.ID); err != nil {
				log.Printf("warn: failed to enqueue line sync after GRN create (receipt=%s, line=%s): %v", created.ID, l.ID, err)
			}
		}
	}

	log.Printf("[create-pod] receipt=%s lines=%d — queued %d DocuWare line syncs", created.ID, len(created.Lines), len(created.Lines))

	return created, nil
}

// buildGRNReceiptNumber yields a stable, collision-free receipt_number for
// GRN-originated receipts. The GRN- prefix keeps these out of the auto-merge
// path that DocuWare POD imports use (which upserts on receipt_number).
func buildGRNReceiptNumber(deliveryNote, weighbridge string) string {
	base := firstNonEmpty(deliveryNote, weighbridge, "grn")
	base = strings.ToUpper(slugify(base))
	if len(base) > 24 {
		base = base[:24]
	}
	digest := sha1.Sum([]byte(deliveryNote + "|" + weighbridge + "|" + time.Now().UTC().Format(time.RFC3339Nano)))
	return fmt.Sprintf("GRN-%s-%s", base, strings.ToUpper(hex.EncodeToString(digest[:4])))
}

// parseFormDate accepts the YYYY-MM-DD date strings the form sends.
func parseFormDate(value string) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	if parsed, err := time.Parse("2006-01-02", value); err == nil {
		return parsed
	}
	return time.Time{}
}

// buildGRNNotes folds the free-text fields the form captures into a single
// notes string we can render on the receipt detail page.
func buildGRNNotes(input CreateGRNInput) string {
	parts := []string{}
	if comments := strings.TrimSpace(input.JobComments); comments != "" {
		parts = append(parts, "Job comments: "+comments)
	}
	if storedBy := strings.TrimSpace(input.StoredBy); storedBy != "" {
		parts = append(parts, "Stored by: "+storedBy)
	}
	if productName := strings.TrimSpace(input.ProductName); productName != "" {
		parts = append(parts, "Product: "+productName)
	}
	if status := strings.TrimSpace(input.ProcessingStatus); status != "" {
		parts = append(parts, "Processing status: "+status)
	}
	if completion := strings.TrimSpace(input.CompletionDate); completion != "" {
		parts = append(parts, "Completion date: "+completion)
	}
	return strings.Join(parts, "\n")
}

var validStatusTransitions = map[ReceiptStatus][]ReceiptStatus{
	ReceiptStatusDraft:       {ReceiptStatusReceived},
	ReceiptStatusReceived:    {ReceiptStatusMatched, ReceiptStatusQualityHold},
	ReceiptStatusQualityHold: {ReceiptStatusReceived, ReceiptStatusMatched},
	ReceiptStatusMatched:     {ReceiptStatusArchived},
	ReceiptStatusArchived:    {},
}

// UpdateReceiptResult is what UpdateReceipt returns. ResyncedLines counts how
// many already-synced lines were re-enqueued because the caller changed a
// receipt-header field — this gives the UI something to surface to the user.
type UpdateReceiptResult struct {
	Receipt       Receipt
	ResyncedLines int
}

func (s *Service) UpdateReceipt(ctx context.Context, id string, input UpdateReceiptInput) (UpdateReceiptResult, error) {
	if s.repository == nil {
		return UpdateReceiptResult{}, ErrUnavailable
	}

	if strings.TrimSpace(id) == "" {
		return UpdateReceiptResult{}, fmt.Errorf("%w: receipt id is required", ErrInvalidInput)
	}

	if input.Status != nil {
		current, err := s.repository.GetReceipt(ctx, id)
		if err != nil {
			return UpdateReceiptResult{}, err
		}

		allowed := validStatusTransitions[current.Status]
		ok := false
		for _, s := range allowed {
			if s == *input.Status {
				ok = true
				break
			}
		}
		if !ok {
			return UpdateReceiptResult{}, fmt.Errorf("%w: cannot transition from %s to %s", ErrInvalidInput, current.Status, *input.Status)
		}
	}

	receipt, err := s.repository.UpdateReceipt(ctx, id, input)
	if err != nil {
		return UpdateReceiptResult{}, err
	}

	resynced := 0

	// Enqueue syncs for all lines when status changes (sync back to DocuWare)
	if input.Status != nil && s.syncEnqueuer != nil {
		for _, line := range receipt.Lines {
			_ = s.syncEnqueuer.EnqueueLineSync(ctx, receipt.ID, line.ID)
		}
	}

	// Status -> 'matched': generate the GRN PDF + queue a DocuWare push.
	// Idempotent — MaybeGenerate is a no-op if a GRN already exists.
	if input.Status != nil && *input.Status == ReceiptStatusMatched {
		// Upgrade reviewed → received: GRN issuance finalises all checked lines.
		if err := s.repository.MarkLinesReceivedAfterGRN(ctx, receipt.ID); err != nil {
			log.Printf("warn: failed to mark reviewed lines received after GRN (receipt=%s): %v", receipt.ID, err)
		} else if s.syncEnqueuer != nil {
			// Re-enqueue syncs so DocuWare RECEIVING_STATUS reflects "Received".
			for _, line := range receipt.Lines {
				_ = s.syncEnqueuer.EnqueueLineSync(ctx, receipt.ID, line.ID)
			}
		}
		if s.grnService != nil {
			if err := s.grnService.MaybeGenerate(ctx, receipt.ID); err != nil {
				// Log only — we don't fail the user's status update because the
				// GRN can be regenerated later (manual retry, or a re-trigger
				// once the underlying issue is fixed).
				log.Printf("grn generation failed for receipt %s: %v", receipt.ID, err)
			} else if s.grnPushNotify != nil {
				s.grnPushNotify(receipt.ID)
			}
		}
	}

	// Header-field edits propagate to lines via the worker — receipts captured
	// from the POD often have wrong header data and the receiver fixes it after
	// some lines have already been pushed. Re-enqueue every already-synced line
	// so the worker re-snapshots the corrected header onto its DocuWare doc.
	if hasHeaderFieldChange(input) && s.syncEnqueuer != nil {
		for _, line := range receipt.Lines {
			if line.LastSyncedAt == nil {
				continue
			}
			if err := s.syncEnqueuer.EnqueueLineSync(ctx, receipt.ID, line.ID); err == nil {
				resynced++
			}
		}
	}

	return UpdateReceiptResult{Receipt: receipt, ResyncedLines: resynced}, nil
}

// hasHeaderFieldChange returns true if the caller is editing any receipt-level
// field that gets snapshotted onto each line's DocuWare document.
func hasHeaderFieldChange(input UpdateReceiptInput) bool {
	return input.CustomerName != nil ||
		input.SupplierName != nil ||
		input.DeliveryNoteNumber != nil ||
		input.WeighbridgeTicketNumber != nil ||
		input.VehicleRegistration != nil ||
		input.JobNumber != nil ||
		input.PurchaseOrderNumber != nil
}

func (s *Service) UpdateReceiptLine(ctx context.Context, receiptID, lineID string, input UpdateReceiptLineInput) (ReceiptLine, error) {
	if s.repository == nil {
		return ReceiptLine{}, ErrUnavailable
	}

	if strings.TrimSpace(receiptID) == "" {
		return ReceiptLine{}, fmt.Errorf("%w: receipt id is required", ErrInvalidInput)
	}

	if strings.TrimSpace(lineID) == "" {
		return ReceiptLine{}, fmt.Errorf("%w: line id is required", ErrInvalidInput)
	}

	// Walkthrough/bulk confirms arrive as "received"; write "reviewed" instead
	// so the line is marked checked but not yet locked. Lines upgrade to final
	// "received" only when the GRN PDF is generated (UpdateReceipt → matched).
	if input.ReceivingStatus != nil && *input.ReceivingStatus == "received" {
		reviewed := "reviewed"
		input.ReceivingStatus = &reviewed
	}

	line, err := s.repository.UpdateReceiptLine(ctx, receiptID, lineID, input)
	if err != nil {
		return ReceiptLine{}, err
	}

	// Sync to DocuWare on any field change so that updates (e.g. received
	// quantity edits made without simultaneously marking as received) are
	// not silently dropped. Use SyncLineNow for status transitions to keep
	// the "reviewed" state visible in DocuWare quickly; for all other edits
	// enqueue so the background worker batches them.
	if s.syncEnqueuer != nil {
		if input.ReceivingStatus != nil {
			if err := s.syncEnqueuer.SyncLineNow(ctx, receiptID, lineID); err != nil {
				log.Printf("warn: failed to sync line to docuware (receipt=%s, line=%s): %v", receiptID, lineID, err)
			}
		} else {
			if err := s.syncEnqueuer.EnqueueLineSync(ctx, receiptID, lineID); err != nil {
				log.Printf("warn: failed to enqueue line sync to docuware (receipt=%s, line=%s): %v", receiptID, lineID, err)
			}
		}
	}

	// Auto-advance receipt from draft → received once every line is reviewed.
	if input.ReceivingStatus != nil && *input.ReceivingStatus == "reviewed" {
		if receipt, err := s.repository.GetReceipt(ctx, receiptID); err == nil {
			if receipt.Status == ReceiptStatusDraft && len(receipt.Lines) > 0 && allLinesReceived(receipt.Lines) {
				newStatus := ReceiptStatusReceived
				if _, err := s.repository.UpdateReceipt(ctx, receiptID, UpdateReceiptInput{Status: &newStatus}); err != nil {
					log.Printf("warn: failed to auto-advance receipt to received (receipt=%s): %v", receiptID, err)
				}
			}
		}
	}

	// POD-status sync: any line transitioning to/from received re-evaluates
	// the POD's Documents-cabinet STATUS field. Best-effort; failures are
	// logged but don't fail the line update.
	if input.ReceivingStatus != nil {
		if err := s.MaybeUpdatePODStatus(ctx, receiptID); err != nil {
			log.Printf("warn: failed to enqueue pod status update (receipt=%s): %v", receiptID, err)
		}
	}

	return line, nil
}

// BulkUpdateReceiptLines applies the same patch to every line ID provided.
// Per-line failures are collected into the result rather than aborting the
// batch — the frontend treats partial success as the contract. Side effects
// shared across the batch (POD status recompute, auto-advance to received)
// fire once at the end instead of per line.
func (s *Service) BulkUpdateReceiptLines(ctx context.Context, receiptID string, input BulkUpdateReceiptLinesInput) (BulkUpdateReceiptLinesResult, error) {
	if s.repository == nil {
		return BulkUpdateReceiptLinesResult{}, ErrUnavailable
	}
	if strings.TrimSpace(receiptID) == "" {
		return BulkUpdateReceiptLinesResult{}, fmt.Errorf("%w: receipt id is required", ErrInvalidInput)
	}
	if len(input.LineIDs) == 0 {
		return BulkUpdateReceiptLinesResult{}, fmt.Errorf("%w: line_ids is required", ErrInvalidInput)
	}

	result := BulkUpdateReceiptLinesResult{
		Updated: make([]ReceiptLine, 0, len(input.LineIDs)),
		Errors:  map[string]string{},
	}

	// Translate "received" → "reviewed" (same as single-line path).
	if input.Patch.ReceivingStatus != nil && *input.Patch.ReceivingStatus == "received" {
		reviewed := "reviewed"
		input.Patch.ReceivingStatus = &reviewed
	}

	// Fetch the receipt once if we need per-line data:
	//   - merging defects into existing condition_notes (defect diff path), or
	//   - defaulting received_quantity to expected_quantity when the batch
	//     flips lines to "reviewed" without an explicit quantity (matches the
	//     walkthrough Confirm behavior — "received as expected").
	flippingToReviewed := input.Patch.ReceivingStatus != nil && *input.Patch.ReceivingStatus == "reviewed"
	needLines := flippingToReviewed && input.Patch.ReceivedQuantity == nil
	if input.Defects != nil && (len(input.Defects.Add) > 0 || len(input.Defects.Remove) > 0) {
		needLines = true
	}
	var linesByID map[string]ReceiptLine
	if needLines {
		if receipt, err := s.repository.GetReceipt(ctx, receiptID); err == nil {
			linesByID = make(map[string]ReceiptLine, len(receipt.Lines))
			for _, l := range receipt.Lines {
				linesByID[l.ID] = l
			}
		}
	}

	// Per-line repository updates. We deliberately call the repository here
	// rather than s.UpdateReceiptLine to suppress the per-line POD status /
	// auto-advance side effects — those run once at the end of the batch.
	// DocuWare line sync still fires per line because each line is its own
	// DocuWare record.
	basePatch := input.Patch
	for _, lineID := range input.LineIDs {
		id := strings.TrimSpace(lineID)
		if id == "" {
			continue
		}
		patch := basePatch // copy so per-line condition_notes / qty defaults are safe
		if input.Defects != nil && linesByID != nil {
			existing := linesByID[id]
			merged := applyDefectDiff(existing.ConditionNotes, input.Defects)
			patch.ConditionNotes = &merged
			// Bulk defect Add must flag the line the same way the walkthrough's
			// single-line apply does; Remove should clear the flag when no
			// defects remain. Caller-supplied discrepancy still wins, so a
			// downstream override is possible.
			if patch.Discrepancy == nil {
				var discrepancy string
				if conditionNotesHasDefect(merged) {
					discrepancy = "defects_noted"
				}
				patch.Discrepancy = &discrepancy
			}
		}
		// Default received_quantity to expected_quantity and quantity_discrepancy
		// to "none" when the batch flips a line to reviewed without explicit
		// values. Matches walkthrough Confirm behaviour.
		if flippingToReviewed && patch.ReceivedQuantity == nil {
			if existing, ok := linesByID[id]; ok {
				qty := existing.ExpectedQuantity
				patch.ReceivedQuantity = &qty
			}
		}
		if flippingToReviewed && patch.QuantityDiscrepancy == nil {
			none := "none"
			patch.QuantityDiscrepancy = &none
		}
		line, err := s.repository.UpdateReceiptLine(ctx, receiptID, id, patch)
		if err != nil {
			result.Errors[id] = err.Error()
			continue
		}
		result.Updated = append(result.Updated, line)

		// Per-line DocuWare sync — fire on any field change, not just status
		// transitions, so edits like received_quantity are not silently dropped.
		if s.syncEnqueuer != nil {
			if patch.ReceivingStatus != nil {
				if err := s.syncEnqueuer.SyncLineNow(ctx, receiptID, id); err != nil {
					log.Printf("warn: failed to sync line to docuware (receipt=%s, line=%s): %v", receiptID, id, err)
				}
			} else {
				if err := s.syncEnqueuer.EnqueueLineSync(ctx, receiptID, id); err != nil {
					log.Printf("warn: failed to enqueue line sync to docuware (receipt=%s, line=%s): %v", receiptID, id, err)
				}
			}
		}
	}

	// Auto-advance to received once — only if the batch flipped at least one
	// line to reviewed and now all lines on the receipt are reviewed.
	if basePatch.ReceivingStatus != nil && *basePatch.ReceivingStatus == "reviewed" && len(result.Updated) > 0 {
		if receipt, err := s.repository.GetReceipt(ctx, receiptID); err == nil {
			if receipt.Status == ReceiptStatusDraft && len(receipt.Lines) > 0 && allLinesReceived(receipt.Lines) {
				newStatus := ReceiptStatusReceived
				if _, err := s.repository.UpdateReceipt(ctx, receiptID, UpdateReceiptInput{Status: &newStatus}); err != nil {
					log.Printf("warn: failed to auto-advance receipt to received (receipt=%s): %v", receiptID, err)
				}
			}
		}
	}

	// POD status recompute fires once per batch.
	if basePatch.ReceivingStatus != nil && len(result.Updated) > 0 {
		if err := s.MaybeUpdatePODStatus(ctx, receiptID); err != nil {
			log.Printf("warn: failed to enqueue pod status update (receipt=%s): %v", receiptID, err)
		}
	}

	return result, nil
}

// qtyFor returns the qty for a given mitigation from a BulkDefectEntry, or 0
// if not present. Used to write top-level *Qty keys in condition_notes that
// DocuWare sync expects.
func qtyFor(entry BulkDefectEntry, mitigation string) int {
	if q, ok := entry.Quantities[mitigation]; ok && q > 0 {
		return q
	}
	return 0
}

// defectDefaults mirrors lib/receipts.ts DEFECT_CATEGORIES defaults. Used to
// detect whether condition_notes carries any non-default defect value.
var defectDefaults = map[string]string{
	"paint": "none", "damaged": "none", "rust": "normal",
	"oilGreaseDiesel": "none", "burr": "none", "sharpEdges": "no",
	"weldingFlux": "no", "continuousWeld": "no", "possibleDistortion": "no",
	"holesInadequate": "no", "weldingSplatter": "no", "delamination": "no",
	"nonConformingPreGalv": "no", "pinHoles": "none", "enclosedCavity": "no",
	"noHanging": "no", "threadedArticle": "no", "articleOverlap": "no",
}

// conditionNotesHasDefect returns true when the parsed condition_notes carry
// at least one defect key set to a non-default value. Mirrors hasAnyDefect in
// frontend/src/lib/receipts.ts so bulk and single-line writes agree on the
// "is this line flagged" question.
func conditionNotesHasDefect(conditionNotes string) bool {
	if strings.TrimSpace(conditionNotes) == "" {
		return false
	}
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(conditionNotes), &obj); err != nil {
		return false
	}
	for key, def := range defectDefaults {
		raw, ok := obj[key]
		if !ok {
			continue
		}
		// Yes/no defects are stored as bool true when set; other defects as
		// the severity string.
		switch v := raw.(type) {
		case bool:
			if v {
				return true
			}
		case string:
			if v != "" && v != def {
				return true
			}
		}
	}
	return false
}

// applyDefectDiff merges a BulkDefectDiff into an existing condition_notes
// JSON string. Remove keys and their Mitigation siblings are deleted; Add
// entries are written (overwriting any existing value for the same key).
// If the existing notes are empty or unparseable the diff is applied to a
// fresh object. Returns the updated JSON string.
func applyDefectDiff(existing string, diff *BulkDefectDiff) string {
	if diff == nil {
		return existing
	}

	obj := map[string]interface{}{}
	if existing != "" {
		_ = json.Unmarshal([]byte(existing), &obj)
	}

	// Top-level qty keys mirror buildConditionNotes in the frontend
	// (lib/receipts.ts). Cleared on remove, repopulated on add when present.
	holeTopLevelByMitigation := map[string]string{
		"Vent holes required":         "ventHolesQty",
		"Drain holes required":        "drainHolesQty",
		"Jig holes required":          "jigHolesQty",
		"Cavity Vent holes required":  "cavityVentHolesQty",
	}
	mitigationsThatCarryQty := map[string]bool{
		"holesInadequate": true,
		"enclosedCavity":  true,
		"noHanging":       true,
		"articleOverlap":  true,
	}

	for _, key := range diff.Remove {
		delete(obj, key)
		delete(obj, key+"Mitigation")
		// Drop top-level qty keys associated with this defect.
		switch key {
		case "holesInadequate":
			delete(obj, "ventHolesQty")
			delete(obj, "drainHolesQty")
			delete(obj, "jigHolesQty")
		case "enclosedCavity":
			delete(obj, "cavityVentHolesQty")
		}
	}

	for _, entry := range diff.Add {
		// Yes/no defects store boolean true; all others store the severity string.
		if entry.Severity == "yes" {
			obj[entry.Key] = true
		} else {
			obj[entry.Key] = entry.Severity
		}

		if len(entry.Mitigations) > 0 {
			// For qty-bearing defects, encode the qty inline as "mit=qty" to
			// match the walkthrough's buildConditionNotes output. Mitigations
			// without a qty stay bare.
			mits := make([]string, 0, len(entry.Mitigations))
			for _, m := range entry.Mitigations {
				if mitigationsThatCarryQty[entry.Key] {
					if q, ok := entry.Quantities[m]; ok && q > 0 {
						mits = append(mits, fmt.Sprintf("%s=%d", m, q))
						continue
					}
				}
				mits = append(mits, m)
			}
			obj[entry.Key+"Mitigation"] = mits
		} else {
			delete(obj, entry.Key+"Mitigation")
		}

		// Top-level qty keys for holesInadequate / enclosedCavity (same shape
		// as buildConditionNotes — single-mode and bulk-mode write identical
		// JSON, so DocuWare sync sees one format).
		switch entry.Key {
		case "holesInadequate":
			obj["ventHolesQty"] = qtyFor(entry, "Vent holes required")
			obj["drainHolesQty"] = qtyFor(entry, "Drain holes required")
			obj["jigHolesQty"] = qtyFor(entry, "Jig holes required")
		case "enclosedCavity":
			obj["cavityVentHolesQty"] = qtyFor(entry, "Cavity Vent holes required")
		}
		_ = holeTopLevelByMitigation // kept for future explicit lookups
	}

	out, err := json.Marshal(obj)
	if err != nil {
		return existing
	}
	return string(out)
}

func allLinesReceived(lines []ReceiptLine) bool {
	for _, l := range lines {
		if l.ReceivingStatus != "received" && l.ReceivingStatus != "reviewed" {
			return false
		}
	}
	return true
}

func buildImportedReceipt(input DocuWareImportInput, groupReference string, payload map[string]any) *importedReceipt {
	// DocuWare sends DNDocID (mixed case) as the POD's DWDOCID — the key we'll
	// query the POD cabinet by. Older payloads use DNDOCID/DNDOCIDI; keep both.
	sourceDocumentID := firstNonEmpty(
		strings.TrimSpace(input.SourceDocumentID),
		payloadString(payload, "DNDocID"),
		payloadString(payload, "DNDOCID"),
		payloadString(payload, "DNDOCIDI"),
		payloadString(payload, "DWDOCID"),
	)
	sourceCabinetID := firstNonEmpty(
		strings.TrimSpace(input.SourceCabinetID),
		payloadString(payload, "DWSYS_FC_GUID"),
	)
	receivedAt := firstNonZeroTime(
		payloadTime(payload, "DWSTOREDATETIME"),
		payloadTime(payload, "STORED_DATE"),
		payloadTime(payload, "DATE"),
		time.Now().UTC(),
	)

	// COMPANY is the customer who sent the goods.
	// FABRICATOR is an internal processing tag, stored for reference but not the display name.
	customerName := payloadString(payload, "COMPANY")
	supplierName := firstNonEmpty(payloadString(payload, "FABRICATOR"), customerName, "DocuWare Import")

	return &importedReceipt{
		ReceiptNumber:           buildReceiptNumber(groupReference, payload),
		SupplierName:            supplierName,
		CustomerName:            customerName,
		SupplierReference:       firstNonEmpty(payloadString(payload, "DNDocID"), payloadString(payload, "DNDOCID"), payloadString(payload, "DNDOCIDI"), payloadString(payload, "JOB_NUMBER")),
		PurchaseOrderNumber:     firstNonEmpty(payloadString(payload, "ORDER_NUMBER"), payloadString(payload, "DOCUMENTNO")),
		DeliveryNoteNumber:      firstNonEmpty(payloadString(payload, "DELIVERY_NOTE"), payloadString(payload, "DELIVERY_NOTE_NUMBER")),
		WeighbridgeTicketNumber: payloadString(payload, "WEIGHBRIDGE_TICKET_NUMBER"),
		VehicleRegistration:     payloadString(payload, "VEHICLE_REGISTRATION"),
		JobNumber:               payloadString(payload, "JOB_NUMBER"),
		SourceDocuWareDocument:  sourceDocumentID,
		SourceDocuWareCabinet:   sourceCabinetID,
		DocuWareRecordID:        payloadString(payload, "DWDOCID"),
		DocuWareGroupReference:  groupReference,
		DocuWareDocURL:          payloadString(payload, "DWSYS_DOC_URL"),
		ReceivedAt:              receivedAt,
		Status:                  ReceiptStatusDraft,
		SyncStatus:              "imported",
		Notes:                   "",
		SourcePayload: map[string]any{
			"source_cabinet_id":         sourceCabinetID,
			"source_document_id":        sourceDocumentID,
			"docuware_group_ref":        groupReference,
			"delivery_note_number":      firstNonEmpty(payloadString(payload, "DELIVERY_NOTE"), payloadString(payload, "DELIVERY_NOTE_NUMBER")),
			"order_number":              payloadString(payload, "ORDER_NUMBER"),
			"weighbridge_ticket_number": payloadString(payload, "WEIGHBRIDGE_TICKET_NUMBER"),
			"vehicle_registration":      payloadString(payload, "VEHICLE_REGISTRATION"),
			"job_number":                payloadString(payload, "JOB_NUMBER"),
			"company":                   payloadString(payload, "COMPANY"),
			"fabricator":                payloadString(payload, "FABRICATOR"),
			"docuware_doc_url":          payloadString(payload, "DWSYS_DOC_URL"),
		},
	}
}

func buildImportedLine(payload map[string]any, recordID string, fallbackLineNumber int) importedReceiptLine {
	lineNumber := payloadInt(payload, "LINE")
	if lineNumber <= 0 {
		lineNumber = fallbackLineNumber
	}

	itemCode := firstNonEmpty(
		payloadString(payload, "ITEM_CODE_ON_DELIVERY_NOTE"),
		payloadString(payload, "MATERIAL_CODE"),
		payloadString(payload, "UNIQUE_NUMBER"),
		payloadString(payload, "PRIMARY_KEY"),
		recordID,
	)

	description := firstNonEmpty(
		payloadString(payload, "ITEM_NAME_ON_DELIVERY_NOTE"),
		payloadString(payload, "MATERIAL_DESCRIPTION"),
		payloadString(payload, "INTERNAL_DESCRIPTION"),
		itemCode,
	)

	// UNIQUE_NUMBER is the true per-line DocuWare key (e.g. "112457_SUB0491_6976_11").
	// Use it as the dedup/sync-back identifier. Fall back to PRIMARY_KEY, then recordID.
	docuWareRecordLine := firstNonEmpty(
		payloadString(payload, "UNIQUE_NUMBER"),
		payloadString(payload, "PRIMARY_KEY"),
		recordID,
	)

	return importedReceiptLine{
		LineNumber:          lineNumber,
		ItemCode:            itemCode,
		Description:         description,
		MaterialCode:        payloadString(payload, "MATERIAL_CODE"),
		MaterialDescription: payloadString(payload, "MATERIAL_DESCRIPTION"),
		MaterialSize:        payloadString(payload, "MATERIAL_SIZE"),
		MaterialMarkings:    payloadString(payload, "MATERIAL_MARKINGS"),
		MaterialThickness:   payloadString(payload, "MATERIAL_THICKNESS"),
		MaterialLength:      payloadString(payload, "MATERIAL_LENGTH"),
		Weight:              payloadString(payload, "WEIGHT"),
		Process:             payloadString(payload, "PROCESS"),
		StoredIn:            payloadString(payload, "STORED_IN"),
		Bay:                 payloadString(payload, "BAY"),
		ExpectedQuantity:    payloadFloat(payload, "QUANTITY"),
		ReceivedQuantity:    payloadFloat(payload, "QUANTITY_RECEIVED"),
		UnitOfMeasure:       payloadString(payload, "ITEM_TYPE"),
		ReceivingStatus:     firstNonEmpty(payloadString(payload, "RECEIVING_STATUS"), "draft"),
		Discrepancy:         payloadString(payload, "DISCREPANCY"),
		QuantityDiscrepancy: payloadString(payload, "QUANTITY_DISCREPANCY"),
		ConditionNotes:      buildConditionNotesJSON(payload),
		JobNumber:           payloadString(payload, "JOB_NUMBER"),
		DocuWareRecordLine:  docuWareRecordLine,
		DocuWareUniqueNo:    payloadString(payload, "UNIQUE_NUMBER"),
		DocuWarePrimaryKey:  payloadString(payload, "PRIMARY_KEY"),
		DocuWareDocID:       payloadString(payload, "DWDOCID"),
		SourcePayload:       payload,
	}
}

func buildGroupReference(payload map[string]any) string {
	// Only stable POD-level identifiers. DocuWare sometimes varies job_number/fabricator
	// across rows of the same physical POD, which would split one POD into multiple
	// receipts. Delivery note + weighbridge ticket + company are consistent.
	parts := []string{
		firstNonEmpty(payloadString(payload, "DELIVERY_NOTE"), payloadString(payload, "DELIVERY_NOTE_NUMBER")),
		payloadString(payload, "WEIGHBRIDGE_TICKET_NUMBER"),
		payloadString(payload, "COMPANY"),
	}

	parts = compactStrings(parts)
	if len(parts) == 0 {
		return ""
	}

	return strings.Join(parts, "|")
}

func buildReceiptNumber(groupReference string, payload map[string]any) string {
	base := firstNonEmpty(
		payloadString(payload, "DELIVERY_NOTE"),
		payloadString(payload, "DELIVERY_NOTE_NUMBER"),
		payloadString(payload, "ORDER_NUMBER"),
		payloadString(payload, "WEIGHBRIDGE_TICKET_NUMBER"),
		payloadString(payload, "JOB_NUMBER"),
		"docuware",
	)

	base = strings.ToUpper(slugify(base))
	if len(base) > 24 {
		base = base[:24]
	}

	digest := sha1.Sum([]byte(groupReference))
	return fmt.Sprintf("%s-%s", base, strings.ToUpper(hex.EncodeToString(digest[:4])))
}

func clonePayload(payload map[string]any) map[string]any {
	if len(payload) == 0 {
		return map[string]any{}
	}

	clone := make(map[string]any, len(payload))
	for key, value := range payload {
		clone[key] = value
	}

	return clone
}

func compactStrings(values []string) []string {
	compacted := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			compacted = append(compacted, value)
		}
	}
	return compacted
}

func payloadString(payload map[string]any, key string) string {
	return strings.TrimSpace(stringValue(payload[key]))
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case float64:
		if typed == math.Trunc(typed) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case int32:
		return strconv.FormatInt(int64(typed), 10)
	case bool:
		return strconv.FormatBool(typed)
	default:
		return fmt.Sprint(value)
	}
}

func payloadFloat(payload map[string]any, key string) float64 {
	value, ok := floatValue(payload[key])
	if !ok {
		return 0
	}
	return value
}

func floatValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case nil:
		return 0, false
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case string:
		normalized := strings.ReplaceAll(strings.TrimSpace(typed), ",", "")
		if normalized == "" {
			return 0, false
		}
		parsed, err := strconv.ParseFloat(normalized, 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	}
}

func payloadInt(payload map[string]any, key string) int {
	value, ok := floatValue(payload[key])
	if !ok {
		return 0
	}
	return int(value)
}

func payloadTime(payload map[string]any, key string) time.Time {
	raw := strings.TrimSpace(stringValue(payload[key]))
	if raw == "" {
		return time.Time{}
	}

	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.999999999-07:00",
		"2006-01-02T15:04:05.999999999",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}

	for _, layout := range layouts {
		parsed, err := time.Parse(layout, raw)
		if err == nil {
			return parsed
		}
	}

	return time.Time{}
}

func firstNonZeroTime(values ...time.Time) time.Time {
	for _, value := range values {
		if !value.IsZero() {
			return value
		}
	}
	return time.Time{}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func joinNonEmpty(separator string, values ...string) string {
	parts := compactStrings(values)
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, separator)
}

func slugify(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return "docuware"
	}

	builder := strings.Builder{}
	lastDash := false
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z':
			builder.WriteRune(char)
			lastDash = false
		case char >= '0' && char <= '9':
			builder.WriteRune(char)
			lastDash = false
		default:
			if !lastDash && builder.Len() > 0 {
				builder.WriteRune('-')
				lastDash = true
			}
		}
	}

	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "docuware"
	}

	return result
}

// buildConditionNotesJSON transforms DocuWare defect fields into structured JSON for condition_notes.
func buildConditionNotesJSON(payload map[string]any) string {
	conditionData := make(map[string]any)

	// Map DocuWare defect flags to wizard format
	defectFlags := map[string]string{
		"PAINT":                   "paint",
		"DAMAGED":                 "damaged",
		"RUST":                    "rust",
		"DELAMINATION":            "delamination",
		"NON_CONFORMING_PRE_GALV": "nonConformingPreGalv",
		"ENCLOSED_CAVITY":         "enclosedCavity",
		"THREADED_ARTICLE":        "threadedArticle",
		"BURR":                    "burr",
		"PIN_HOLES":               "pinHoles",
		"WELD_SPLATTER":           "weldSplatter",
		"WELDING_FLUX":            "weldingFlux",
		"CONTINUOUS_WELD":         "continuousWeld",
		"ARTICLE_OVERLAPPED":      "articleOverlapped",
		"POSSIBLE_DISTORTION":     "possibleDistortion",
		"OIL_GREASE_DIESEL":       "oilGreaseDiesel",
		"SHARP_EDGES":             "sharpEdges",
		"HOLES_INADEQUATE":        "holesInadequate",
		"NO_HANGING_METHOD":       "noHangingMethod",
	}

	for dwField, wizardKey := range defectFlags {
		if val := payloadString(payload, dwField); val != "" && strings.ToLower(val) == "yes" {
			conditionData[wizardKey] = true
		}
	}

	// Map mitigation fields
	mitigationFields := map[string]string{
		"PAINT_MITIGATION":              "paintMitigation",
		"DAMAGE_MITIGATION":             "damagedMitigation",
		"RUST_MITIGATION":               "rustMitigation",
		"DELAMINATION_MITIGATION":       "delaminationMitigation",
		"NON_CONFORMING_PRE_GALV_MITIG": "nonConformingPreGalvMitigation",
		"THREADED_ARTICLE_MITIGATION":   "threadedArticleMitigation",
		"ENCLOSED_CAVITY_HOLES_REQUIRE": "enclosedCavityMitigation",
	}

	for dwField, wizardKey := range mitigationFields {
		if val := payloadString(payload, dwField); val != "" {
			mitigations := strings.Split(val, ",")
			trimmedMitigations := make([]string, 0, len(mitigations))
			for _, m := range mitigations {
				if trimmed := strings.TrimSpace(m); trimmed != "" {
					trimmedMitigations = append(trimmedMitigations, trimmed)
				}
			}
			if len(trimmedMitigations) > 0 {
				conditionData[wizardKey] = trimmedMitigations
			}
		}
	}

	// Map hole quantity fields
	holeQtyFields := map[string]string{
		"DRAIN_HOLES":       "drainHolesQty",
		"VENT_HOLES":        "ventHolesQty",
		"JIG_HOLES":         "jigHolesQty",
		"CAVITY_VENT_HOLES": "cavityVentHolesQty",
	}

	for dwField, wizardKey := range holeQtyFields {
		if val, ok := floatValue(payload[dwField]); ok && val > 0 {
			conditionData[wizardKey] = val
		}
	}

	// Add additional comments if present
	if val := payloadString(payload, "ADDITIONAL_COMMENTS"); val != "" {
		conditionData["additionalComments"] = val
	}

	// If no defect data, return empty string
	if len(conditionData) == 0 {
		return ""
	}

	// Marshal to JSON
	data, _ := json.Marshal(conditionData)
	return string(data)
}
