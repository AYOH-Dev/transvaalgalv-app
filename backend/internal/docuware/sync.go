package docuware

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"
)

type SyncableReceiptLine struct {
	ID                           string
	DocuWareRecordLineID         string
	ItemType                     string
	Process                      string
	PackagingMethod              string
	InternalDescription          string
	RequiredGalvThickness        string
	ReceivedQuantity             float64
	QuantityDiscrepancy          string
	Discrepancy                  string
	ReceivingStatus              string
	StoredIn                     string
	Bay                          string
	Accessories                  string
	Comments                     string
	ConditionNotes               string // JSON payload from defect wizard
	MaterialCode                 string
	MaterialDescription          string
	MaterialSize                 string
	MaterialMarkings             string
	MaterialThickness            string
	MaterialLength               string
	Weight                       string
	ReceivedByName               string // display_name of the user who confirmed this line
}

type SyncableReceipt struct {
	CustomerName            string
	SupplierName            string
	DeliveryNoteNumber      string
	PurchaseOrderNumber     string
	WeighbridgeTicketNumber string
	VehicleRegistration     string
	JobNumber               string
}

// newStringField creates a FieldUpdate for a string field with proper defaults.
//
// DocuWare's REST payload uses an XML-choice-style discriminator
// (ItemElementName) that must be empty when the value is null — otherwise
// the platform deserializer rejects the request with
// "Error converting value \"\" to type 'DocuWare.Platform.Model.ItemChoiceType'".
// Sending ItemElementName="string" with an empty Item is therefore a hard
// error, not a no-op.
func newStringField(name, value string) FieldUpdate {
	field := FieldUpdate{
		FieldName:         name,
		Item:              value,
		ItemElementName:   "string",
		ReadOnly:          false,
		SystemField:       false,
		PointAndShootInfo: nil,
		IsAutoNumber:      false,
		IsNull:            false,
	}
	if value == "" {
		field.ItemElementName = ""
		field.IsNull = true
	}
	return field
}

// BuildFieldUpdates constructs DocuWare field updates from receipt line data.
// Includes iteration 1 outcomes + iteration 2 defect flags and mitigations.
func BuildFieldUpdates(line SyncableReceiptLine, receipt SyncableReceipt) []FieldUpdate {
	fields := []FieldUpdate{}

	// Header fields (repeated on every line record)
	fields = append(fields,
		newStringField("COMPANY", receipt.CustomerName),
		newStringField("FABRICATOR", receipt.SupplierName),
		newStringField("DELIVERY_NOTE", receipt.DeliveryNoteNumber),
		newStringField("ORDER_NUMBER", receipt.PurchaseOrderNumber),
		newStringField("WEIGHBRIDGE_TICKET_NUMBER", receipt.WeighbridgeTicketNumber),
		newStringField("VEHICLE_REGISTRATION", receipt.VehicleRegistration),
		newStringField("JOB_NUMBER", receipt.JobNumber),
		newStringField("RECEIVED_BY", line.ReceivedByName),
	)

	// Line outcome fields
	fields = append(fields,
		newStringField("ITEM_TYPE", line.ItemType),
		newStringField("PROCESS", line.Process),
		newStringField("PACKAGING_METHOD", line.PackagingMethod),
		newStringField("INTERNAL_DESCRIPTION", line.InternalDescription),
		newStringField("REQUIRED_GALV_THICKNESS", line.RequiredGalvThickness),
		newStringField("QUANTITY_RECEIVED", formatQuantity(line.ReceivedQuantity)),
		newStringField("QUANTITY_DISCREPANCY", line.QuantityDiscrepancy),
		newStringField("DISCREPANCY", line.Discrepancy),
		newStringField("RECEIVING_STATUS", humanizeReceivingStatus(line.ReceivingStatus)),
		newStringField("STORED_IN", line.StoredIn),
		newStringField("BAY", line.Bay),
		newStringField("ACCESSORIES", line.Accessories),
		newStringField("COMMENTS", line.Comments),
	)

	// Material fields
	fields = append(fields,
		newStringField("MATERIAL_CODE", line.MaterialCode),
		newStringField("MATERIAL_DESCRIPTION", line.MaterialDescription),
		newStringField("MATERIAL_SIZE", line.MaterialSize),
		newStringField("MATERIAL_MARKINGS", line.MaterialMarkings),
		newStringField("MATERIAL_THICKNESS", line.MaterialThickness),
		newStringField("MATERIAL_LENGTH", line.MaterialLength),
		newStringField("WEIGHT", line.Weight),
	)

	// Defect flags + mitigations (iteration 2)
	defectFields := extractDefectFields(line.ConditionNotes)
	fields = append(fields, defectFields...)

	return fields
}

