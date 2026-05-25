package docuware

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"
)

type SyncableReceiptLine struct {
	ID                    string
	DocuWareRecordLineID  string
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
	ConditionNotes        string // JSON payload from defect wizard
	MaterialCode          string
	MaterialDescription   string
	MaterialSize          string
	MaterialMarkings      string
	MaterialThickness     string
	MaterialLength        string
	Weight                string
	ReceivedByName        string // display_name of the user who confirmed this line
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
		"draft":        "Draft",
		"reviewed":     "Reviewed",
		"received":     "Received",
		"quality_hold": "Quality Hold",
		"matched":      "Matched",
		"archived":     "Archived",
		"sent_to_app":  "Sent to App",
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
	LineID           string
	Success          bool
	LastSyncedAt     time.Time
	Error            *SyncError
	FieldCount       int
	Retryable        bool
	NewDocuWareDocID string // set when a new Receiving Data document was created
}

// extractDefectFields parses condition_notes JSON and returns defect flag +
// mitigation field updates.
//
// To make removals stick in DocuWare we ALWAYS emit the full defect/mitigation
// field set — defaults for absent keys, parsed values where present. Otherwise
// clearing a defect locally would leave a stale "yes" sitting in DocuWare,
// because newStringField with an empty value writes IsNull=true (a clear).
func extractDefectFields(conditionNotesJSON string) []FieldUpdate {
	// Empty/invalid condition_notes is treated as "no defects at all" — we
	// still emit defaults so any previously-synced values get cleared.
	var data map[string]interface{}
	if strings.TrimSpace(conditionNotesJSON) != "" {
		_ = json.Unmarshal([]byte(conditionNotesJSON), &data)
	}
	if data == nil {
		data = map[string]interface{}{}
	}

	fields := []FieldUpdate{}

	// Map of wizard defect key → DocuWare field name + default value.
	// Order is preserved so the payload sent to DocuWare is deterministic.
	type defectFlag struct {
		key          string
		field        string
		defaultValue string
	}
	defectFlags := []defectFlag{
		{"paint", "PAINT", "none"},
		{"damaged", "DAMAGED", "none"},
		{"rust", "RUST", "normal"},
		{"delamination", "DELAMINATION", "no"},
		{"nonConformingPreGalv", "NON_CONFORMING_PRE_GALV", "no"},
		{"enclosedCavity", "ENCLOSED_CAVITY", "no"},
		{"threadedArticle", "THREADED_ARTICLE", "no"},
		{"burr", "BURR", "none"},
		{"pinHoles", "PIN_HOLES", "none"},
		{"weldingSplatter", "WELD_SPLATTER", "no"},
		{"weldingFlux", "WELDING_FLUX", "no"},
		{"continuousWeld", "CONTINUOUS_WELD", "no"},
		{"articleOverlap", "ARTICLE_OVERLAPPED", "no"},
		{"possibleDistortion", "POSSIBLE_DISTORTION", "no"},
		{"oilGreaseDiesel", "OIL_GREASE_DIESEL", "none"},
		{"sharpEdges", "SHARP_EDGES", "no"},
		{"holesInadequate", "HOLES_INADEQUATE", "no"},
		{"noHanging", "NO_HANGING_METHOD", "no"},
	}

	// Single-field mitigations: comma-joined labels go to one DocuWare field.
	// The paired-field defects (holesInadequate, enclosedCavity, noHanging,
	// articleOverlap) are handled separately below.
	type mitField struct {
		key   string
		field string
	}
	mitigationFields := []mitField{
		{"paintMitigation", "PAINT_MITIGATION"},
		{"damagedMitigation", "DAMAGE_MITIGATION"},
		{"rustMitigation", "RUST_MITIGATION"},
		{"delaminationMitigation", "DELAMINATION_MITIGATION"},
		{"nonConformingPreGalvMitigation", "NON_CONFORMING_PRE_GALV_MITIG"},
		{"threadedArticleMitigation", "THREADED_ARTICLE_MITIGATION"},
	}

	// Defect flags — emit default for absent, parsed value for present.
	// Tracks whether anything is non-default so DEFECT_DETECTED can be set.
	defectDetected := false
	for _, info := range defectFlags {
		value := info.defaultValue
		if val, ok := data[info.key]; ok {
			if valStr := valueToString(val); valStr != "" {
				value = valStr
			}
		}
		if value != info.defaultValue {
			defectDetected = true
		}
		fields = append(fields, newStringField(info.field, value))
	}

	if defectDetected {
		fields = append(fields, newStringField("DEFECT_DETECTED", "Yes"))
	} else {
		fields = append(fields, newStringField("DEFECT_DETECTED", "No"))
	}

	// Single-field mitigations — emit empty when absent so DocuWare clears the
	// field; comma-join the labels when present.
	for _, mf := range mitigationFields {
		value := ""
		if val, ok := data[mf.key]; ok {
			if arr, isArr := val.([]interface{}); isArr && len(arr) > 0 {
				mitigations := make([]string, 0, len(arr))
				for _, m := range arr {
					if str, isStr := m.(string); isStr && str != "" {
						mitigations = append(mitigations, str)
					}
				}
				value = strings.Join(mitigations, ", ")
			}
		}
		fields = append(fields, newStringField(mf.field, value))
	}

	// Paired-field mitigations follow. Each pair is emitted unconditionally so
	// removals clear the previous "yes"/qty in DocuWare. Required field defaults
	// to "no"; qty defaults to "" (clears in DocuWare).

	// holesInadequate — three pairs.
	holesMits := mapStrings(stripMitigationQtyTokens(data["holesInadequateMitigation"]))
	type holePair struct {
		mitigation string
		reqField   string
		qtyField   string
		qtyKey     string
	}
	holePairs := []holePair{
		{"Vent holes required", "VENT_HOLES_REQUIRED", "VENT_HOLES", "ventHolesQty"},
		{"Drain holes required", "DRAIN_HOLES_REQUIRED", "DRAIN_HOLES", "drainHolesQty"},
		{"Jig holes required", "JIG_HOLE_REQUIRED", "JIG_HOLES", "jigHolesQty"},
	}
	for _, p := range holePairs {
		req := "no"
		qty := ""
		if holesMits[p.mitigation] {
			req = "yes"
			if numVal, ok := numericFromData(data, p.qtyKey); ok {
				qty = strconv.FormatInt(int64(numVal), 10)
			}
		}
		fields = append(fields, newStringField(p.reqField, req))
		fields = append(fields, newStringField(p.qtyField, qty))
	}

	// enclosedCavity — single pair.
	cavityMits := mapStrings(stripMitigationQtyTokens(data["enclosedCavityMitigation"]))
	{
		req := "no"
		qty := ""
		if cavityMits["Cavity Vent holes required"] {
			req = "yes"
			if numVal, ok := numericFromData(data, "cavityVentHolesQty"); ok {
				qty = strconv.FormatInt(int64(numVal), 10)
			}
		}
		fields = append(fields, newStringField("ENCLOSED_CAVITY_HOLES_REQUIRE", req))
		fields = append(fields, newStringField("ENCLOSED_CAVITY_HOLES_QUANTIT", qty))
	}

	// noHanging — two pairs, qty encoded inline in the token ("name=qty").
	noHangingTokens := tokenMap(data["noHangingMitigation"])
	{
		req := "no"
		qty := ""
		if t, ok := noHangingTokens["Lifting lug-nut required"]; ok {
			req = "yes"
			qty = t
		}
		fields = append(fields, newStringField("NO_HANGING_LIFTING_LUG_NUT_RE", req))
		fields = append(fields, newStringField("NO_HANGING_LIFTING_LUG_NUT_R1", qty))
	}
	{
		req := "no"
		qty := ""
		if t, ok := noHangingTokens["Hang notch required"]; ok {
			req = "yes"
			qty = t
		}
		fields = append(fields, newStringField("NO_HANGING_HANG_NOTCH_REQUIRE", req))
		fields = append(fields, newStringField("NO_HANGING_HANG_NOTCH_REQUIR1", qty))
	}

	// articleOverlap — same inline-qty encoding as noHanging.
	articleOverlapTokens := tokenMap(data["articleOverlapMitigation"])
	{
		req := "no"
		qty := ""
		if t, ok := articleOverlapTokens["Article Overlap Vent Hole required"]; ok {
			req = "yes"
			qty = t
		}
		fields = append(fields, newStringField("ARTICLE_OVERLAP_VENT_HOLES", req))
		fields = append(fields, newStringField("ARTICLE_OVERLAP_QUANTITY", qty))
	}

	// Additional comments — clear when absent.
	comments := ""
	if val, ok := data["additionalComments"]; ok {
		if str, isStr := val.(string); isStr {
			comments = str
		}
	}
	fields = append(fields, newStringField("ADDITIONAL_COMMENTS", comments))

	return fields
}

