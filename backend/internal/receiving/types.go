package receiving

import (
	"errors"
	"time"
)

type ReceiptStatus string

const (
	ReceiptStatusDraft       ReceiptStatus = "draft"
	ReceiptStatusReceived    ReceiptStatus = "received"
	ReceiptStatusQualityHold ReceiptStatus = "quality_hold"
	ReceiptStatusMatched     ReceiptStatus = "matched"
	ReceiptStatusArchived    ReceiptStatus = "archived"
)

var (
	ErrNotFound     = errors.New("receipt not found")
	ErrConflict     = errors.New("receipt conflict")
	ErrInvalidInput = errors.New("invalid input")
	ErrUnavailable  = errors.New("receiving unavailable")
)

type Receipt struct {
	ID                        string             `json:"id"`
	ReceiptNumber             string             `json:"receipt_number"`
	SupplierName              string             `json:"supplier_name"`
	CustomerName              string             `json:"customer_name"`
	SupplierReference         string             `json:"supplier_reference"`
	PurchaseOrderNumber       string             `json:"purchase_order_number"`
	DeliveryNoteNumber        string             `json:"delivery_note_number"`
	WeighbridgeTicketNumber   string             `json:"weighbridge_ticket_number"`
	VehicleRegistration       string             `json:"vehicle_registration"`
	JobNumber                 string             `json:"job_number"`
	SourceDocuWareDocument    string             `json:"source_docuware_document_id"`
	SourceDocuWareCabinet     string             `json:"source_docuware_cabinet_id"`
	DocuWareRecordID          string             `json:"docuware_record_id"`
	DocuWareGroupReference    string             `json:"docuware_group_reference"`
	DocuWareDocURL            string             `json:"docuware_doc_url"`
	ReceivedAt                time.Time          `json:"received_at"`
	Status                    ReceiptStatus      `json:"status"`
	SyncStatus                string             `json:"sync_status"`
	Notes                     string             `json:"notes"`
	Lines                     []ReceiptLine      `json:"lines"`
	Documents                 []ReceiptDocument  `json:"documents"`
	Exceptions                []ReceiptException `json:"exceptions"`
	GRNDocumentID             string             `json:"grn_document_id,omitempty"`
	GRNDocuWareDocID          string             `json:"grn_docuware_doc_id,omitempty"`
	GRNGeneratedAt            *time.Time         `json:"grn_generated_at,omitempty"`
	DocuWarePODStatus         string             `json:"docuware_pod_status,omitempty"`
	DocuWarePODStatusSyncedAt *time.Time         `json:"docuware_pod_status_synced_at,omitempty"`
	ImportedAt                *time.Time         `json:"imported_at,omitempty"`
	LastSyncedAt              *time.Time         `json:"last_synced_at,omitempty"`
	CreatedAt                 time.Time          `json:"created_at"`
	UpdatedAt                 time.Time          `json:"updated_at"`
}

type ReceiptLine struct {
	ID                    string     `json:"id"`
	LineNumber            int        `json:"line_number"`
	ItemCode              string     `json:"item_code"`
	Description           string     `json:"description"`
	MaterialCode          string     `json:"material_code"`
	MaterialDescription   string     `json:"material_description"`
	MaterialSize          string     `json:"material_size"`
	MaterialMarkings      string     `json:"material_markings"`
	MaterialThickness     string     `json:"material_thickness"`
	MaterialLength        string     `json:"material_length"`
	Weight                string     `json:"weight"`
	InternalDescription   string     `json:"internal_description"`
	ItemType              string     `json:"item_type"`
	PackagingMethod       string     `json:"packaging_method"`
	Accessories           string     `json:"accessories"`
	Comments              string     `json:"comments"`
	RequiredGalvThickness string     `json:"required_galv_thickness"`
	Process               string     `json:"process"`
	StoredIn              string     `json:"stored_in"`
	Bay                   string     `json:"bay"`
	ExpectedQuantity      float64    `json:"expected_quantity"`
	ReceivedQuantity      float64    `json:"received_quantity"`
	UnitOfMeasure         string     `json:"unit_of_measure"`
	ReceivingStatus       string     `json:"receiving_status"`
	Discrepancy           string     `json:"discrepancy"`
	QuantityDiscrepancy   string     `json:"quantity_discrepancy"`
	ConditionNotes        string     `json:"condition_notes"`
	DocuWareRecordLine    string     `json:"docuware_record_line_id"`
	DocuWareUniqueNo      string     `json:"docuware_unique_number"`
	DocuWarePrimaryKey    string     `json:"docuware_primary_key"`
	DocuWareDocID         string     `json:"docuware_doc_id"`
	LastSyncedAt          *time.Time `json:"last_synced_at,omitempty"`
}

