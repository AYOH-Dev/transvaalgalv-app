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
	ID                      string             `json:"id"`
	ReceiptNumber           string             `json:"receipt_number"`
	SupplierName            string             `json:"supplier_name"`
	CustomerName            string             `json:"customer_name"`
	SupplierReference       string             `json:"supplier_reference"`
	PurchaseOrderNumber     string             `json:"purchase_order_number"`
	DeliveryNoteNumber      string             `json:"delivery_note_number"`
	WeighbridgeTicketNumber string             `json:"weighbridge_ticket_number"`
	VehicleRegistration     string             `json:"vehicle_registration"`
	JobNumber               string             `json:"job_number"`
	SourceDocuWareDocument  string             `json:"source_docuware_document_id"`
	SourceDocuWareCabinet   string             `json:"source_docuware_cabinet_id"`
	DocuWareRecordID        string             `json:"docuware_record_id"`
	DocuWareGroupReference  string             `json:"docuware_group_reference"`
	DocuWareDocURL          string             `json:"docuware_doc_url"`
	ReceivedAt              time.Time          `json:"received_at"`
	Status                  ReceiptStatus      `json:"status"`
	SyncStatus              string             `json:"sync_status"`
	Notes                   string             `json:"notes"`
	Lines                   []ReceiptLine      `json:"lines"`
	Documents               []ReceiptDocument  `json:"documents"`
	Exceptions              []ReceiptException `json:"exceptions"`
	ImportedAt              *time.Time         `json:"imported_at,omitempty"`
	LastSyncedAt            *time.Time         `json:"last_synced_at,omitempty"`
	CreatedAt               time.Time          `json:"created_at"`
	UpdatedAt               time.Time          `json:"updated_at"`
}

type ReceiptLine struct {
	ID                  string     `json:"id"`
	LineNumber          int        `json:"line_number"`
	ItemCode            string     `json:"item_code"`
	Description         string     `json:"description"`
	MaterialCode        string     `json:"material_code"`
	MaterialDescription string     `json:"material_description"`
	MaterialSize        string     `json:"material_size"`
	MaterialMarkings    string     `json:"material_markings"`
	MaterialThickness   string     `json:"material_thickness"`
	MaterialLength      string     `json:"material_length"`
	Weight              string     `json:"weight"`
	InternalDescription   string     `json:"internal_description"`
	ItemType              string     `json:"item_type"`
	PackagingMethod       string     `json:"packaging_method"`
	Accessories           string     `json:"accessories"`
	Comments              string     `json:"comments"`
	RequiredGalvThickness string     `json:"required_galv_thickness"`
	Process               string     `json:"process"`
	StoredIn            string     `json:"stored_in"`
	Bay                 string     `json:"bay"`
	ExpectedQuantity    float64    `json:"expected_quantity"`
	ReceivedQuantity    float64    `json:"received_quantity"`
	UnitOfMeasure       string     `json:"unit_of_measure"`
	ReceivingStatus     string     `json:"receiving_status"`
	Discrepancy         string     `json:"discrepancy"`
	QuantityDiscrepancy string     `json:"quantity_discrepancy"`
	ConditionNotes      string     `json:"condition_notes"`
	DocuWareRecordLine  string     `json:"docuware_record_line_id"`
	DocuWareUniqueNo    string     `json:"docuware_unique_number"`
	DocuWarePrimaryKey  string     `json:"docuware_primary_key"`
	DocuWareDocID       string     `json:"docuware_doc_id"`
	LastSyncedAt        *time.Time `json:"last_synced_at,omitempty"`
}

type ReceiptDocument struct {
	ID                 string    `json:"id"`
	DocumentType       string    `json:"document_type"`
	Filename           string    `json:"filename"`
	ContentType        string    `json:"content_type"`
	StorageKey         string    `json:"storage_key"`
	Source             string    `json:"source"`
	DocuWareDocumentID string    `json:"docuware_document_id"`
	DocuWareStatus     string    `json:"docuware_status"`
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
