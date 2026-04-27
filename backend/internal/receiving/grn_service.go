package receiving

// GRN service — Phase 2 of the photo/GRN feature.
//
// When a receipt transitions to 'matched', this service:
//   1. renders the GRN PDF from the receipt + lines + condition notes
//   2. writes it onto the photo storage volume as a receipt_documents row
//      with category='grn_pdf' and docuware_status='pending'
//   3. records the document id on receipts.grn_document_id (idempotent —
//      if grn_document_id is already set, we skip)
//
// A separate worker step pushes that pending row to the DocuWare Documents
// cabinet via Client.CreateDocument, then re-attaches every defect photo
// captured for the receipt's lines as Sections on the new GRN doc.
//
// This file owns the orchestration (write to disk + DB row); the worker
// owns the DocuWare push so the operator's matched-status PATCH stays fast.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const PhotoCategoryGRN PhotoCategory = "grn_pdf"

type GRNRepository interface {
	GetReceipt(ctx context.Context, id string) (Receipt, error)
	InsertGRNDocument(ctx context.Context, input InsertGRNDocumentInput) (ReceiptDocument, error)
	SetReceiptGRNDocument(ctx context.Context, receiptID, documentID string) error
}

type InsertGRNDocumentInput struct {
	ReceiptID   string
	Filename    string
	StorageKey  string
	FileSize    int64
	ContentType string
}

type GRNService struct {
	repo       GRNRepository
	storageDir string
	company    CompanyDetails
}

func NewGRNService(repo GRNRepository, storageDir string, company CompanyDetails) *GRNService {
	return &GRNService{repo: repo, storageDir: storageDir, company: company}
}

// MaybeGenerate builds + persists the GRN PDF for the receipt iff one
// hasn't been generated yet. Idempotent and safe to call from any status
// transition path.
func (s *GRNService) MaybeGenerate(ctx context.Context, receiptID string) error {
	if s == nil || s.repo == nil {
		return nil
	}
	if strings.TrimSpace(s.storageDir) == "" {
		return errors.New("grn storage dir not configured")
	}

	receipt, err := s.repo.GetReceipt(ctx, receiptID)
	if err != nil {
		return fmt.Errorf("get receipt for grn: %w", err)
	}
	if receipt.Status != ReceiptStatusMatched {
		// Defensive: only generate when status is actually 'matched'.
		return nil
	}

	// Idempotency: if any of the existing documents on this receipt is
	// already a GRN PDF, skip. We check via Documents (loaded with the
	// receipt) rather than a separate query for simplicity.
	for _, d := range receipt.Documents {
		if d.Category == string(PhotoCategoryGRN) {
			return nil
		}
	}

	pdfBytes, err := RenderGRNPDF(buildGRNRenderInput(receipt), s.company)
	if err != nil {
		return fmt.Errorf("render grn pdf: %w", err)
	}

	storageKey, absPath, err := s.allocatePath(receiptID)
	if err != nil {
		return fmt.Errorf("allocate grn path: %w", err)
	}
	if err := os.WriteFile(absPath, pdfBytes, 0o640); err != nil {
		return fmt.Errorf("write grn pdf: %w", err)
	}

	doc, err := s.repo.InsertGRNDocument(ctx, InsertGRNDocumentInput{
		ReceiptID:   receiptID,
		Filename:    fmt.Sprintf("GRN-%s.pdf", grnNumber(receipt)),
		StorageKey:  storageKey,
		FileSize:    int64(len(pdfBytes)),
		ContentType: "application/pdf",
	})
	if err != nil {
		// Best-effort cleanup of the on-disk file if the row write failed.
		_ = os.Remove(absPath)
		return fmt.Errorf("insert grn document: %w", err)
	}
	if err := s.repo.SetReceiptGRNDocument(ctx, receiptID, doc.ID); err != nil {
		// Don't unwind the insert — the worker will still pick up the row,
		// the receipt just won't show the back-pointer until next time.
		return fmt.Errorf("link grn document to receipt: %w", err)
	}
	return nil
}

func (s *GRNService) allocatePath(receiptID string) (string, string, error) {
	suffix := make([]byte, 6)
	if _, err := rand.Read(suffix); err != nil {
		return "", "", err
	}
	relDir := filepath.Join(receiptID, "grn")
	absDir := filepath.Join(s.storageDir, relDir)
	if err := os.MkdirAll(absDir, 0o750); err != nil {
		return "", "", err
	}
	name := fmt.Sprintf("grn_%d_%s.pdf", time.Now().UnixNano(), hex.EncodeToString(suffix))
	return filepath.Join(relDir, name), filepath.Join(absDir, name), nil
}