type ReceiptDocument struct {
	ID                 string    `json:"id"`
	ReceiptLineID      string    `json:"receipt_line_id,omitempty"`
	Category           string    `json:"category,omitempty"`
	DocumentType       string    `json:"document_type"`
	Filename           string    `json:"filename"`
	ContentType        string    `json:"content_type"`
	StorageKey         string    `json:"storage_key"`
	FileSize           int64     `json:"file_size,omitempty"`
	Source             string    `json:"source"`
	DocuWareDocumentID string    `json:"docuware_document_id"`
	DocuWareStatus     string    `json:"docuware_status"`
	DocuWareError      string    `json:"docuware_error,omitempty"`
	UploadedByID       string    `json:"uploaded_by,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
}

type ReceiptException struct {
	ID            string    `json:"id"`
	ExceptionType string    `json:"exception_type"`
	Summary       string    `json:"summary"`
	Details       string    `json:"details"`
	IsResolved    bool      `json:"is_resolved"`
	ResolvedAt    time.Time `json:"resolved_at"`
	CreatedAt     time.Time `json:"created_at"`
}

type UpdateReceiptInput struct {
	Status                  *ReceiptStatus `json:"status"`
	Notes                   *string        `json:"notes"`
	CustomerName            *string        `json:"customer_name"`
	SupplierName            *string        `json:"supplier_name"`
	DeliveryNoteNumber      *string        `json:"delivery_note_number"`
	WeighbridgeTicketNumber *string        `json:"weighbridge_ticket_number"`
	VehicleRegistration     *string        `json:"vehicle_registration"`
	JobNumber               *string        `json:"job_number"`
	PurchaseOrderNumber     *string        `json:"purchase_order_number"`
}

type UpdateReceiptLineInput struct {
	ReceivedQuantity      *float64 `json:"received_quantity"`
	QuantityDiscrepancy   *string  `json:"quantity_discrepancy"`
	InternalDescription   *string  `json:"internal_description"`
	ItemCode              *string  `json:"item_code"`
	Description           *string  `json:"description"`
	MaterialSize          *string  `json:"material_size"`
	ItemType              *string  `json:"item_type"`
	Process               *string  `json:"process"`
	PackagingMethod       *string  `json:"packaging_method"`
	Accessories           *string  `json:"accessories"`
	Comments              *string  `json:"comments"`
	RequiredGalvThickness *string  `json:"required_galv_thickness"`
	StoredIn              *string  `json:"stored_in"`
	Bay                   *string  `json:"bay"`
	ReceivingStatus       *string  `json:"receiving_status"`
	Discrepancy           *string  `json:"discrepancy"`
	ConditionNotes        *string  `json:"condition_notes"`

	// ReceivedByUserID and ReceivedByName are set server-side from the
	// authenticated session and are never accepted from the request body.
	// They are written to the line only on the transition to receiving_status
	// = "received", so the field captures who confirmed the line, not who
	// last edited it.
	ReceivedByUserID string `json:"-"`
	ReceivedByName   string `json:"-"`
}

// BulkDefectEntry is a defect key with a resolved severity and toggle-only
// mitigations. Used in BulkDefectDiff.Add.
type BulkDefectEntry struct {
	Key         string   `json:"key"`
	Severity    string   `json:"severity"`
	Mitigations []string `json:"mitigations"`
}

// BulkDefectDiff describes a merge operation on per-line condition_notes.
// Add entries are written/overwritten on each line; Remove keys are stripped.
// Lines keep any defects not mentioned in either list.
type BulkDefectDiff struct {
	Add    []BulkDefectEntry `json:"add"`
	Remove []string          `json:"remove"`
}

// BulkUpdateReceiptLinesInput drives POST /receipts/{id}/lines/bulk-update.
// LineIDs are the lines to apply Patch to. Patch uses the same pointer-field
// convention as UpdateReceiptLineInput — nil fields are not modified.
// Defects is optional; when set it is merged into each line's condition_notes
// rather than replacing it wholesale.
type BulkUpdateReceiptLinesInput struct {
	LineIDs []string               `json:"line_ids"`
	Patch   UpdateReceiptLineInput `json:"patch"`
	Defects *BulkDefectDiff        `json:"defects,omitempty"`
}

// BulkUpdateReceiptLinesResult reports per-line outcomes. Updated holds the
// fresh ReceiptLine objects for successes; Errors maps line ID → error
// message for failures. Partial success is the contract.
type BulkUpdateReceiptLinesResult struct {
	Updated []ReceiptLine     `json:"updated"`
	Errors  map[string]string `json:"errors"`
}

type CreateGRNInput struct {
	DeliveryNoteNumber      string               `json:"delivery_note_number"`
	OrderNumber             string               `json:"order_number"`
	VehicleRegistration     string               `json:"vehicle_registration"`
	DeliveryDate            string               `json:"delivery_date"`
	WeighbridgeTicketNumber string               `json:"weighbridge_ticket_number"`
	Company                 string               `json:"company"`
	Fabricator              string               `json:"fabricator"`
	JobComments             string               `json:"job_comments"`
	StoredBy                string               `json:"stored_by"`
	CompletionDate          string               `json:"completion_date"`
	ProductName             string               `json:"product_name"`
	ProcessingStatus        string               `json:"processing_status"`
	Lines                   []CreateGRNLineInput `json:"lines"`

	// ReceivedByUserID and ReceivedByName are set server-side from the
	// authenticated session and are never accepted from the request body.
	// The name is snapshotted onto the receipt at create time so a later
	// profile rename cannot retroactively rewrite who signed for a load.
	ReceivedByUserID string `json:"-"`
	ReceivedByName   string `json:"-"`
}

type CreateGRNLineInput struct {
	DeliveryNote     string `json:"delivery_note"`
	ItemCode         string `json:"item_code"`
	ItemDescription  string `json:"item_description"`
	ItemSize         string `json:"item_size"`
	ItemQuantity     string `json:"item_quantity"`
	Weight           string `json:"weight"`
	MaterialMarkings string `json:"material_markings"`
	MaterialLength   string `json:"material_length"`
	JobNumber        string `json:"job_number"`
	Other            string `json:"other"`
}

type DocuWareImportInput struct {
	SourceCabinetID  string              `json:"source_cabinet_id"`
	SourceDocumentID string              `json:"source_document_id"`
	Rows             []DocuWareImportRow `json:"rows"`
}

type DocuWareImportRow struct {
	RecordID string         `json:"record_id"`
	Payload  map[string]any `json:"payload"`
}

type DocuWareImportResult struct {
	ImportedReceiptCount int       `json:"imported_receipt_count"`
	ImportedRowCount     int       `json:"imported_row_count"`
	Receipts             []Receipt `json:"receipts"`
}