// tokenMap parses an inline-qty mitigation array ("name=qty" entries) into a
// name→qty map. Names without an explicit qty map to "".
func tokenMap(v interface{}) map[string]string {
	out := map[string]string{}
	for _, token := range mitigationTokens(v) {
		name, qty := splitMitigationQtyToken(token)
		out[name] = qty
	}
	return out
}

// valueToString converts interface{} to string, handling bool/float64/string
// mitigationTokens returns the raw mitigation entries from a condition_notes
// array field. Entries may carry an inline qty (e.g. "Lifting lug-nut required=2");
// callers that need to ignore the qty should use stripMitigationQtyTokens.
func mitigationTokens(raw interface{}) []string {
	arr, ok := raw.([]interface{})
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, isStr := e.(string); isStr && s != "" {
			out = append(out, s)
		}
	}
	return out
}

// stripMitigationQtyTokens returns mitigation labels with any inline "=qty"
// suffix removed. Used for defects where qty is captured separately (top-level
// *Qty keys) and the mitigation field should only carry the label.
func stripMitigationQtyTokens(raw interface{}) []string {
	tokens := mitigationTokens(raw)
	out := make([]string, 0, len(tokens))
	for _, t := range tokens {
		name, _ := splitMitigationQtyToken(t)
		out = append(out, name)
	}
	return out
}

// splitMitigationQtyToken splits "Mitigation label=42" into ("Mitigation label", "42").
// If no "=" is present, qty is "".
func splitMitigationQtyToken(token string) (name, qty string) {
	eqIdx := strings.LastIndex(token, "=")
	if eqIdx == -1 {
		return strings.TrimSpace(token), ""
	}
	return strings.TrimSpace(token[:eqIdx]), strings.TrimSpace(token[eqIdx+1:])
}

// mapStrings turns a slice into a set-style map for O(1) membership checks.
func mapStrings(xs []string) map[string]bool {
	out := make(map[string]bool, len(xs))
	for _, x := range xs {
		out[x] = true
	}
	return out
}

// numericFromData returns the numeric value at key in data, accepting either
// float64 (typical JSON) or numeric strings.
func numericFromData(data map[string]interface{}, key string) (float64, bool) {
	v, ok := data[key]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return n, true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		if err != nil {
			return 0, false
		}
		return f, true
	}
	return 0, false
}

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