// buildGRNRenderInput projects the wide Receipt struct down to the fields
// the renderer actually displays. Keeping this in the service (not the
// renderer) keeps the renderer dependency-free and easy to unit test.
func buildGRNRenderInput(r Receipt) GRNRenderInput {
	now := time.Now()
	receivedAt := r.ReceivedAt
	if receivedAt.IsZero() {
		receivedAt = now
	}

	lines := make([]GRNRenderLine, 0, len(r.Lines))
	for _, l := range r.Lines {
		unit := parseFloat(l.Weight)
		recv := l.ReceivedQuantity
		lineKg := unit * recv
		desc := firstNonEmpty(l.Description, l.MaterialDescription, l.InternalDescription, l.ItemCode)

		lines = append(lines, GRNRenderLine{
			LineNumber:       l.LineNumber,
			ItemCode:         firstNonEmpty(l.ItemCode, l.MaterialCode),
			Description:      desc,
			ConditionSummary: summariseCondition(l),
			ExpectedQty:      l.ExpectedQuantity,
			ReceivedQty:      recv,
			UnitOfMeasure:    firstNonEmpty(l.UnitOfMeasure, "pcs"),
			UnitWeightKg:     unit,
			LineWeightKg:     lineKg,
		})
	}

	return GRNRenderInput{
		GRNNumber:               grnNumber(r),
		IssuedAt:                now,
		SourcePODReference:      firstNonEmpty(r.SupplierReference, r.DocuWareGroupReference, r.ReceiptNumber),
		CustomerName:            r.CustomerName,
		PurchaseOrderNumber:     r.PurchaseOrderNumber,
		DeliveryNoteNumber:      r.DeliveryNoteNumber,
		VehicleRegistration:     r.VehicleRegistration,
		WeighbridgeTicketNumber: r.WeighbridgeTicketNumber,
		ReceivedAt:              receivedAt,
		JobComments:             r.Notes,
		Lines:                   lines,
	}
}

func grnNumber(r Receipt) string {
	if strings.TrimSpace(r.ReceiptNumber) != "" {
		return "GRN-" + r.ReceiptNumber
	}
	// Fall back to a date+id slug so the document still has a stable name.
	return "GRN-" + r.ReceivedAt.Format("20060102") + "-" + shortID(r.ID)
}

// summariseCondition surfaces the raw condition_notes JSON when the line
// has any kind of flag. The PDF renderer (PrettyConditionSummary) decodes
// the JSON into a human-readable one-liner; keeping the raw payload here
// means we don't pre-format twice and can improve the renderer in one
// place.
func summariseCondition(l ReceiptLine) string {
	if strings.TrimSpace(l.ConditionNotes) == "" {
		return ""
	}
	if l.Discrepancy != "defects_noted" && l.QuantityDiscrepancy != "" && l.QuantityDiscrepancy != "none" {
		// Quantity-only discrepancy with no defect — still surface, the
		// renderer will pretty-print or fall back to the raw notes.
		return l.ConditionNotes
	}
	if l.Discrepancy != "defects_noted" {
		return ""
	}
	return l.ConditionNotes
}

func parseFloat(s string) float64 {
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0
	}
	return v
}

func shortID(id string) string {
	if len(id) >= 8 {
		return id[:8]
	}
	return id
}

// BuildGRNIndexFields converts a Receipt into the DocuWare index fields for
// the Documents-cabinet record. Field names match the legacy newPODSubmit
// payload (see docs/ENHANCEMENTS.md and docs/docuware-documents-cabinet.md)
// so the cabinet schema remains unchanged.
func BuildGRNIndexFields(r Receipt) []GRNIndexField {
	return []GRNIndexField{
		{"DOCUMENT_TYPE", "GRN"},
		{"DOCUMENTTYPE", "GRN"},
		{"DOCUMENTNO", grnNumber(r)},
		{"DELIVERY_NOTE_NUMBER", r.DeliveryNoteNumber},
		{"ORDER_NUMBER", r.PurchaseOrderNumber},
		{"WEIGHBRIDGE_TICKET_NUMBER", r.WeighbridgeTicketNumber},
		{"VEHICLE_REGISTRATION_", r.VehicleRegistration},
		{"COMPANY", r.CustomerName},
		{"FABRICATOR", r.SupplierName},
		{"JOB_NUMBER", r.JobNumber},
		{"DATE", r.ReceivedAt.Format("2006-01-02")},
	}
}

// GRNIndexField is a small DTO so the docuware client doesn't need to
// import this package; the worker translates it into docuware.IndexField.
type GRNIndexField struct {
	FieldName string
	Item      string
}
