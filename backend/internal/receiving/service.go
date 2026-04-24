package receiving

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Repository interface {
	ListReceipts(ctx context.Context) ([]Receipt, error)
	GetReceipt(ctx context.Context, id string) (Receipt, error)
	ImportDocuWareReceipts(ctx context.Context, receipts []importedReceipt) ([]Receipt, error)
	UpdateReceipt(ctx context.Context, id string, input UpdateReceiptInput) (Receipt, error)
	UpdateReceiptLine(ctx context.Context, receiptID, lineID string, input UpdateReceiptLineInput) (ReceiptLine, error)
}

type Service struct {
	repository Repository
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
	DocuWareRecordLine  string
	DocuWareUniqueNo    string
	DocuWarePrimaryKey  string
	SourcePayload       map[string]any
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository}
}

func (s *Service) ListReceipts(ctx context.Context) ([]Receipt, error) {
	if s.repository == nil {
		return []Receipt{}, nil
	}

	return s.repository.ListReceipts(ctx)
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

	return DocuWareImportResult{
		ImportedReceiptCount: len(receipts),
		ImportedRowCount:     len(input.Rows),
		Receipts:             receipts,
	}, nil
}

var validStatusTransitions = map[ReceiptStatus][]ReceiptStatus{
	ReceiptStatusDraft:       {ReceiptStatusReceived},
	ReceiptStatusReceived:    {ReceiptStatusMatched, ReceiptStatusQualityHold},
	ReceiptStatusQualityHold: {ReceiptStatusReceived, ReceiptStatusMatched},
	ReceiptStatusMatched:     {ReceiptStatusArchived},
	ReceiptStatusArchived:    {},
}

func (s *Service) UpdateReceipt(ctx context.Context, id string, input UpdateReceiptInput) (Receipt, error) {
	if s.repository == nil {
		return Receipt{}, ErrUnavailable
	}

	if strings.TrimSpace(id) == "" {
		return Receipt{}, fmt.Errorf("%w: receipt id is required", ErrInvalidInput)
	}

	if input.Status != nil {
		current, err := s.repository.GetReceipt(ctx, id)
		if err != nil {
			return Receipt{}, err
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
			return Receipt{}, fmt.Errorf("%w: cannot transition from %s to %s", ErrInvalidInput, current.Status, *input.Status)
		}
	}

	return s.repository.UpdateReceipt(ctx, id, input)
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

	return s.repository.UpdateReceiptLine(ctx, receiptID, lineID, input)
}

func buildImportedReceipt(input DocuWareImportInput, groupReference string, payload map[string]any) *importedReceipt {
	sourceDocumentID := firstNonEmpty(
		strings.TrimSpace(input.SourceDocumentID),
		payloadString(payload, "DNDOCID"),
		payloadString(payload, "DNDOCIDI"),
		payloadString(payload, "DWDOCID"),
	)
	sourceCabinetID := firstNonEmpty(
		strings.TrimSpace(input.SourceCabinetID),
		payloadString(payload, "DWSYS_FC_GUID"),
	)
	groupRecordID := firstNonEmpty(payloadString(payload, "DNDOCID"), payloadString(payload, "DNDOCIDI"))
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
		SupplierReference:       firstNonEmpty(payloadString(payload, "DNDOCID"), payloadString(payload, "DNDOCIDI"), payloadString(payload, "JOB_NUMBER")),
		PurchaseOrderNumber:     firstNonEmpty(payloadString(payload, "ORDER_NUMBER"), payloadString(payload, "DOCUMENTNO")),
		DeliveryNoteNumber:      firstNonEmpty(payloadString(payload, "DELIVERY_NOTE"), payloadString(payload, "DELIVERY_NOTE_NUMBER")),
		WeighbridgeTicketNumber: payloadString(payload, "WEIGHBRIDGE_TICKET_NUMBER"),
		VehicleRegistration:     payloadString(payload, "VEHICLE_REGISTRATION"),
		JobNumber:               payloadString(payload, "JOB_NUMBER"),
		SourceDocuWareDocument:  sourceDocumentID,
		SourceDocuWareCabinet:   sourceCabinetID,
		DocuWareRecordID:        groupRecordID,
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
		ReceivingStatus:     payloadString(payload, "RECEIVING_STATUS"),
		Discrepancy:         payloadString(payload, "DISCREPANCY"),
		QuantityDiscrepancy: payloadString(payload, "QUANTITY_DISCREPANCY"),
		ConditionNotes:      joinNonEmpty(" | ", payloadString(payload, "COMMENTS"), payloadString(payload, "ADDITIONAL_COMMENTS"), payloadString(payload, "OTHER")),
		DocuWareRecordLine:  docuWareRecordLine,
		DocuWareUniqueNo:    payloadString(payload, "UNIQUE_NUMBER"),
		DocuWarePrimaryKey:  payloadString(payload, "PRIMARY_KEY"),
		SourcePayload:       payload,
	}
}

func buildGroupReference(payload map[string]any) string {
	parts := []string{
		payloadString(payload, "DNDOCID"),
		payloadString(payload, "DNDOCIDI"),
		payloadString(payload, "DELIVERY_NOTE"),
		payloadString(payload, "DELIVERY_NOTE_NUMBER"),
		payloadString(payload, "ORDER_NUMBER"),
		payloadString(payload, "WEIGHBRIDGE_TICKET_NUMBER"),
		payloadString(payload, "JOB_NUMBER"),
		payloadString(payload, "COMPANY"),
		payloadString(payload, "FABRICATOR"),
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