// formatQuantity converts a numeric received quantity to string.
// DocuWare stores QUANTITY_RECEIVED as Text, so format cleanly.
func formatQuantity(qty float64) string {
	if qty == 0 {
		return ""
	}
	if qty == math.Trunc(qty) {
		return strconv.FormatInt(int64(qty), 10)
	}
	return strconv.FormatFloat(qty, 'f', -1, 64)
}

// humanizeReceivingStatus maps app enum values to display strings for DocuWare.
// App uses: draft, received, quality_hold, matched, archived, sent_to_app
// DocuWare BI may expect title-cased versions.
func humanizeReceivingStatus(status string) string {
	m := map[string]string{
		"draft":         "Draft",
		"received":      "Received",
		"quality_hold":  "Quality Hold",
		"matched":       "Matched",
		"archived":      "Archived",
		"sent_to_app":   "Sent to App",
	}
	if v, ok := m[strings.ToLower(status)]; ok {
		return v
	}
	return status
}

// SyncError represents a sync attempt result (success or error).
type SyncError struct {
	Timestamp time.Time
	Message   string
}

// SyncResult tracks the outcome of a sync attempt.
type SyncResult struct {
	LineID              string
	Success             bool
	LastSyncedAt        time.Time
	Error               *SyncError
	FieldCount          int
	Retryable           bool
}

// extractDefectFields parses condition_notes JSON and returns defect flag + mitigation field updates.
func extractDefectFields(conditionNotesJSON string) []FieldUpdate {
	if strings.TrimSpace(conditionNotesJSON) == "" {
		return []FieldUpdate{}
	}

	var data map[string]interface{}
	if err := json.Unmarshal([]byte(conditionNotesJSON), &data); err != nil {
		return []FieldUpdate{}
	}

	fields := []FieldUpdate{}

	// Map of wizard defect key → DocuWare field name + default value
	defectFlags := map[string]struct {
		field        string
		defaultValue string
	}{
		"paint":              {field: "PAINT", defaultValue: "none"},
		"damaged":            {field: "DAMAGED", defaultValue: "none"},
		"rust":               {field: "RUST", defaultValue: "normal"},
		"delamination":       {field: "DELAMINATION", defaultValue: "no"},
		"nonConformingPreGalv": {field: "NON_CONFORMING_PRE_GALV", defaultValue: "no"},
		"enclosedCavity":     {field: "ENCLOSED_CAVITY", defaultValue: "no"},
		"threadedArticle":    {field: "THREADED_ARTICLE", defaultValue: "no"},
		"burr":               {field: "BURR", defaultValue: "none"},
		"pinHoles":           {field: "PIN_HOLES", defaultValue: "none"},
		"weldingSplatter":    {field: "WELD_SPLATTER", defaultValue: "no"},
		"weldingFlux":        {field: "WELDING_FLUX", defaultValue: "no"},
		"continuousWeld":     {field: "CONTINUOUS_WELD", defaultValue: "no"},
		"articleOverlap":     {field: "ARTICLE_OVERLAPPED", defaultValue: "no"},
		"possibleDistortion": {field: "POSSIBLE_DISTORTION", defaultValue: "no"},
		"oilGreaseDiesel":    {field: "OIL_GREASE_DIESEL", defaultValue: "none"},
		"sharpEdges":         {field: "SHARP_EDGES", defaultValue: "no"},
		"holesInadequate":    {field: "HOLES_INADEQUATE", defaultValue: "no"},
		"noHanging":          {field: "NO_HANGING_METHOD", defaultValue: "no"},
	}

	// Map of mitigation keys → DocuWare field names
	mitigationFields := map[string]string{
		"paintMitigation":                   "PAINT_MITIGATION",
		"damagedMitigation":                 "DAMAGE_MITIGATION",
		"rustMitigation":                    "RUST_MITIGATION",
		"delaminationMitigation":            "DELAMINATION_MITIGATION",
		"nonConformingPreGalvMitigation":    "NON_CONFORMING_PRE_GALV_MITIG",
		"threadedArticleMitigation":         "THREADED_ARTICLE_MITIGATION",
		"enclosedCavityMitigation":          "ENCLOSED_CAVITY_HOLES_REQUIRE",
	}

	// Map of mitigation quantity keys → DocuWare field names
	mitigationQtyFields := map[string]string{
		"noHangingLiftingLugNutQty":  "NO_HANGING_LIFTING_LUG_NUT_R1",
		"noHangingHangNotchQty":      "NO_HANGING_HANG_NOTCH_REQUIR1",
		"enclosedCavityHolesQty":     "ENCLOSED_CAVITY_HOLES_QUANTIT",
	}

	// Hole quantity fields (from holesInadequate defect)
	holeQtyFields := map[string]string{
		"ventHolesQty":  "VENT_HOLES_REQUIRED",
		"drainHolesQty": "DRAIN_HOLES_REQUIRED",
		"jigHolesQty":   "JIG_HOLE_REQUIRED",
	}

	// Check if any defect is present (non-default)
	defectDetected := false
	for defectKey, info := range defectFlags {
		if val, ok := data[defectKey]; ok {
			valStr := valueToString(val)
			if valStr != "" && valStr != info.defaultValue {
				defectDetected = true
				fields = append(fields, newStringField(info.field, valStr))
			}
		}
	}

	// Set DEFECT_DETECTED based on any flag being non-default
	if defectDetected {
		fields = append(fields, newStringField("DEFECT_DETECTED", "Yes"))
	} else {
		fields = append(fields, newStringField("DEFECT_DETECTED", "No"))
	}

	// Process mitigations
	for mitigKey, dwField := range mitigationFields {
		if val, ok := data[mitigKey]; ok {
			if arr, isArr := val.([]interface{}); isArr && len(arr) > 0 {
				mitigations := make([]string, 0, len(arr))
				for _, m := range arr {
					if str, isStr := m.(string); isStr && str != "" {
						mitigations = append(mitigations, str)
					}
				}
				if len(mitigations) > 0 {
					fields = append(fields, newStringField(dwField, strings.Join(mitigations, ", ")))
				}
			}
		}
	}

	// Hole quantity fields
	for wizardKey, dwField := range holeQtyFields {
		if val, ok := data[wizardKey]; ok {
			if numVal, isNum := val.(float64); isNum {
				fields = append(fields, newStringField(dwField, strconv.FormatInt(int64(numVal), 10)))
			}
		}
	}

	// Mitigation quantity fields (for no hanging method)
	for wizardKey, dwField := range mitigationQtyFields {
		if val, ok := data[wizardKey]; ok {
			if numVal, isNum := val.(float64); isNum {
				fields = append(fields, newStringField(dwField, strconv.FormatInt(int64(numVal), 10)))
			}
		}
	}

	// Cavity vent holes quantity
	if val, ok := data["cavityVentHolesQty"]; ok {
		if numVal, isNum := val.(float64); isNum {
			fields = append(fields, newStringField("ENCLOSED_CAVITY_HOLES_QUANTIT", strconv.FormatInt(int64(numVal), 10)))
		}
	}

	// Additional comments
	if val, ok := data["additionalComments"]; ok {
		if str, isStr := val.(string); isStr && str != "" {
			fields = append(fields, newStringField("ADDITIONAL_COMMENTS", str))
		}
	}

	return fields
}

// valueToString converts interface{} to string, handling bool/float64/string
func valueToString(val interface{}) string {
	switch v := val.(type) {
	case string:
		return v
	case bool:
		if v {
			return "yes"
		}
		return "no"
	case float64:
		return strconv.FormatInt(int64(v), 10)
	default:
		return ""
	}
}

// IsRetryable determines if a sync error warrants a retry.
func IsRetryable(statusCode int, errMsg string) bool {
	// Transient HTTP errors
	if statusCode == 429 || statusCode == 500 || statusCode == 502 || statusCode == 503 || statusCode == 504 {
		return true
	}
	// Network timeouts, connection refused
	if strings.Contains(errMsg, "timeout") || strings.Contains(errMsg, "connection refused") || strings.Contains(errMsg, "connection reset") {
		return true
	}
	return false
}
